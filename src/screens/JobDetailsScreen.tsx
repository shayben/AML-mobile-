import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RootStackParamList, RunDetails, MetricSeries, LogFile, JobOutput } from '../types';
import { AzureMLService, MlflowProxyError } from '../services/azureMLService';
import { loadAuthTokens } from '../services/storageService';
import { REFRESH_INTERVALS, RUN_STATUS_COLORS } from '../constants';
import MetricChart from '../components/MetricChart';
import SafeChart from '../components/SafeChart';
import LogViewer from '../components/LogViewer';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'JobDetails'>;
  route: RouteProp<RootStackParamList, 'JobDetails'>;
};

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString();
}

function getDuration(start?: string, end?: string): string {
  if (!start) return '—';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const ms = e - s;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

type TabName = 'info' | 'metrics' | 'logs' | 'outputs';

export default function JobDetailsScreen({ navigation, route }: Props) {
  const { runId, experimentName, workspaceName, resourceGroup, workspaceLocation } = route.params;
  const [run, setRun] = useState<RunDetails | null>(null);
  const [metrics, setMetrics] = useState<Record<string, MetricSeries>>({});
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [outputs, setOutputs] = useState<JobOutput[]>([]);
  const [loading, setLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [metricsLoaded, setMetricsLoaded] = useState(false);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabName>('info');
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serviceRef = useRef<AzureMLService | null>(null);
  const serviceTokenRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Build (or reuse) a service for the current access token. Recreating an
  // axios-backed client on every refresh leaks instances + their pending
  // request callbacks until GC catches up.
  const getService = useCallback(async (): Promise<AzureMLService | null> => {
    const tokens = await loadAuthTokens();
    if (!tokens || !tokens.subscriptionId) {
      navigation.replace('Login');
      return null;
    }
    if (!serviceRef.current || serviceTokenRef.current !== tokens.accessToken) {
      serviceRef.current = new AzureMLService({
        accessToken: tokens.accessToken,
        subscriptionId: tokens.subscriptionId,
      });
      serviceTokenRef.current = tokens.accessToken;
    }
    return serviceRef.current;
  }, [navigation]);

  // Fast load: job details + outputs (ARM API only, no cold start)
  const fetchCore = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const service = await getService();
        if (!service) return;

        const [runDetails, jobOutputs] = await Promise.all([
          service.getJobDetails(resourceGroup, workspaceName, runId),
          service.getJobOutputs(resourceGroup, workspaceName, runId),
        ]);
        if (!mountedRef.current) return;
        setRun(runDetails);
        setOutputs(jobOutputs);
        setError(null);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load job details.');
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [getService, resourceGroup, workspaceName, runId],
  );

  // Lazy load: metrics (MLflow proxy, may have cold start)
  const fetchMetrics = useCallback(async () => {
    if (!serviceRef.current || metricsLoaded) return;
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const result = await serviceRef.current.getJobMetrics(
        resourceGroup, workspaceName, runId, workspaceLocation,
      );
      if (!mountedRef.current) return;
      setMetrics(result);
      setMetricsLoaded(true);
    } catch (err) {
      if (!mountedRef.current) return;
      const detail = err instanceof MlflowProxyError
        ? `${err.message} [url=${err.url} status=${err.status ?? 'n/a'}]`
        : err instanceof Error ? err.message : 'Failed to load metrics.';
      console.warn('[JobDetails] metrics error:', detail);
      setMetricsError(detail);
    }
    if (mountedRef.current) setMetricsLoading(false);
  }, [resourceGroup, workspaceName, runId, workspaceLocation, metricsLoaded]);

  // Lazy load: logs (MLflow proxy, may have cold start)
  const fetchLogs = useCallback(async () => {
    if (!serviceRef.current || logsLoaded) return;
    setLogsLoading(true);
    setLogsError(null);
    try {
      const result = await serviceRef.current.getJobLogFiles(
        resourceGroup, workspaceName, runId, workspaceLocation,
      );
      if (!mountedRef.current) return;
      setLogFiles(result);
      setLogsLoaded(true);
    } catch (err) {
      if (!mountedRef.current) return;
      const detail = err instanceof MlflowProxyError
        ? `${err.message} [url=${err.url} status=${err.status ?? 'n/a'}]`
        : err instanceof Error ? err.message : 'Failed to load logs.';
      console.warn('[JobDetails] logs error:', detail);
      setLogsError(detail);
    }
    if (mountedRef.current) setLogsLoading(false);
  }, [resourceGroup, workspaceName, runId, workspaceLocation, logsLoaded]);

  useEffect(() => {
    fetchCore();
    navigation.setOptions({ title: runId });
  }, [fetchCore, navigation, runId]);

  // Fetch metrics/logs when tab is selected
  useEffect(() => {
    if (activeTab === 'metrics') fetchMetrics();
    if (activeTab === 'logs') fetchLogs();
  }, [activeTab, fetchMetrics, fetchLogs]);

  // Auto-refresh for running jobs.
  // Depend ONLY on run?.status (a primitive) — depending on the full `run`
  // object would re-fire the effect every refresh because setRun produces a
  // new object reference, which re-schedules the timer and cascades.
  const isRunningStatus = run?.status === 'Running';
  useEffect(() => {
    if (!isRunningStatus) return;
    refreshTimer.current = setTimeout(
      () => {
        fetchCore(true);
        // Also refresh metrics/logs if those tabs were loaded
        setMetricsLoaded((prev) => (prev ? false : prev));
        setLogsLoaded((prev) => (prev ? false : prev));
      },
      REFRESH_INTERVALS.RUNNING_JOB_METRICS_MS,
    );
    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [isRunningStatus, fetchCore]);

  const handleCancel = async () => {
    Alert.alert('Cancel Job', 'Are you sure you want to cancel this job?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            const tokens = await loadAuthTokens();
            if (!tokens || !tokens.subscriptionId) return;
            const service = new AzureMLService({
              accessToken: tokens.accessToken,
              subscriptionId: tokens.subscriptionId,
            });
            await service.cancelJob(resourceGroup, workspaceName, runId);
            fetchCore(true);
          } catch (err) {
            Alert.alert(
              'Error',
              err instanceof Error ? err.message : 'Failed to cancel job.',
            );
          }
        },
      },
    ]);
  };

  if (loading) return <LoadingSpinner message="Loading job details…" />;
  if (error) return <ErrorMessage message={error} onRetry={() => fetchCore()} />;
  if (!run) return null;

  const handleRefresh = () => {
    setRefreshing(true);
    setMetricsLoaded(false);
    setLogsLoaded(false);
    setMetricsError(null);
    setLogsError(null);
    fetchCore(true);
  };

  const statusColor = RUN_STATUS_COLORS[run.status] || '#797775';
  const isRunning = run.status === 'Running';
  const metricNames = Object.keys(metrics);
  const mlflowDiagnostics = serviceRef.current?.getMlflowDiagnostics(
    resourceGroup, workspaceName, workspaceLocation,
  );
  const mlflowBase = mlflowDiagnostics?.mlflowBase ?? null;

  const handleProbe = async () => {
    if (!serviceRef.current) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const r = await serviceRef.current.probeMlflow(
        resourceGroup, workspaceName, workspaceLocation,
      );
      setProbeResult(`${r.ok ? '✓' : '✗'} ${r.message}${r.url ? `\nURL: ${r.url}` : ''}`);
    } catch (err) {
      setProbeResult(`✗ Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    }
    setProbing(false);
  };

  const renderDiagnostics = () => mlflowBase && (
    <View style={styles.diagnosticsBlock}>
      <Text style={styles.diagnostics} selectable>MLflow base: {mlflowBase}</Text>
      <TouchableOpacity
        style={styles.probeButton}
        onPress={handleProbe}
        disabled={probing}
        accessibilityRole="button"
      >
        <Text style={styles.probeButtonText}>
          {probing ? 'Probing…' : 'Probe MLflow'}
        </Text>
      </TouchableOpacity>
      {probeResult && (
        <Text style={styles.diagnostics} selectable>{probeResult}</Text>
      )}
    </View>
  );

  const tabs: { key: TabName; label: string; badge?: number }[] = [
    { key: 'info', label: 'Info' },
    { key: 'metrics', label: 'Metrics', badge: metricNames.length },
    { key: 'logs', label: 'Logs', badge: logFiles.length },
    { key: 'outputs', label: 'Outputs', badge: outputs.length },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      {/* Status Banner */}
      <View style={[styles.statusBanner, { backgroundColor: statusColor }]}>
        {isRunning && <View style={styles.runningDot} />}
        <Text style={styles.statusBannerText}>{run.status}</Text>
        {isRunning && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel job"
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
            accessibilityRole="tab"
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 ? ` (${tab.badge})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Info Tab */}
      {activeTab === 'info' && (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Job Info</Text>
            <InfoRow label="Run ID" value={run.runId} />
            <InfoRow label="Display Name" value={run.displayName} />
            <InfoRow label="Experiment" value={run.experimentName} />
            <InfoRow label="Type" value={run.runType} />
            <InfoRow label="Target" value={run.target} />
            <InfoRow label="Started" value={formatDate(run.startTimeUtc)} />
            <InfoRow label="Ended" value={run.endTimeUtc ? formatDate(run.endTimeUtc) : '—'} />
            <InfoRow
              label="Duration"
              value={getDuration(run.startTimeUtc, run.endTimeUtc)}
            />
          </View>

          {run.tags && Object.keys(run.tags).length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Tags</Text>
              {Object.entries(run.tags).map(([k, v]) => (
                <InfoRow key={k} label={k} value={v} />
              ))}
            </View>
          ) : null}

          {run.properties && Object.keys(run.properties).length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Properties</Text>
              {Object.entries(run.properties).map(([k, v]) => (
                <InfoRow key={k} label={k} value={v} />
              ))}
            </View>
          ) : null}
        </>
      )}

      {/* Metrics Tab */}
      {activeTab === 'metrics' && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>
            Metrics {isRunning ? '(auto-refreshing)' : ''}
            {metricNames.length > 0 ? ` — ${metricNames.length} series` : ''}
            {metricsLoading && metricNames.length > 0 ? '  ⟳ refreshing…' : ''}
          </Text>
          {metricsLoading && metricNames.length === 0 ? (
            <LoadingSpinner message="Loading metrics…" />
          ) : metricsError && metricNames.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>Failed to load metrics.</Text>
              <Text style={styles.emptyHint} selectable>{metricsError}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => { setMetricsLoaded(false); fetchMetrics(); }}
                accessibilityRole="button"
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : metricNames.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No metrics recorded yet.</Text>
              <Text style={styles.emptyHint}>
                Metrics appear when the job logs them via MLflow or the Azure ML SDK.
              </Text>
            </View>
          ) : (
            <>
              {metricsError && (
                <View style={styles.warningBanner}>
                  <Text style={styles.warningBannerText} selectable>
                    Last refresh failed — showing previous data. {metricsError}
                  </Text>
                </View>
              )}
              {metricNames.map((name) => (
                <SafeChart key={name} name={name}>
                  <MetricChart metric={metrics[name]} />
                </SafeChart>
              ))}
            </>
          )}
          {renderDiagnostics()}
        </View>
      )}

      {/* Logs Tab */}
      {activeTab === 'logs' && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>
            Log Files {logFiles.length > 0 ? `— ${logFiles.length} files` : ''}
            {logsLoading && logFiles.length > 0 ? '  ⟳ refreshing…' : ''}
          </Text>
          {logsLoading && logFiles.length === 0 ? (
            <LoadingSpinner message="Loading logs…" />
          ) : logsError && logFiles.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>Failed to load logs.</Text>
              <Text style={styles.emptyHint} selectable>{logsError}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => { setLogsLoaded(false); fetchLogs(); }}
                accessibilityRole="button"
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : serviceRef.current ? (
            <>
              {logsError && (
                <View style={styles.warningBanner}>
                  <Text style={styles.warningBannerText} selectable>
                    Last refresh failed — showing previous data. {logsError}
                  </Text>
                </View>
              )}
              <LogViewer logFiles={logFiles} service={serviceRef.current} />
            </>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>Loading...</Text>
            </View>
          )}
          {renderDiagnostics()}
        </View>
      )}

      {/* Outputs Tab */}
      {activeTab === 'outputs' && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>
            Outputs {outputs.length > 0 ? `— ${outputs.length} items` : ''}
          </Text>
          {outputs.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No outputs defined for this job.</Text>
            </View>
          ) : (
            outputs.map((output) => (
              <View key={output.name} style={styles.outputCard}>
                <View style={styles.outputHeader}>
                  <Text style={styles.outputName}>{output.name}</Text>
                  <View style={styles.outputBadge}>
                    <Text style={styles.outputBadgeText}>{output.type}</Text>
                  </View>
                </View>
                {output.uri && (
                  <Text style={styles.outputUri} numberOfLines={3} selectable>
                    {output.uri}
                  </Text>
                )}
                {output.mode && (
                  <Text style={styles.outputMeta}>Mode: {output.mode}</Text>
                )}
                {output.description && (
                  <Text style={styles.outputMeta}>{output.description}</Text>
                )}
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2} selectable>
        {value || '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },
  content: { paddingBottom: 32 },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  runningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    marginRight: 8,
  },
  statusBannerText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  cancelButton: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F2F1',
    paddingHorizontal: 8,
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#0078D4',
  },
  tabText: {
    fontSize: 14,
    color: '#605E5C',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#0078D4',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#fff',
    margin: 16,
    marginBottom: 0,
    borderRadius: 10,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#201F1E',
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F2F1',
  },
  infoLabel: {
    fontSize: 13,
    color: '#A19F9D',
    width: 110,
  },
  infoValue: {
    fontSize: 13,
    color: '#201F1E',
    flex: 1,
  },
  section: {
    margin: 16,
    marginTop: 16,
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: '700',
    color: '#201F1E',
    marginBottom: 12,
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#A19F9D',
  },
  emptyHint: {
    fontSize: 12,
    color: '#C8C6C4',
    marginTop: 8,
    textAlign: 'center',
  },
  diagnostics: {
    fontSize: 11,
    color: '#A19F9D',
    marginTop: 12,
    marginHorizontal: 4,
    fontFamily: 'monospace',
  },
  diagnosticsBlock: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F2F1',
  },
  probeButton: {
    alignSelf: 'flex-start',
    marginTop: 6,
    backgroundColor: '#EFF6FC',
    borderWidth: 1,
    borderColor: '#0078D4',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  probeButtonText: {
    color: '#0078D4',
    fontSize: 12,
    fontWeight: '600',
  },
  retryButton: {
    marginTop: 12,
    backgroundColor: '#0078D4',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  warningBanner: {
    backgroundColor: '#FFF4CE',
    borderLeftWidth: 3,
    borderLeftColor: '#D8A000',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    marginBottom: 12,
  },
  warningBannerText: {
    fontSize: 12,
    color: '#3B3A39',
  },
  outputCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F3F2F1',
  },
  outputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  outputName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#201F1E',
    flex: 1,
  },
  outputBadge: {
    backgroundColor: '#EFF6FC',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  outputBadgeText: {
    fontSize: 11,
    color: '#0078D4',
    fontWeight: '600',
  },
  outputUri: {
    fontSize: 11,
    color: '#605E5C',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  outputMeta: {
    fontSize: 12,
    color: '#A19F9D',
  },
});
