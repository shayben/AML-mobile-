import React from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { MetricSeries } from '../types';

interface MetricChartProps {
  metric: MetricSeries;
}

const CHART_WIDTH = Dimensions.get('window').width - 32;
const CHART_HEIGHT = 200;
const MAX_LABELS = 6;
const MAX_POINTS = 50;

function downsample(points: MetricSeries['dataPoints'], maxCount: number) {
  if (points.length <= maxCount) return points;
  const step = Math.ceil(points.length / maxCount);
  const sampled = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
}

export default function MetricChart({ metric }: MetricChartProps) {
  const points = downsample(metric.dataPoints, MAX_POINTS);

  if (points.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No data points for "{metric.name}"</Text>
      </View>
    );
  }

  const labelStep = Math.max(1, Math.ceil(points.length / MAX_LABELS));
  const labels = points.map((p, i) =>
    i % labelStep === 0 ? String(p.step) : '',
  );
  const data = points.map((p) => p.value);

  const latestValue = data[data.length - 1];

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{metric.name}</Text>
        <Text style={styles.latestValue}>
          Latest: {latestValue !== undefined ? latestValue.toFixed(4) : '—'}
        </Text>
      </View>
      <LineChart
        data={{ labels, datasets: [{ data }] }}
        width={CHART_WIDTH}
        height={CHART_HEIGHT}
        chartConfig={{
          backgroundColor: '#fff',
          backgroundGradientFrom: '#fff',
          backgroundGradientTo: '#fff',
          decimalPlaces: 4,
          color: (opacity = 1) => `rgba(0, 120, 212, ${opacity})`,
          labelColor: () => '#605E5C',
          propsForDots: { r: '3', strokeWidth: '1', stroke: '#0078D4' },
          propsForBackgroundLines: { stroke: '#F3F2F1' },
        }}
        bezier
        style={styles.chart}
        withInnerLines
        withOuterLines={false}
        withShadow={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#201F1E',
    flex: 1,
  },
  latestValue: {
    fontSize: 13,
    color: '#0078D4',
    fontWeight: '600',
  },
  chart: {
    borderRadius: 8,
    marginLeft: -12,
  },
  empty: {
    padding: 16,
    alignItems: 'center',
  },
  emptyText: {
    color: '#A19F9D',
    fontSize: 13,
  },
});
