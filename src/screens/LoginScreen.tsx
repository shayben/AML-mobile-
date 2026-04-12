import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AzureCredentials, RootStackParamList } from '../types';
import { loadCredentials, saveCredentials } from '../services/storageService';
import { AzureMLService } from '../services/azureMLService';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
};

export default function LoginScreen({ navigation }: Props) {
  const [tenantId, setTenantId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [subscriptionId, setSubscriptionId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadCredentials().then((creds) => {
      if (creds) {
        setTenantId(creds.tenantId);
        setClientId(creds.clientId);
        setSubscriptionId(creds.subscriptionId);
        // Do not auto-populate secret; require user to re-enter for security
      }
    });
  }, []);

  const handleConnect = async () => {
    if (!tenantId.trim() || !clientId.trim() || !clientSecret.trim() || !subscriptionId.trim()) {
      Alert.alert('Validation Error', 'All fields are required.');
      return;
    }
    setLoading(true);
    const credentials: AzureCredentials = {
      tenantId: tenantId.trim(),
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      subscriptionId: subscriptionId.trim(),
    };
    try {
      const service = new AzureMLService(credentials);
      await service.getAccessToken();
      await saveCredentials(credentials);
      navigation.replace('Workspaces');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Authentication failed. Check your credentials.';
      Alert.alert('Authentication Failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior="padding"
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>☁️</Text>
          <Text style={styles.title}>AML Monitor</Text>
          <Text style={styles.subtitle}>Azure Machine Learning</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Tenant ID</Text>
          <TextInput
            style={styles.input}
            value={tenantId}
            onChangeText={setTenantId}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            placeholderTextColor="#A19F9D"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Tenant ID"
          />

          <Text style={styles.label}>Client ID</Text>
          <TextInput
            style={styles.input}
            value={clientId}
            onChangeText={setClientId}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            placeholderTextColor="#A19F9D"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Client ID"
          />

          <Text style={styles.label}>Client Secret</Text>
          <TextInput
            style={styles.input}
            value={clientSecret}
            onChangeText={setClientSecret}
            placeholder="Your service principal secret"
            placeholderTextColor="#A19F9D"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Client Secret"
          />

          <Text style={styles.label}>Subscription ID</Text>
          <TextInput
            style={styles.input}
            value={subscriptionId}
            onChangeText={setSubscriptionId}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            placeholderTextColor="#A19F9D"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Subscription ID"
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleConnect}
            disabled={loading}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{loading ? 'Connecting…' : 'Connect'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.hint}>
          Sign in with a service principal that has access to your Azure ML workspace.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F8F8F8' },
  container: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoText: { fontSize: 48 },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#201F1E',
    marginTop: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#605E5C',
    marginTop: 4,
  },
  form: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#201F1E',
    marginBottom: 4,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D2D0CE',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#201F1E',
    backgroundColor: '#FAFAFA',
  },
  button: {
    backgroundColor: '#0078D4',
    borderRadius: 6,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: {
    backgroundColor: '#A6CBEE',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    marginTop: 24,
    fontSize: 12,
    color: '#A19F9D',
    textAlign: 'center',
    lineHeight: 18,
  },
});
