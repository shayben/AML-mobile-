import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface Props {
  name: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

// Isolates a chart render so a malformed metric series can't crash the whole
// Metrics tab. Without this, react-native-chart-kit's value.toFixed() on a
// non-finite value bubbles up and breaks the entire screen.
export default class SafeChart extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.warn(`[SafeChart] "${this.props.name}" crashed:`, error.message);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.title}>{this.props.name}</Text>
          <Text style={styles.message} selectable>
            Failed to render this metric: {this.state.error.message}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: '#FFF4CE',
    borderLeftWidth: 3,
    borderLeftColor: '#D8A000',
    padding: 12,
    borderRadius: 6,
    marginBottom: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#201F1E',
    marginBottom: 4,
  },
  message: {
    fontSize: 12,
    color: '#3B3A39',
  },
});
