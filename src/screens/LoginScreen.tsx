import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { RootStackParamList } from '../types';

WebBrowser.maybeCompleteAuthSession();
import { loadAuthTokens, saveAuthTokens } from '../services/storageService';
import { AZURE_AUTH_URL } from '../constants';

const TENANT = '5b67d09b-63c3-44d3-b2af-eaa67a77b940';
// Replace with your Azure AD app registration Client ID (public client, no secret needed)
const CLIENT_ID = '32ec673a-9e74-469f-9e98-1c70a34ad8f0';
const SCOPES = ['openid', 'profile', 'offline_access', 'https://management.azure.com/user_impersonation'];

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: `${AZURE_AUTH_URL}/${TENANT}/oauth2/v2.0/authorize`,
  tokenEndpoint: `${AZURE_AUTH_URL}/${TENANT}/oauth2/v2.0/token`,
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
};

export default function LoginScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(false);

  const redirectUri = AuthSession.makeRedirectUri();

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: CLIENT_ID,
      redirectUri,
      scopes: SCOPES,
      usePKCE: true,
      responseType: AuthSession.ResponseType.Code,
    },
    discovery,
  );

  useEffect(() => {
    loadAuthTokens().then((tokens) => {
      if (tokens && Date.now() < tokens.expiresAt) {
        navigation.replace('Subscriptions');
      }
    });
  }, [navigation]);

  useEffect(() => {
    if (response?.type === 'success' && request?.codeVerifier) {
      setLoading(true);
      AuthSession.exchangeCodeAsync(
        {
          code: response.params.code,
          clientId: CLIENT_ID,
          redirectUri,
          extraParams: { code_verifier: request.codeVerifier },
        },
        discovery,
      )
        .then(async (result) => {
          await saveAuthTokens({
            accessToken: result.accessToken,
            refreshToken: result.refreshToken ?? undefined,
            expiresAt: Date.now() + (result.expiresIn ?? 3600) * 1000,
            clientId: CLIENT_ID,
            subscriptionId: '',
          });
          navigation.replace('Subscriptions');
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : 'Authentication failed.';
          Alert.alert('Authentication Failed', message);
        })
        .finally(() => setLoading(false));
    } else if (response?.type === 'error') {
      Alert.alert('Authentication Error', response.error?.message ?? 'Unknown error.');
    }
  }, [response, request, redirectUri, navigation]);

  const handleSignIn = () => {
    promptAsync();
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <Text style={styles.logoText}>☁️</Text>
        <Text style={styles.title}>AML Monitor</Text>
        <Text style={styles.subtitle}>Azure Machine Learning</Text>
      </View>

      <TouchableOpacity
        style={[styles.button, (!request || loading) && styles.buttonDisabled]}
        onPress={handleSignIn}
        disabled={!request || loading}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>
          {loading ? 'Signing in…' : '🔑  Sign in with Microsoft'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.hint}>
        Sign in with your Azure account to discover subscriptions and workspaces automatically.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#F8F8F8',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
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
  button: {
    backgroundColor: '#0078D4',
    borderRadius: 6,
    paddingVertical: 14,
    alignItems: 'center',
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
