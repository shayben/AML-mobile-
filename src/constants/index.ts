export const AZURE_AUTH_URL = 'https://login.microsoftonline.com';
export const AZURE_MANAGEMENT_URL = 'https://management.azure.com';
export const AZURE_ML_SCOPE = 'https://management.azure.com/.default';
export const AZURE_ML_API_VERSION = '2023-10-01';
// The metrics/runs API is only available in the preview version; no GA equivalent exists yet.
export const AZURE_ML_METRICS_API_VERSION = '2020-09-01-preview';

export const STORAGE_KEYS = {
  CREDENTIALS: '@aml_credentials',
  SELECTED_WORKSPACE: '@aml_selected_workspace',
} as const;

export const REFRESH_INTERVALS = {
  RUNNING_JOB_METRICS_MS: 15000,
  JOBS_LIST_MS: 30000,
} as const;

export const RUN_STATUS_COLORS: Record<string, string> = {
  Running: '#0078D4',
  Completed: '#107C10',
  Failed: '#A80000',
  Canceled: '#797775',
  Queued: '#FFB900',
  Preparing: '#0078D4',
  Starting: '#0078D4',
  Provisioning: '#0078D4',
  CancelRequested: '#FFB900',
  NotStarted: '#797775',
};
