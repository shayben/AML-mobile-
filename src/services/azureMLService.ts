import axios, { AxiosInstance } from 'axios';
import {
  AZURE_AUTH_URL,
  AZURE_MANAGEMENT_URL,
  AZURE_ML_API_VERSION,
  AZURE_ML_SCOPE,
} from '../constants';
import {
  AzureCredentials,
  JobOutput,
  LogFile,
  MetricSeries,
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
