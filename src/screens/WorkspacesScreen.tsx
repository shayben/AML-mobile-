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
import { RootStackParamList, Workspace } from '../types';
import { AzureMLService } from '../services/azureMLService';
import { clearAuthTokens, loadAuthTokens } from '../services/storageService';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Workspaces'>;
};

export default function WorkspacesScreen({ navigation }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkspaces = useCallback(async () => {
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
      const data = await service.listWorkspaces();
      setWorkspaces(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspaces.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [navigation]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const handleLogout = async () => {
    await clearAuthTokens();
    navigation.replace('Login');
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchWorkspaces();
  };

  const handleSelectWorkspace = (ws: Workspace) => {
    navigation.navigate('Jobs', {
      workspaceName: ws.name,
      resourceGroup: ws.resourceGroup,
      workspaceLocation: ws.location,
    });
  };

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerButtons}>
          <TouchableOpacity
            onPress={() => navigation.navigate('Costs')}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="View costs"
          >
            <Text style={styles.headerButtonText}>💰 Costs</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleLogout}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Text style={styles.headerButtonText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  if (loading) return <LoadingSpinner message="Loading workspaces…" />;
  if (error) return <ErrorMessage message={error} onRetry={fetchWorkspaces} />;

  return (
    <FlatList
      data={workspaces}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      ListHeaderComponent={
        <Text style={styles.header}>
          {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}
        </Text>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No workspaces found in this subscription.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => handleSelectWorkspace(item)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Workspace ${item.name}`}
        >
          <Text style={styles.workspaceName}>{item.name}</Text>
          <Text style={styles.resourceGroup}>Resource Group: {item.resourceGroup}</Text>
          <Text style={styles.location}>📍 {item.location}</Text>
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
  workspaceName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#201F1E',
    marginBottom: 4,
  },
  resourceGroup: {
    fontSize: 13,
    color: '#605E5C',
    marginBottom: 4,
  },
  location: {
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
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerButton: {
    marginRight: 4,
  },
  headerButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
});
