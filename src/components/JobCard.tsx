import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Run } from '../types';
import { RUN_STATUS_COLORS } from '../constants';

interface JobCardProps {
  run: Run;
  onPress: (run: Run) => void;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString();
}

function getDuration(run: Run): string {
  if (!run.startTimeUtc) return '—';
  const start = new Date(run.startTimeUtc).getTime();
  const end = run.endTimeUtc ? new Date(run.endTimeUtc).getTime() : Date.now();
  const durationMs = end - start;
  const hours = Math.floor(durationMs / 3600000);
  const minutes = Math.floor((durationMs % 3600000) / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export default function JobCard({ run, onPress }: JobCardProps) {
  const statusColor = RUN_STATUS_COLORS[run.status] || '#797775';
  const isRunning = run.status === 'Running';

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(run)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Job ${run.displayName || run.runId}, status ${run.status}`}
    >
      <View style={styles.header}>
        <Text style={styles.runName} numberOfLines={1}>
          {run.displayName || run.runId}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          {isRunning && <View style={styles.runningDot} />}
          <Text style={styles.statusText}>{run.status}</Text>
        </View>
      </View>
      <Text style={styles.experimentName} numberOfLines={1}>
        Experiment: {run.experimentName || '—'}
      </Text>
      <View style={styles.timeRow}>
        <Text style={styles.timeLabel}>Started:</Text>
        <Text style={styles.timeValue}>{formatDate(run.startTimeUtc)}</Text>
      </View>
      <View style={styles.timeRow}>
        <Text style={styles.timeLabel}>Duration:</Text>
        <Text style={styles.timeValue}>{getDuration(run)}</Text>
      </View>
      {run.runType ? (
        <View style={styles.tagRow}>
          <Text style={styles.tag}>{run.runType}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginVertical: 6,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  runName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#201F1E',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  runningDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fff',
    marginRight: 4,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  experimentName: {
    fontSize: 13,
    color: '#605E5C',
    marginBottom: 6,
  },
  timeRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  timeLabel: {
    fontSize: 12,
    color: '#A19F9D',
    width: 68,
  },
  timeValue: {
    fontSize: 12,
    color: '#605E5C',
  },
  tagRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  tag: {
    backgroundColor: '#F3F2F1',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 11,
    color: '#605E5C',
  },
});
