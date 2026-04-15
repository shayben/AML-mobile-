import axios, { AxiosInstance } from 'axios';
import {
  AZURE_AUTH_URL,
  AZURE_MANAGEMENT_URL,
  AZURE_ML_API_VERSION,
  AZURE_ML_SCOPE,
  AZURE_COST_API_VERSION,
} from '../constants';
import {
  AzureCredentials,
  CostBreakdownItem,
  CostDataPoint,
  CostForecast,
  JobOutput,
  LogFile,
  MetricSeries,
  MonthlyCostSummary,
  Run,
  RunDetails,
  Subscription,
  Workspace,
} from '../types';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class AzureMLService {
  private credentials: AzureCredentials | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private client: AxiosInstance;

  constructor(credentialsOrToken: AzureCredentials | {
    accessToken: string;
    subscriptionId: string;
  }) {
    if ('accessToken' in credentialsOrToken) {
      this.accessToken = credentialsOrToken.accessToken;
      this.tokenExpiresAt = Date.now() + 3600000;
      this.credentials = {
        tenantId: '',
        clientId: '',
        clientSecret: '',
        subscriptionId: credentialsOrToken.subscriptionId,
      };
    } else {
      this.credentials = credentialsOrToken;
    }
    this.client = axios.create({ baseURL: AZURE_MANAGEMENT_URL });
    this.client.interceptors.request.use(async (config) => {
      const token = await this.getAccessToken();
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
  }

  get subscriptionId(): string {
    return this.credentials?.subscriptionId ?? '';
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    if (!this.credentials?.clientSecret) {
      throw new Error('Token expired. Please sign in again.');
    }

    const url = `${AZURE_AUTH_URL}/${this.credentials.tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      scope: AZURE_ML_SCOPE,
    });

    const response = await axios.post<TokenResponse>(url, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    this.accessToken = response.data.access_token;
    this.tokenExpiresAt = Date.now() + response.data.expires_in * 1000;
    return this.accessToken;
  }

  async listSubscriptions(): Promise<Subscription[]> {
    const response = await this.client.get('/subscriptions', {
      params: { 'api-version': '2022-12-01' },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (response.data.value || []).map((sub: any): Subscription => ({
      subscriptionId: sub.subscriptionId,
      displayName: sub.displayName,
      state: sub.state,
    }));
  }

  async hasWorkspaces(subscriptionId: string): Promise<boolean> {
    try {
      const url = `/subscriptions/${subscriptionId}/providers/Microsoft.MachineLearningServices/workspaces`;
      const response = await this.client.get(url, {
        params: { 'api-version': AZURE_ML_API_VERSION, '$top': 1 },
      });
      return (response.data.value || []).length > 0;
    } catch {
      return false;
    }
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const url = `/subscriptions/${this.subscriptionId}/providers/Microsoft.MachineLearningServices/workspaces`;
    const response = await this.client.get(url, {
      params: { 'api-version': AZURE_ML_API_VERSION },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (response.data.value || []).map((ws: any): Workspace => ({
      id: ws.id,
      name: ws.name,
      resourceGroup: ws.id.split('/')[4],
      location: ws.location,
      subscriptionId: this.subscriptionId,
    }));
  }

  async listJobs(
    resourceGroup: string,
    workspaceName: string,
  ): Promise<Run[]> {
    const base = this.buildWorkspacePath(resourceGroup, workspaceName);
    const url = `${base}/jobs`;
    const response = await this.client.get(url, {
      params: { 'api-version': AZURE_ML_API_VERSION },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (response.data.value || []).map((job: any): Run => ({
      runId: job.name,
      displayName: job.properties?.displayName || job.name,
      status: job.properties?.status,
      startTimeUtc: job.properties?.startTime || job.systemData?.createdAt,
      endTimeUtc: job.properties?.endTime,
      experimentName: job.properties?.experimentName || '',
      runType: job.properties?.jobType,
      tags: job.properties?.tags,
      properties: job.properties?.properties,
    }));
  }

  async getJobDetails(
    resourceGroup: string,
    workspaceName: string,
    jobName: string,
  ): Promise<RunDetails> {
    const base = this.buildWorkspacePath(resourceGroup, workspaceName);
    const url = `${base}/jobs/${encodeURIComponent(jobName)}`;
    const response = await this.client.get(url, {
      params: { 'api-version': AZURE_ML_API_VERSION },
    });
    const job = response.data;

    return {
      runId: job.name,
      displayName: job.properties?.displayName || job.name,
      status: job.properties?.status,
      startTimeUtc: job.properties?.startTime || job.systemData?.createdAt,
      endTimeUtc: job.properties?.endTime,
      experimentName: job.properties?.experimentName || '',
      runType: job.properties?.jobType,
      tags: job.properties?.tags,
      properties: job.properties?.properties,
      description: job.properties?.description,
      target: job.properties?.computeId?.split('/').pop(),
    };
  }

  // Find MLflow runs for a job — returns child runs for pipelines, or the run itself
  private async findMlflowRuns(
    mlflowBase: string,
    token: string,
    jobName: string,
  ): Promise<Array<{ run_id: string; data: { metrics?: Array<{ key: string; value?: number; step?: number }> } }>> {
    // First, find the top-level run by job name
    const response = await axios.post(
      `${mlflowBase}/runs/search`,
      { filter: `tags.mlflow.runName = '${jobName}'`, max_results: 1 },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );

    const runs = response.data?.runs || [];
    if (runs.length === 0) return [];

    const parentRun = runs[0];
    const parentRunId = parentRun.info?.run_id;
    const parentMetrics = parentRun.data?.metrics || [];

    // If the parent has metrics, it's a simple job — return it directly
    if (parentMetrics.length > 0) {
      return [{ run_id: parentRunId, data: parentRun.data }];
    }

    // No metrics on parent — likely a pipeline. Search for child runs.
    try {
      const childResp = await axios.post(
        `${mlflowBase}/runs/search`,
        { filter: `tags.mlflow.parentRunId = '${parentRunId}'`, max_results: 50 },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
      );
      const childRuns = childResp.data?.runs || [];
      if (childRuns.length > 0) {
        return childRuns.map((r: { info: { run_id: string }; data: unknown }) => ({
          run_id: r.info.run_id,
          data: r.data as { metrics?: Array<{ key: string; value?: number; step?: number }> },
        }));
      }
    } catch { /* fall through to return parent */ }

    // No child runs found — return parent anyway
    return [{ run_id: parentRunId, data: parentRun.data }];
  }

  async getJobMetrics(
    resourceGroup: string,
    workspaceName: string,
    jobName: string,
    workspaceLocation?: string,
  ): Promise<Record<string, MetricSeries>> {
    if (!workspaceLocation) return {};

    try {
      const mlflowBase = this.buildMlflowPath(workspaceLocation, resourceGroup, workspaceName);
      const token = await this.getAccessToken();

      const mlflowRuns = await this.findMlflowRuns(mlflowBase, token, jobName);
      if (mlflowRuns.length === 0) return {};

      const result: Record<string, MetricSeries> = {};

      for (const mlflowRun of mlflowRuns) {
        const runId = mlflowRun.run_id;
        const summaryMetrics = mlflowRun.data?.metrics || [];

        // Prefix metric names with step name if multiple runs (pipeline)
        const prefix = mlflowRuns.length > 1 ? `${runId.substring(0, 8)}/` : '';

        for (const m of summaryMetrics) {
          if (!m.key) continue;
          const metricKey = `${prefix}${m.key}`;
          try {
            const histResp = await axios.get(
              `${mlflowBase}/metrics/get-history`,
              {
                params: { run_id: runId, metric_key: m.key },
                headers: { Authorization: `Bearer ${token}` },
              },
            );
            const points = histResp.data?.metrics || [];
            result[metricKey] = {
              name: metricKey,
              dataPoints: points.map((p: { step?: number; value?: number; timestamp?: number }, i: number) => ({
                step: p.step ?? i,
                value: p.value ?? 0,
                timestamp: p.timestamp ? new Date(p.timestamp).toISOString() : '',
              })),
            };
          } catch {
            result[metricKey] = {
              name: metricKey,
              dataPoints: [{ step: m.step ?? 0, value: m.value ?? 0, timestamp: '' }],
            };
          }
        }
      }

      return result;
    } catch {
      return {};
    }
  }

  async getJobLogFiles(
    resourceGroup: string,
    workspaceName: string,
    jobName: string,
    workspaceLocation: string,
  ): Promise<LogFile[]> {
    try {
      const mlflowBase = this.buildMlflowPath(workspaceLocation, resourceGroup, workspaceName);
      const token = await this.getAccessToken();

      const mlflowRuns = await this.findMlflowRuns(mlflowBase, token, jobName);
      if (mlflowRuns.length === 0) return [];

      const logs: LogFile[] = [];

      for (const mlflowRun of mlflowRuns) {
        const runId = mlflowRun.run_id;
        // Prefix log names with run ID snippet for pipeline child runs
        const prefix = mlflowRuns.length > 1 ? `[${runId.substring(0, 8)}] ` : '';

        const listArtifacts = async (path?: string) => {
          const resp = await axios.get(`${mlflowBase}/artifacts/list`, {
            params: { run_id: runId, ...(path ? { path } : {}) },
            headers: { Authorization: `Bearer ${token}` },
          });
          for (const file of resp.data?.files || []) {
            if (file.is_dir) {
              await listArtifacts(file.path);
            } else if (file.path?.endsWith('.txt') || file.path?.endsWith('.log')) {
              const downloadUrl = `${mlflowBase}/artifacts/get?run_id=${runId}&path=${encodeURIComponent(file.path)}`;
              logs.push({ name: `${prefix}${file.path}`, url: downloadUrl });
            }
          }
        };

        try {
          await listArtifacts('user_logs');
        } catch { /* no user_logs dir */ }
        try {
          await listArtifacts('system_logs');
        } catch { /* no system_logs dir */ }
        // Check root for aggregate logs
        try {
          const rootResp = await axios.get(`${mlflowBase}/artifacts/list`, {
            params: { run_id: runId },
            headers: { Authorization: `Bearer ${token}` },
          });
          for (const file of rootResp.data?.files || []) {
            if (!file.is_dir && (file.path?.endsWith('.txt') || file.path?.endsWith('.log'))) {
              const downloadUrl = `${mlflowBase}/artifacts/get?run_id=${runId}&path=${encodeURIComponent(file.path)}`;
              logs.push({ name: `${prefix}${file.path}`, url: downloadUrl });
            }
          }
        } catch { /* ignore */ }
      }

      return logs;
    } catch {
      return [];
    }
  }

  async getLogContent(url: string): Promise<string> {
    try {
      const token = await this.getAccessToken();
      const response = await axios.get(url, {
        responseType: 'text',
        timeout: 15000,
        headers: { Authorization: `Bearer ${token}` },
      });
      return typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data, null, 2);
    } catch {
      return '[Failed to load log content]';
    }
  }

  async getJobOutputs(
    resourceGroup: string,
    workspaceName: string,
    jobName: string,
  ): Promise<JobOutput[]> {
    try {
      const base = this.buildWorkspacePath(resourceGroup, workspaceName);
      const url = `${base}/jobs/${encodeURIComponent(jobName)}`;
      const response = await this.client.get(url, {
        params: { 'api-version': AZURE_ML_API_VERSION },
      });

      const outputs = response.data?.properties?.outputs || {};
      return Object.entries(outputs).map(([name, val]: [string, unknown]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = val as any;
        return {
          name,
          type: v?.jobOutputType || v?.type || 'unknown',
          uri: v?.uri || v?.assetId || undefined,
          description: v?.description || undefined,
          mode: v?.mode || undefined,
        };
      });
    } catch {
      return [];
    }
  }

  async getMonthlyCosts(monthOffset = 0): Promise<MonthlyCostSummary> {
    const now = new Date();
    const targetMonth = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
    const from = this.formatDate(targetMonth);
    const isCurrentMonth = monthOffset === 0;
    const to = isCurrentMonth
      ? this.formatDate(now)
      : this.formatDate(new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0));
    const monthStr = `${targetMonth.getFullYear()}-${String(targetMonth.getMonth() + 1).padStart(2, '0')}`;

    const costBase = `/subscriptions/${this.subscriptionId}/providers/Microsoft.CostManagement`;
    const mlFilter = {
      dimensions: {
        name: 'ServiceName',
        operator: 'In',
        values: ['Azure Machine Learning'],
      },
    };

    // Sequential queries to avoid 429 rate limits
    const dailyResp = await this.costQueryWithRetry(costBase, {
      type: 'ActualCost',
      timeframe: 'Custom',
      timePeriod: { from, to },
      dataset: {
        granularity: 'Daily',
        aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
        filter: mlFilter,
      },
    });

    const rgResp = await this.costQueryWithRetry(costBase, {
      type: 'ActualCost',
      timeframe: 'Custom',
      timePeriod: { from, to },
      dataset: {
        granularity: 'None',
        aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
        grouping: [{ type: 'Dimension', name: 'ResourceGroupName' }],
        filter: mlFilter,
      },
    });

    const meterResp = await this.costQueryWithRetry(costBase, {
      type: 'ActualCost',
      timeframe: 'Custom',
      timePeriod: { from, to },
      dataset: {
        granularity: 'None',
        aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
        grouping: [{ type: 'Dimension', name: 'MeterCategory' }],
        filter: mlFilter,
      },
    });

    const dailyCosts = this.parseCostRows(dailyResp, 'daily');
    const byResourceGroup = this.parseCostRows(rgResp, 'grouped') as CostBreakdownItem[];
    const byMeterCategory = this.parseCostRows(meterResp, 'grouped') as CostBreakdownItem[];

    const totalCost = (dailyCosts as CostDataPoint[]).reduce((sum, d) => sum + d.cost, 0);
    const currency = (dailyCosts as CostDataPoint[])[0]?.currency
      || (byResourceGroup as CostBreakdownItem[])[0]?.currency
      || 'USD';

    return {
      month: monthStr,
      totalCost,
      currency,
      dailyCosts: dailyCosts as CostDataPoint[],
      byResourceGroup: (byResourceGroup as CostBreakdownItem[]).sort((a, b) => b.cost - a.cost),
      byMeterCategory: (byMeterCategory as CostBreakdownItem[]).sort((a, b) => b.cost - a.cost),
    };
  }

  async getCostForecast(): Promise<CostForecast> {
    const now = new Date();
    const from = this.formatDate(now);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const to = this.formatDate(endOfMonth);
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    if (from === to) {
      return { month: monthStr, estimatedCost: 0, currency: 'USD', dailyForecast: [] };
    }

    try {
      const costBase = `/subscriptions/${this.subscriptionId}/providers/Microsoft.CostManagement`;
      const data = await this.costQueryWithRetry(costBase, {
        type: 'ActualCost',
        timeframe: 'Custom',
        timePeriod: { from, to },
        dataset: {
          granularity: 'Daily',
          aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
          filter: {
            dimensions: {
              name: 'ServiceName',
              operator: 'In',
              values: ['Azure Machine Learning'],
            },
          },
        },
      }, true);

      const dailyForecast = this.parseCostRows(data, 'daily') as CostDataPoint[];
      const estimatedCost = dailyForecast.reduce((sum, d) => sum + d.cost, 0);
      const currency = dailyForecast[0]?.currency || 'USD';

      return { month: monthStr, estimatedCost, currency, dailyForecast };
    } catch {
      return { month: monthStr, estimatedCost: 0, currency: 'USD', dailyForecast: [] };
    }
  }

  async getMultiMonthCosts(months = 6): Promise<MonthlyCostSummary[]> {
    // Single query for monthly totals over the full range — instead of 6 separate calls
    const now = new Date();
    const from = this.formatDate(new Date(now.getFullYear(), now.getMonth() - months + 1, 1));
    const to = this.formatDate(now);
    const costBase = `/subscriptions/${this.subscriptionId}/providers/Microsoft.CostManagement`;

    try {
      const data = await this.costQueryWithRetry(costBase, {
        type: 'ActualCost',
        timeframe: 'Custom',
        timePeriod: { from, to },
        dataset: {
          granularity: 'Monthly',
          aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
          filter: {
            dimensions: {
              name: 'ServiceName',
              operator: 'In',
              values: ['Azure Machine Learning'],
            },
          },
        },
      });

      const rows = this.parseCostRows(data, 'daily') as CostDataPoint[];
      return rows.map((r) => ({
        month: r.date.substring(0, 7),
        totalCost: r.cost,
        currency: r.currency,
        dailyCosts: [],
        byResourceGroup: [],
        byMeterCategory: [],
      }));
    } catch {
      return [];
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async costQueryWithRetry(costBase: string, body: any, isForecast = false, retries = 4): Promise<any> {
    const endpoint = isForecast ? `${costBase}/forecast` : `${costBase}/query`;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.client.post(endpoint, body, {
          params: { 'api-version': AZURE_COST_API_VERSION },
        });
        return response.data;
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const status = (err as any)?.response?.status;
        if (status === 429 && attempt < retries) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const retryAfter = parseInt((err as any)?.response?.headers?.['retry-after'] || '0', 10);
          const backoff = Math.max(retryAfter, 5) * (attempt + 1);
          await new Promise((r) => setTimeout(r, backoff * 1000));
          continue;
        }
        throw err;
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseCostRows(data: any, mode: 'daily' | 'grouped'): (CostDataPoint | CostBreakdownItem)[] {
    const columns: { name: string }[] = data?.properties?.columns || [];
    const rows: unknown[][] = data?.properties?.rows || [];

    const costIdx = columns.findIndex((c) => c.name === 'Cost');
    const currencyIdx = columns.findIndex((c) => c.name === 'Currency');
    const dateIdx = columns.findIndex((c) => c.name === 'UsageDate');
    const groupIdx = columns.findIndex((c) =>
      c.name === 'ResourceGroupName' || c.name === 'MeterCategory',
    );

    if (mode === 'daily') {
      return rows.map((row) => ({
        date: String(row[dateIdx] ?? '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
        cost: Number(row[costIdx] ?? 0),
        currency: String(row[currencyIdx] ?? 'USD'),
      }));
    }

    return rows.map((row) => ({
      name: String(row[groupIdx] ?? 'Unknown'),
      cost: Number(row[costIdx] ?? 0),
      currency: String(row[currencyIdx] ?? 'USD'),
    }));
  }

  private formatDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async cancelJob(
    resourceGroup: string,
    workspaceName: string,
    jobName: string,
  ): Promise<void> {
    const base = this.buildWorkspacePath(resourceGroup, workspaceName);
    const url = `${base}/jobs/${encodeURIComponent(jobName)}/cancel`;
    await this.client.post(url, {}, {
      params: { 'api-version': AZURE_ML_API_VERSION },
    });
  }

  private buildWorkspacePath(resourceGroup: string, workspaceName: string): string {
    return `/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.MachineLearningServices/workspaces/${workspaceName}`;
  }

  private buildMlflowPath(
    location: string,
    resourceGroup: string,
    workspaceName: string,
  ): string {
    const region = location.toLowerCase().replace(/\s/g, '');
    return `https://${region}.api.azureml.ms/mlflow/v1.0/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.MachineLearningServices/workspaces/${workspaceName}/api/2.0/mlflow`;
  }
}
