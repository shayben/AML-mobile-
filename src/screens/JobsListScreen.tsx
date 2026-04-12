import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RootStackParamList, Run } from '../types';
import { AzureMLService } from '../services/azureMLService';
import { loadAuthTokens } from '../services/storageService';
import { REFRESH_INTERVALS } from '../constants';
import JobCard from '../components/JobCard';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Jobs'>;
  route: RouteProp<RootStackParamList, 'Jobs'>;
};

const STATUS_FILTERS = ['All', 'Running', 'Completed', 'Failed', 'Canceled'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function JobsListScreen({ navigation, route }: Props) {
  const { workspaceName, resourceGroup, workspaceLocation } = route.params;
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRuns = useCallback(
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
        const allJobs = await service.listJobs(resourceGroup, workspaceName);
        const data = statusFilter === 'All'
          ? allJobs
          : allJobs.filter((j) => j.status === statusFilter);
        setRuns(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load jobs.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [navigation, resourceGroup, workspaceName, statusFilter],
  );

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Auto-refresh when there are running jobs
  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === 'Running');
    if (hasRunning) {
      refreshTimer.current = setTimeout(() => fetchRuns(true), REFRESH_INTERVALS.JOBS_LIST_MS);
    }
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [runs, fetchRuns]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchRuns(true);
  };

  const handleSelectJob = (run: Run) => {
    navigation.navigate('JobDetails', {
      runId: run.runId,
      experimentName: run.experimentName,
      workspaceName,
      resourceGroup,
      workspaceLocation,
    });
  };

  if (loading) return <LoadingSpinner message="Loading jobs…" />;
  if (error) return <ErrorMessage message={error} onRetry={() => fetchRuns()} />;

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        {STATUS_FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, statusFilter === f && styles.filterChipActive]}
            onPress={() => setStatusFilter(f)}
            accessibilityRole="button"
            accessibilityLabel={`Filter by ${f}`}
          >
            <Text style={[styles.filterText, statusFilter === f && styles.filterTextActive]}>
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={runs}
        keyExtractor={(item) => item.runId}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        ListHeaderComponent={
          <Text style={styles.count}>
            {runs.length} job{runs.length !== 1 ? 's' : ''}
          </Text>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No jobs found.</Text>
          </View>
        }
        renderItem={({ item }) => <JobCard run={item} onPress={handleSelectJob} />}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F2F1',
    gap: 8,
    flexWrap: 'wrap',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F3F2F1',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterChipActive: {
    backgroundColor: '#EFF6FC',
    borderColor: '#0078D4',
  },
  filterText: {
    fontSize: 13,
    color: '#605E5C',
  },
  filterTextActive: {
    color: '#0078D4',
    fontWeight: '600',
  },
  count: {
    fontSize: 13,
    color: '#A19F9D',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  list: { flexGrow: 1, paddingBottom: 16 },
  empty: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 15,
    color: '#A19F9D',
  },
});
