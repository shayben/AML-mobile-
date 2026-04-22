import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants';
import { AzureCredentials, AuthTokens, Workspace } from '../types';

export async function saveCredentials(credentials: AzureCredentials): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.CREDENTIALS, JSON.stringify(credentials));
}

export async function loadCredentials(): Promise<AzureCredentials | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.CREDENTIALS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AzureCredentials;
  } catch {
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEYS.CREDENTIALS);
  await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKENS);
}

export async function saveAuthTokens(tokens: AuthTokens): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKENS, JSON.stringify(tokens));
}

export async function loadAuthTokens(): Promise<AuthTokens | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKENS);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

export async function clearAuthTokens(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKENS);
}

export async function saveSelectedWorkspace(workspace: Workspace): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.SELECTED_WORKSPACE, JSON.stringify(workspace));
}

export async function loadSelectedWorkspace(): Promise<Workspace | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.SELECTED_WORKSPACE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Workspace;
  } catch {
    return null;
  }
}

export async function clearSelectedWorkspace(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEYS.SELECTED_WORKSPACE);
}

// Generic cache with TTL (default 15 minutes)
const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(`cache:${key}`);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      await AsyncStorage.removeItem(`cache:${key}`);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, data: T): Promise<void> {
  const entry: CacheEntry<T> = { data, timestamp: Date.now() };
  await AsyncStorage.setItem(`cache:${key}`, JSON.stringify(entry));
}
