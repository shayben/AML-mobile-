export interface AzureCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
}

export interface Workspace {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  subscriptionId: string;
}

export interface Run {
  runId: string;
  displayName?: string;
  status: RunStatus;
  startTimeUtc?: string;
  endTimeUtc?: string;
  experimentName: string;
  runType?: string;
  tags?: Record<string, string>;
  properties?: Record<string, string>;
}

export type RunStatus =
  | 'Running'
  | 'Completed'
  | 'Failed'
  | 'Canceled'
  | 'Queued'
  | 'Preparing'
  | 'Starting'
  | 'Provisioning'
  | 'CancelRequested'
  | 'NotStarted';

export interface RunMetric {
  metricId: string;
  dataContainerId: string;
  metricType: string;
  createdUtc: string;
  name: string;
  description: string;
  label: string;
  numerator: number;
  denominator: number;
  value: number;
}

export interface MetricDataPoint {
  step: number;
  value: number;
  timestamp: string;
}

export interface MetricSeries {
  name: string;
  dataPoints: MetricDataPoint[];
}

export interface RunDetails extends Run {
  description?: string;
  target?: string;
  logFiles?: Record<string, string>;
  metrics?: Record<string, MetricSeries>;
}

export interface Experiment {
  experimentId: string;
  name: string;
  description?: string;
  createdUtc: string;
  lastModifiedUtc: string;
}

export type RootStackParamList = {
  Login: undefined;
  Workspaces: undefined;
  Jobs: { workspaceName: string; resourceGroup: string };
  JobDetails: { runId: string; experimentName: string; workspaceName: string; resourceGroup: string };
};
