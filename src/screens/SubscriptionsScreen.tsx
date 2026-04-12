import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RootStackParamList, Subscription } from '../types';
import { AzureMLService } from '../services/azureMLService';
import { clearAuthTokens, loadAuthTokens, saveAuthTokens } from '../services/storageService';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Subscriptions'>;
};

export default function SubscriptionsScreen({ navigation }: Props) {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSubscriptions = useCallback(async () => {
    try {
      const tokens = await loadAuthTokens();
      if (!tokens) {
        navigation.replace('Login');
        return;
      }
      const service = new AzureMLService({ accessToken: tokens.accessToken, subscriptionId: '' });
      const data = await service.listSubscriptions();
      setSubscriptions(data.filter((s) => s.state === 'Enabled'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscriptions.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [navigation]);

  useEffect(() => {
    fetchSubscriptions();
  }, [fetchSubscriptions]);

  const handleLogout = async () => {
    await clearAuthTokens();
    navigation.replace('Login');
  };

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={handleLogout}
          style={styles.logoutButton}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      ),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchSubscriptions();
  };

  const handleSelectSubscription = async (sub: Subscription) => {
    const tokens = await loadAuthTokens();
    if (!tokens) {
      navigation.replace('Login');
      return;
    }
    await saveAuthTokens({ ...tokens, subscriptionId: sub.subscriptionId });
    navigation.navigate('Workspaces');
  };

  if (loading) return <LoadingSpinner message="Loading subscriptions…" />;
  if (error) return <ErrorMessage message={error} onRetry={fetchSubscriptions} />;

  return (
    <FlatList
      data={subscriptions}
      keyExtractor={(item) => item.subscriptionId}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      ListHeaderComponent={
        <Text style={styles.header}>
          {subscriptions.length} subscription{subscriptions.length !== 1 ? 's' : ''}
        </Text>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No enabled subscriptions found.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => handleSelectSubscription(item)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Subscription ${item.displayName}`}
        >
          <Text style={styles.subscriptionName}>{item.displayName}</Text>
          <Text style={styles.subscriptionId}>{item.subscriptionId}</Text>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: 16,
    backgroundColor: '#F8F8F8',
    flexGrow: 1,
  },
  header: {
    fontSize: 13,
    color: '#A19F9D',
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  subscriptionName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#201F1E',
    marginBottom: 4,
  },
  subscriptionId: {
    fontSize: 12,
    color: '#A19F9D',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 15,
    color: '#A19F9D',
    textAlign: 'center',
  },
  logoutButton: { marginRight: 4 },
  logoutText: { color: '#0078D4', fontSize: 15 },
});
