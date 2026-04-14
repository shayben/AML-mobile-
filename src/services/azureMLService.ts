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

  constructor(credentialsOrToken: AzureCredentials | { accessToken: string; subscriptionId: string }) {
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

  async getJobMetrics(
    resourceGroup: string,
    workspaceName: string,
    jobName: string,
    workspaceLocation?: string,
  ): Promise<Record<string, MetricSeries>> {
    if (!workspaceLocation) return {};

    try {
      const historyBase = this.buildRunHistoryPath(
        workspaceLocation,
        resourceGroup,
        workspaceName,
      );
      const token = await this.getAccessToken();

      // Try the run metrics endpoint
      const response = await axios.get(
        `${historyBase}/runmetrics`,
        {
          params: { 'runId': jobName },
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      const result: Record<string, MetricSeries> = {};
      const metricsData = response.data?.value || response.data?.metrics || [];

      if (Array.isArray(metricsData)) {
        for (const m of metricsData) {
          const name = m.metricName || m.name;
          if (!name) continue;

          if (!result[name]) {
            result[name] = { name, dataPoints: [] };
          }

          if (m.cells) {
            // Tabular format: cells is an array of {metricName, step, value, timestamp}
            for (const cell of m.cells) {
              result[name].dataPoints.push({
                step: cell.step ?? result[name].dataPoints.length,
                value: typeof cell[name] === 'number' ? cell[name] : (cell.value ?? 0),
                timestamp: cell.timestamp || cell.createdUtc || '',
              });
            }
          } else {
            result[name].dataPoints.push({
              step: m.step ?? 0,
              value: m.value ?? m.numerator ?? 0,
              timestamp: m.createdUtc || m.timestamp || '',
            });
          }
        }
      } else if (typeof response.data === 'object') {
        // Handle dict-style response {metricName: [{step, value}]}
        for (const [name, values] of Object.entries(response.data)) {
          if (name.startsWith('$') || name === 'runId') continue;
          if (Array.isArray(values)) {
            result[name] = {
              name,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              dataPoints: (values as any[]).map((v, i) => ({
                step: v.step ?? i,
                value: v.value ?? v ?? 0,
                timestamp: v.timestamp || '',
              })),
            };
          }
        }
      }

      return result;
    } catch {
      // Fall back to empty metrics if run history API is unavailable
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
      const historyBase = this.buildRunHistoryPath(
        workspaceLocation,
        resourceGroup,
        workspaceName,
      );
      const token = await this.getAccessToken();

      const response = await axios.get(
        `${historyBase}/runs/${encodeURIComponent(jobName)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      const logFiles: Record<string, string> = response.data?.logFiles || {};
      return Object.entries(logFiles).map(([name, url]) => ({
        name,
        url,
      }));
    } catch {
      return [];
    }
  }

  async getLogContent(url: string): Promise<string> {
    try {
      const response = await axios.get(url, {
        responseType: 'text',
        timeout: 15000,
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

    // Fetch daily costs + by resource group + by meter category in parallel
    const [dailyResp, rgResp, meterResp] = await Promise.all([
      this.client.post(`${costBase}/query`, {
        type: 'ActualCost',
        timeframe: 'Custom',
        timePeriod: { from, to },
        dataset: {
          granularity: 'Daily',
          aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
          filter: mlFilter,
        },
      }, { params: { 'api-version': AZURE_COST_API_VERSION } }),

      this.client.post(`${costBase}/query`, {
        type: 'ActualCost',
        timeframe: 'Custom',
        timePeriod: { from, to },
        dataset: {
          granularity: 'None',
          aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
          grouping: [{ type: 'Dimension', name: 'ResourceGroupName' }],
          filter: mlFilter,
        },
      }, { params: { 'api-version': AZURE_COST_API_VERSION } }),

      this.client.post(`${costBase}/query`, {
        type: 'ActualCost',
        timeframe: 'Custom',
        timePeriod: { from, to },
        dataset: {
          granularity: 'None',
          aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
          grouping: [{ type: 'Dimension', name: 'MeterCategory' }],
          filter: mlFilter,
        },
      }, { params: { 'api-version': AZURE_COST_API_VERSION } }),
    ]);

    const dailyCosts = this.parseCostRows(dailyResp.data, 'daily');
    const byResourceGroup = this.parseCostRows(rgResp.data, 'grouped') as CostBreakdownItem[];
    const byMeterCategory = this.parseCostRows(meterResp.data, 'grouped') as CostBreakdownItem[];

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
      const response = await this.client.post(`${costBase}/forecast`, {
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
      }, { params: { 'api-version': AZURE_COST_API_VERSION } });

      const dailyForecast = this.parseCostRows(response.data, 'daily') as CostDataPoint[];
      const estimatedCost = dailyForecast.reduce((sum, d) => sum + d.cost, 0);
      const currency = dailyForecast[0]?.currency || 'USD';

      return { month: monthStr, estimatedCost, currency, dailyForecast };
    } catch {
      return { month: monthStr, estimatedCost: 0, currency: 'USD', dailyForecast: [] };
    }
  }

  async getMultiMonthCosts(months = 6): Promise<MonthlyCostSummary[]> {
    const results: MonthlyCostSummary[] = [];
    // Fetch sequentially to avoid rate limiting
    for (let i = 0; i < months; i++) {
      try {
        const summary = await this.getMonthlyCosts(i);
        results.push(summary);
      } catch {
        break; // Stop if we hit an error (e.g., no data for older months)
      }
    }
    return results.reverse(); // Oldest first
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

  private buildRunHistoryPath(
    location: string,
    resourceGroup: string,
    workspaceName: string,
  ): string {
    const region = location.toLowerCase().replace(/\s/g, '');
    return `https://${region}.api.azureml.ms/history/v1.0/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.MachineLearningServices/workspaces/${workspaceName}`;
  }
}
