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

/**
 * Error thrown when a call through the MLflow SWA proxy fails.
 * Carries enough context to surface in the UI / logs without re-fetching.
 */
export class MlflowProxyError extends Error {
  url: string;
  status?: number;
  body?: unknown;
  constructor(message: string, url: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'MlflowProxyError';
    this.url = url;
    this.status = status;
    this.body = body;
  }
}

function describeAxiosError(err: unknown): { status?: number; body?: unknown; message: string } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  if (e?.isAxiosError) {
    return {
      status: e.response?.status,
      body: e.response?.data,
      message: e.message || 'Request failed',
    };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

// Tiny in-memory cache shared across instances. Keyed by an opaque string;
// each entry carries its own TTL. Used to avoid re-fetching MLflow run lists
// and log file contents on every screen refresh.
//
// Bounded to MAX_CACHE_ENTRIES with LRU-ish eviction (Map preserves insertion
// order; we delete-then-set on hit to move-to-end, and drop oldest on overflow).
// Without a cap, log bodies (potentially MBs each) accumulate as the user
// navigates between jobs and never get released.
type CacheEntry<T> = { value: T; expiresAt: number };
const MAX_CACHE_ENTRIES = 200;
const memoCache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function cacheTouch(key: string, entry: CacheEntry<unknown>): void {
  memoCache.delete(key);
  memoCache.set(key, entry);
}

function cacheEvictExpired(now: number): void {
  // Sweep expired entries opportunistically. Cheap because Map iteration is
  // O(n) and n is bounded by MAX_CACHE_ENTRIES.
  for (const [k, v] of memoCache) {
    if (v.expiresAt <= now) memoCache.delete(k);
  }
}

function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  const now = Date.now();
  cacheEvictExpired(now);
  cacheTouch(key, { value, expiresAt: now + ttlMs });
  while (memoCache.size > MAX_CACHE_ENTRIES) {
    const oldest = memoCache.keys().next().value;
    if (oldest === undefined) break;
    memoCache.delete(oldest);
  }
}

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = memoCache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > now) {
    cacheTouch(key, hit);
    return hit.value;
  }
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = (async () => {
    try {
      const value = await loader();
      cacheSet(key, value, ttlMs);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function clearAzureMLCache(prefix?: string): void {
  if (!prefix) {
    memoCache.clear();
    return;
  }
  for (const k of Array.from(memoCache.keys())) {
    if (k.startsWith(prefix)) memoCache.delete(k);
  }
}

// Test/debug helper — exposes current cache footprint for memory diagnostics.
export function getAzureMLCacheStats(): { entries: number; inflight: number } {
  return { entries: memoCache.size, inflight: inflight.size };
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

  // Build headers for MLflow proxy calls (uses X-Azure-Token since SWA strips Authorization)
  private mlflowHeaders(token: string, contentType?: string): Record<string, string> {
    const headers: Record<string, string> = { 'X-Azure-Token': token };
    if (contentType) headers['Content-Type'] = contentType;
    return headers;
  }

  // Find MLflow runs for a job — returns child runs for pipelines, or the run itself.
  // Cached for 30s per (mlflowBase, jobName) so metrics + logs tabs share one
  // upstream call and refreshes feel instant.
  private async findMlflowRuns(
    mlflowBase: string,
    token: string,
    jobName: string,
  ): Promise<Array<{ run_id: string; run_name: string; data: { metrics?: Array<{ key: string; value?: number; step?: number }> } }>> {
    return cached(`runs:${mlflowBase}:${jobName}`, 30_000, () =>
      this.findMlflowRunsUncached(mlflowBase, token, jobName),
    );
  }

  private async findMlflowRunsUncached(
    mlflowBase: string,
    token: string,
    jobName: string,
  ): Promise<Array<{ run_id: string; run_name: string; data: { metrics?: Array<{ key: string; value?: number; step?: number }> } }>> {
    const url = `${mlflowBase}/runs/search`;
    let resp;
    try {
      // rootRunId matches the ARM job name for both command and pipeline jobs
      resp = await axios.post(
        url,
        { filter: `tags.mlflow.rootRunId = '${jobName}'`, max_results: 50 },
        { headers: this.mlflowHeaders(token, 'application/json') },
      );
    } catch (err) {
      const { status, body, message } = describeAxiosError(err);
      console.warn(`[MLflow] runs/search failed: ${url} status=${status ?? 'n/a'} msg=${message} body=${JSON.stringify(body).substring(0, 300)}`);
      throw new MlflowProxyError(
        `MLflow runs/search failed (${status ?? 'no status'}): ${message}`,
        url,
        status,
        body,
      );
    }

    const allRuns = resp.data?.runs || [];
    if (allRuns.length === 0) return [];

    // For pipeline jobs: return only child runs (exclude parent which has no metrics)
    const childRuns = allRuns.filter(
      (r: { info: { run_id: string } }) => r.info.run_id !== jobName,
    );

    const runsToReturn = childRuns.length > 0 ? childRuns : allRuns;

    return runsToReturn.map((r: { info: { run_id: string }; data: unknown }) => {
      const tags = (r as { data?: { tags?: Array<{ key: string; value: string }> } }).data?.tags || [];
      const runName = tags.find((t: { key: string }) => t.key === 'mlflow.runName')?.value || r.info.run_id.substring(0, 8);
      return {
        run_id: r.info.run_id,
        run_name: runName,
        data: r.data as { metrics?: Array<{ key: string; value?: number; step?: number }> },
      };
    });
  }

  async getJobMetrics(
    resourceGroup: string,
    workspaceName: string,
    jobName: string,
    workspaceLocation?: string,
  ): Promise<Record<string, MetricSeries>> {
    if (!workspaceLocation) {
      console.warn('[Metrics] No workspaceLocation provided — returning empty result');
      return {};
    }

    const mlflowBase = this.buildMlflowPath(workspaceLocation, resourceGroup, workspaceName);
    const token = await this.getAccessToken();

    // Errors here propagate to the caller so the UI can render an error state
    // instead of a silently-empty list. Per-metric history failures still fall
    // back to the summary value below.
    const mlflowRuns = await this.findMlflowRuns(mlflowBase, token, jobName);
    console.warn(`[Metrics] Found ${mlflowRuns.length} MLflow runs for ${jobName} via ${mlflowBase}`);
    if (mlflowRuns.length === 0) return {};

    const result: Record<string, MetricSeries> = {};

    // MLflow serializes non-finite floats (NaN/Infinity/-Infinity) as STRINGS
    // in JSON. Number(NaN-string) -> NaN, which crashes chart-kit later via
    // value.toFixed(). Always coerce to a finite number, defaulting to 0.
    const toFiniteNumber = (v: unknown, fallback = 0): number => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : fallback;
    };

    // Build a flat list of (run, summary metric) tuples then fan out get-history
    // calls in parallel. The previous sequential loop made the wait scale
    // linearly with metric count.
    type Task = {
      runId: string;
      prefix: string;
      summary: { key: string; value?: number; step?: number };
    };
    const tasks: Task[] = [];
    for (const mlflowRun of mlflowRuns) {
      const prefix = mlflowRuns.length > 1 ? `${mlflowRun.run_name}/` : '';
      for (const m of mlflowRun.data?.metrics || []) {
        if (!m.key) continue;
        tasks.push({ runId: mlflowRun.run_id, prefix, summary: m });
      }
    }

    await Promise.all(tasks.map(async ({ runId, prefix, summary }) => {
      const metricKey = `${prefix}${summary.key}`;
      const cacheKey = `metric:${mlflowBase}:${runId}:${summary.key}`;
      try {
        const series = await cached(cacheKey, 15_000, async () => {
          const histResp = await axios.get(
            `${mlflowBase}/metrics/get-history`,
            {
              params: { run_id: runId, metric_key: summary.key },
              headers: this.mlflowHeaders(token),
            },
          );
          const points = histResp.data?.metrics || [];
          return points.map((p: { step?: number; value?: unknown; timestamp?: number }, i: number) => ({
            step: toFiniteNumber(p.step, i),
            value: toFiniteNumber(p.value, 0),
            timestamp: p.timestamp ? new Date(p.timestamp).toISOString() : '',
          }));
        });
        result[metricKey] = { name: metricKey, dataPoints: series as MetricSeries['dataPoints'] };
      } catch (err) {
        const { status, message } = describeAxiosError(err);
        console.warn(`[Metrics] get-history fallback for ${metricKey} (status=${status ?? 'n/a'}): ${message}`);
        result[metricKey] = {
          name: metricKey,
          dataPoints: [{
            step: toFiniteNumber(summary.step, 0),
            value: toFiniteNumber(summary.value, 0),
            timestamp: '',
          }],
        };
      }
    }));

    return result;
  }

  async getJobLogFiles(
    resourceGroup: string,
    workspaceName: string,
    jobName: string,
    workspaceLocation: string,
  ): Promise<LogFile[]> {
    const mlflowBase = this.buildMlflowPath(workspaceLocation, resourceGroup, workspaceName);
    const token = await this.getAccessToken();

    // Errors here propagate to the caller so the UI can render an error state
    // instead of a silently-empty list. The per-directory listArtifacts calls
    // below intentionally swallow 4xx since not every run has every dir.
    const mlflowRuns = await this.findMlflowRuns(mlflowBase, token, jobName);
    console.warn(`[Logs] Found ${mlflowRuns.length} MLflow runs for ${jobName} via ${mlflowBase}`);
    if (mlflowRuns.length === 0) return [];

    // Fan out per-run, per-directory listings in parallel. Recursive listings
    // also parallelize their child requests. With 3-4 known dirs + root + many
    // subdirs, this turns 10+ sequential round-trips into 1-2 waves.
    const allFiles = await Promise.all(mlflowRuns.map(async (mlflowRun) => {
      const runId = mlflowRun.run_id;
      const prefix = mlflowRuns.length > 1 ? `[${mlflowRun.run_name}] ` : '';

      const buildDownloadUrl = (filePath: string) => {
        const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
        return `${mlflowBase}-artifacts/artifacts/${encodedPath}?run_uuid=${encodeURIComponent(runId)}`;
      };

      const collected: LogFile[] = [];

      const listArtifacts = async (path?: string): Promise<void> => {
        const resp = await axios.get(`${mlflowBase}/artifacts/list`, {
          params: { run_id: runId, ...(path ? { path } : {}) },
          headers: this.mlflowHeaders(token),
        });
        const files = resp.data?.files || [];
        const recursions: Promise<void>[] = [];
        for (const file of files) {
          if (file.is_dir) {
            recursions.push(listArtifacts(file.path).catch(() => undefined));
          } else if (file.path?.endsWith('.txt') || file.path?.endsWith('.log')) {
            collected.push({ name: `${prefix}${file.path}`, url: buildDownloadUrl(file.path) });
          }
        }
        if (recursions.length) await Promise.all(recursions);
      };

      // Fan out the well-known top-level dirs + root in parallel; ignore 4xx
      // for dirs that don't exist on this run.
      await Promise.all([
        listArtifacts('user_logs').catch(() => undefined),
        listArtifacts('system_logs').catch(() => undefined),
        listArtifacts('logs').catch(() => undefined),
        listArtifacts().catch(() => undefined),
      ]);

      return collected;
    }));

    const logs = allFiles.flat();
    console.warn(`[Logs] Found ${logs.length} log files total`);
    return logs;
  }

  async getLogContent(url: string): Promise<string> {
    // Cache log bodies for 60s — log files for completed steps are immutable
    // and even running steps' logs only append slowly. A short TTL keeps the
    // viewer snappy when switching between files.
    return cached(`logbody:${url}`, 60_000, async () => {
      try {
        const token = await this.getAccessToken();
        const response = await axios.get(url, {
          responseType: 'text',
          timeout: 15000,
          headers: this.mlflowHeaders(token),
        });
        return typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data, null, 2);
      } catch {
        return '[Failed to load log content]';
      }
    });
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
    const mlflowSubpath = `subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.MachineLearningServices/workspaces/${workspaceName}/api/2.0/mlflow`;
    // Route through SWA API proxy to avoid CORS issues with api.azureml.ms
    return `/api/mlflow/${region}/${mlflowSubpath}`;
  }

  /** Returns the resolved MLflow proxy base path for diagnostics/UI display. */
  getMlflowDiagnostics(
    resourceGroup: string,
    workspaceName: string,
    workspaceLocation?: string,
  ): { mlflowBase: string | null } {
    if (!workspaceLocation) return { mlflowBase: null };
    return { mlflowBase: this.buildMlflowPath(workspaceLocation, resourceGroup, workspaceName) };
  }

  /**
   * Probes the MLflow proxy independently of any specific job by calling
   * `experiments/search` with max_results=1. Useful for confirming that the
   * proxy is reachable, the token has the right scope, and the MLflow URL/
   * version path is correct — without needing a job whose run actually exists.
   *
   * Returns a structured result instead of throwing so the UI can render it.
   */
  async probeMlflow(
    resourceGroup: string,
    workspaceName: string,
    workspaceLocation?: string,
  ): Promise<{
    ok: boolean;
    url: string | null;
    status?: number;
    message: string;
    experimentCount?: number;
    body?: unknown;
  }> {
    if (!workspaceLocation) {
      return { ok: false, url: null, message: 'No workspace location provided.' };
    }
    const mlflowBase = this.buildMlflowPath(workspaceLocation, resourceGroup, workspaceName);
    // Use runs/search rather than experiments/search: AzureML's MLflow gateway
    // doesn't implement the experiments/search endpoint and returns 404, which
    // produces a misleading "proxy broken" diagnostic. runs/search is part of
    // the same gateway as everything else we use, so it's the most accurate
    // smoke test.
    const url = `${mlflowBase}/runs/search`;
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, url, message: `Token fetch failed: ${msg}` };
    }
    try {
      const resp = await axios.post(
        url,
        { max_results: 1 },
        { headers: this.mlflowHeaders(token, 'application/json'), timeout: 15000 },
      );
      const runs = resp.data?.runs || [];
      return {
        ok: true,
        url,
        status: resp.status,
        message: `OK — proxy reachable, ${runs.length} run(s) returned (max 1).`,
        experimentCount: runs.length,
      };
    } catch (err) {
      const { status, body, message } = describeAxiosError(err);
      return {
        ok: false,
        url,
        status,
        message: `Probe failed (${status ?? 'no status'}): ${message}`,
        body,
      };
    }
  }
}
