import axios, { AxiosInstance } from 'axios';
import {
  AZURE_AUTH_URL,
  AZURE_MANAGEMENT_URL,
  AZURE_ML_API_VERSION,
  AZURE_ML_METRICS_API_VERSION,
  AZURE_ML_SCOPE,
} from '../constants';
import {
  AzureCredentials,
  Experiment,
  MetricDataPoint,
  MetricSeries,
  Run,
  RunDetails,
  Workspace,
} from '../types';

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class AzureMLService {
  private credentials: AzureCredentials;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private client: AxiosInstance;

  constructor(credentials: AzureCredentials) {
    this.credentials = credentials;
    this.client = axios.create({ baseURL: AZURE_MANAGEMENT_URL });
    this.client.interceptors.request.use(async (config) => {
      const token = await this.getAccessToken();
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
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

  async listWorkspaces(): Promise<Workspace[]> {
    const url = `/subscriptions/${this.credentials.subscriptionId}/providers/Microsoft.MachineLearningServices/workspaces`;
    const response = await this.client.get(url, {
      params: { 'api-version': AZURE_ML_API_VERSION },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (response.data.value || []).map((ws: any): Workspace => ({
      id: ws.id,
      name: ws.name,
      resourceGroup: ws.id.split('/')[4],
      location: ws.location,
      subscriptionId: this.credentials.subscriptionId,
    }));
  }

  async listExperiments(resourceGroup: string, workspaceName: string): Promise<Experiment[]> {
    const base = this.buildWorkspacePath(resourceGroup, workspaceName);
    const url = `${base}/experiments`;
    const response = await this.client.get(url, {
      params: { 'api-version': AZURE_ML_METRICS_API_VERSION },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (response.data.value || []).map((exp: any): Experiment => ({
      experimentId: exp.experimentId || exp.name,
      name: exp.name,
      description: exp.description,
      createdUtc: exp.createdUtc,
      lastModifiedUtc: exp.lastModifiedUtc,
    }));
  }

  async listRuns(
    resourceGroup: string,
    workspaceName: string,
    filter?: string,
  ): Promise<Run[]> {
    const base = this.buildWorkspacePath(resourceGroup, workspaceName);
    const url = `${base}/runs`;
    const params: Record<string, string> = {
      'api-version': AZURE_ML_METRICS_API_VERSION,
    };
    if (filter) params['$filter'] = filter;

    const response = await this.client.get(url, { params });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (response.data.value || []).map((run: any): Run => ({
      runId: run.runId,
      displayName: run.displayName || run.runId,
      status: run.status,
      startTimeUtc: run.startTimeUtc,
      endTimeUtc: run.endTimeUtc,
      experimentName: run.experimentName || run.experiment || '',
      runType: run.runType,
      tags: run.tags,
      properties: run.properties,
    }));
  }

  async getRunDetails(
    resourceGroup: string,
    workspaceName: string,
    runId: string,
    experimentName: string,
  ): Promise<RunDetails> {
    const base = this.buildWorkspacePath(resourceGroup, workspaceName);
    const url = `${base}/experiments/${encodeURIComponent(experimentName)}/runs/${encodeURIComponent(runId)}`;
    const response = await this.client.get(url, {
      params: { 'api-version': AZURE_ML_METRICS_API_VERSION },
    });
    const run = response.data;

    return {
      runId: run.runId,
      displayName: run.displayName || run.runId,
      status: run.status,
      startTimeUtc: run.startTimeUtc,
      endTimeUtc: run.endTimeUtc,
      experimentName: experimentName,
      runType: run.runType,
      tags: run.tags,
      properties: run.properties,
      description: run.description,
      target: run.target,
      logFiles: run.logFiles,
    };
  }

  async getRunMetrics(
    resourceGroup: string,
    workspaceName: string,
    runId: string,
    experimentName: string,
  ): Promise<Record<string, MetricSeries>> {
    const base = this.buildWorkspacePath(resourceGroup, workspaceName);
    const url = `${base}/experiments/${encodeURIComponent(experimentName)}/runs/${encodeURIComponent(runId)}/metrics`;
    const response = await this.client.get(url, {
      params: { 'api-version': AZURE_ML_METRICS_API_VERSION },
    });

    const metricsMap: Record<string, MetricSeries> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metrics: any[] = response.data.value || [];

    for (const metric of metrics) {
      const name: string = metric.name;
      if (!metricsMap[name]) {
        metricsMap[name] = { name, dataPoints: [] };
      }
      const dataPoint: MetricDataPoint = {
        step: metric.step ?? metricsMap[name].dataPoints.length,
        value: metric.value ?? (Array.isArray(metric.cells) ? metric.cells[0]?.value : metric.value),
        timestamp: metric.utcTimeStamp || metric.createdUtc || new Date().toISOString(),
      };
      metricsMap[name].dataPoints.push(dataPoint);
    }

    for (const key of Object.keys(metricsMap)) {
      metricsMap[key].dataPoints.sort((a, b) => a.step - b.step);
    }

    return metricsMap;
  }

  async cancelRun(
    resourceGroup: string,
    workspaceName: string,
    runId: string,
    experimentName: string,
  ): Promise<void> {
    const base = this.buildWorkspacePath(resourceGroup, workspaceName);
    const url = `${base}/experiments/${encodeURIComponent(experimentName)}/runs/${encodeURIComponent(runId)}/cancel`;
    await this.client.post(url, {}, {
      params: { 'api-version': AZURE_ML_METRICS_API_VERSION },
    });
  }

  private buildWorkspacePath(resourceGroup: string, workspaceName: string): string {
    return `/subscriptions/${this.credentials.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.MachineLearningServices/workspaces/${workspaceName}`;
  }
}
