import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { RootStackParamList } from '../types';

WebBrowser.maybeCompleteAuthSession();
import { loadAuthTokens, saveAuthTokens } from '../services/storageService';
import { AZURE_AUTH_URL } from '../constants';

const TENANT = '5b67d09b-63c3-44d3-b2af-eaa67a77b940';
const CLIENT_ID = '32ec673a-9e74-469f-9e98-1c70a34ad8f0';
const SCOPES = ['openid', 'profile', 'offline_access', 'https://management.azure.com/user_impersonation'];

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: `${AZURE_AUTH_URL}/${TENANT}/oauth2/v2.0/authorize`,
  tokenEndpoint: `${AZURE_AUTH_URL}/${TENANT}/oauth2/v2.0/token`,
};

const PKCE_VERIFIER_KEY = '@aml_pkce_verifier';
const PKCE_STATE_KEY = '@aml_pkce_state';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
};

// Base64url encode for PKCE
function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => chars[b % chars.length]).join('');
}

function isWebPlatform(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

export default function LoginScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  // On web, also set up the expo-auth-session hook for desktop popup flow
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

  // Check for existing tokens
  useEffect(() => {
    loadAuthTokens().then((tokens) => {
      if (tokens && Date.now() < tokens.expiresAt) {
        navigation.replace('Subscriptions');
      } else {
        setReady(true);
      }
    });
  }, [navigation]);

  // On web page load, check URL for OAuth redirect callback
  useEffect(() => {
    if (!isWebPlatform()) return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (error) {
      Alert.alert('Authentication Error', params.get('error_description') || error);
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (code) {
      // Clean URL immediately
      window.history.replaceState({}, '', window.location.pathname);
      handleRedirectCallback(code, state);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle desktop popup response (expo-auth-session)
  useEffect(() => {
    if (response?.type === 'success' && request?.codeVerifier) {
      exchangeCode(response.params.code, request.codeVerifier);
    } else if (response?.type === 'error') {
      Alert.alert('Authentication Error', response.error?.message ?? 'Unknown error.');
    }
  }, [response, request, redirectUri, navigation]);

  async function handleRedirectCallback(code: string, state: string | null) {
    const savedState = sessionStorage.getItem(PKCE_STATE_KEY);
    if (state && savedState && state !== savedState) {
      Alert.alert('Authentication Error', 'State mismatch. Please try again.');
      return;
    }

    const codeVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
    if (!codeVerifier) {
      Alert.alert('Authentication Error', 'Missing PKCE verifier. Please try again.');
      return;
    }

    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(PKCE_STATE_KEY);
    await exchangeCode(code, codeVerifier);
  }

  async function exchangeCode(code: string, codeVerifier: string) {
    setLoading(true);
    try {
      const tokenUrl = `${AZURE_AUTH_URL}/${TENANT}/oauth2/v2.0/token`;
      const origin = isWebPlatform() ? window.location.origin : redirectUri;
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        redirect_uri: origin,
        code_verifier: codeVerifier,
        scope: SCOPES.join(' '),
      });

      const resp = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error_description || `Token exchange failed (${resp.status})`);
      }

      const data = await resp.json();
      await saveAuthTokens({
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? undefined,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
        clientId: CLIENT_ID,
        subscriptionId: '',
      });
      navigation.replace('Subscriptions');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed.';
      Alert.alert('Authentication Failed', message);
    } finally {
      setLoading(false);
    }
  }

  async function startRedirectFlow() {
    // Generate PKCE verifier and challenge
    const codeVerifier = generateRandomString(64);
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      codeVerifier,
      { encoding: Crypto.CryptoEncoding.BASE64 },
    );
    const codeChallenge = digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const state = generateRandomString(32);

    // Store verifier and state for the callback
    sessionStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
    sessionStorage.setItem(PKCE_STATE_KEY, state);

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: window.location.origin,
      scope: SCOPES.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });

    window.location.href = `${AZURE_AUTH_URL}/${TENANT}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  const handleSignIn = () => {
    if (isWebPlatform()) {
      // Always use redirect flow on web — works on both mobile and desktop
      startRedirectFlow();
    } else {
      promptAsync();
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <Text style={styles.logoText}>☁️</Text>
        <Text style={styles.title}>AML Monitor</Text>
        <Text style={styles.subtitle}>Azure Machine Learning</Text>
      </View>

      <TouchableOpacity
        style={[styles.button, (!ready || loading) && styles.buttonDisabled]}
        onPress={handleSignIn}
        disabled={!ready || loading}
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
