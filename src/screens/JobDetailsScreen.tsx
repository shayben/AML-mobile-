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
import { AzureMLService } from '../services/azureMLService';
import { loadAuthTokens } from '../services/storageService';
import { REFRESH_INTERVALS, RUN_STATUS_COLORS } from '../constants';
import MetricChart from '../components/MetricChart';
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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabName>('info');
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serviceRef = useRef<AzureMLService | null>(null);

  const fetchData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const tokens = await loadAuthTokens();
        if (!tokens || !tokens.subscriptionId) {
          navigation.replace('Login');
          return;
        }
        const service = new AzureMLService({
          accessToken: tokens.accessToken,
          subscriptionId: tokens.subscriptionId,
        });
        serviceRef.current = service;

        const [runDetails, runMetrics, runLogs, jobOutputs] = await Promise.all([
          service.getJobDetails(resourceGroup, workspaceName, runId),
          service.getJobMetrics(resourceGroup, workspaceName, runId, workspaceLocation),
          service.getJobLogFiles(resourceGroup, workspaceName, runId, workspaceLocation),
          service.getJobOutputs(resourceGroup, workspaceName, runId),
        ]);
        setRun(runDetails);
        setMetrics(runMetrics);
        setLogFiles(runLogs);
        setOutputs(jobOutputs);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load job details.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [navigation, resourceGroup, workspaceName, runId, experimentName, workspaceLocation],
  );

  useEffect(() => {
    fetchData();
    navigation.setOptions({ title: runId });
  }, [fetchData, navigation, runId]);

  // Auto-refresh for running jobs
  useEffect(() => {
    if (run?.status === 'Running') {
      refreshTimer.current = setTimeout(
        () => fetchData(true),
        REFRESH_INTERVALS.RUNNING_JOB_METRICS_MS,
      );
    }
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [run, fetchData]);

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
            fetchData(true);
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
  if (error) return <ErrorMessage message={error} onRetry={() => fetchData()} />;
  if (!run) return null;

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData(true);
  };

  const statusColor = RUN_STATUS_COLORS[run.status] || '#797775';
  const isRunning = run.status === 'Running';
  const metricNames = Object.keys(metrics);

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
          </Text>
          {metricNames.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No metrics recorded yet.</Text>
              <Text style={styles.emptyHint}>
                Metrics appear when the job logs them via MLflow or the Azure ML SDK.
              </Text>
            </View>
          ) : (
            metricNames.map((name) => (
              <MetricChart key={name} metric={metrics[name]} />
            ))
          )}
        </View>
      )}

      {/* Logs Tab */}
      {activeTab === 'logs' && (
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>
            Log Files {logFiles.length > 0 ? `— ${logFiles.length} files` : ''}
          </Text>
          {serviceRef.current ? (
            <LogViewer logFiles={logFiles} service={serviceRef.current} />
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>Loading...</Text>
            </View>
          )}
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
