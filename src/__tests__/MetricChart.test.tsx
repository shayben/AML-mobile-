import React from 'react';
import { render } from '@testing-library/react-native';
import MetricChart from '../components/MetricChart';
import { MetricSeries } from '../types';

const mockMetric: MetricSeries = {
  name: 'train_loss',
  dataPoints: [
    { step: 1, value: 0.9, timestamp: '2024-01-01T00:01:00Z' },
    { step: 2, value: 0.7, timestamp: '2024-01-01T00:02:00Z' },
    { step: 3, value: 0.5, timestamp: '2024-01-01T00:03:00Z' },
  ],
};

describe('MetricChart', () => {
  it('renders the metric name', () => {
    const { getByText } = render(<MetricChart metric={mockMetric} />);
    expect(getByText('train_loss')).toBeTruthy();
  });

  it('renders latest value', () => {
    const { getByText } = render(<MetricChart metric={mockMetric} />);
    expect(getByText('Latest: 0.5000')).toBeTruthy();
  });

  it('shows empty state when no data points', () => {
    const emptyMetric: MetricSeries = { name: 'val_acc', dataPoints: [] };
    const { getByText } = render(<MetricChart metric={emptyMetric} />);
    expect(getByText('No data points for "val_acc"')).toBeTruthy();
  });
});
