import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import JobCard from '../components/JobCard';
import { Run } from '../types';

const mockRun: Run = {
  runId: 'run-123',
  displayName: 'My Training Run',
  status: 'Completed',
  startTimeUtc: '2024-01-15T09:00:00Z',
  endTimeUtc: '2024-01-15T10:30:00Z',
  experimentName: 'image-classification',
  runType: 'azureml.scriptrun',
};

describe('JobCard', () => {
  it('renders run display name', () => {
    const { getByText } = render(
      <JobCard run={mockRun} onPress={() => {}} />,
    );
    expect(getByText('My Training Run')).toBeTruthy();
  });

  it('renders run status badge', () => {
    const { getByText } = render(
      <JobCard run={mockRun} onPress={() => {}} />,
    );
    expect(getByText('Completed')).toBeTruthy();
  });

  it('renders experiment name', () => {
    const { getByText } = render(
      <JobCard run={mockRun} onPress={() => {}} />,
    );
    expect(getByText('Experiment: image-classification')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getAllByRole } = render(
      <JobCard run={mockRun} onPress={onPress} />,
    );
    const buttons = getAllByRole('button');
    fireEvent.press(buttons[0]);
    expect(onPress).toHaveBeenCalledWith(mockRun);
  });

  it('renders runId when displayName is absent', () => {
    const runWithoutName: Run = { ...mockRun, displayName: undefined };
    const { getByText } = render(
      <JobCard run={runWithoutName} onPress={() => {}} />,
    );
    expect(getByText('run-123')).toBeTruthy();
  });

  it('renders running dot for Running status', () => {
    const runningRun: Run = { ...mockRun, status: 'Running', endTimeUtc: undefined };
    const { getByText } = render(
      <JobCard run={runningRun} onPress={() => {}} />,
    );
    expect(getByText('Running')).toBeTruthy();
  });
});
