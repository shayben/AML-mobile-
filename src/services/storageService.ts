import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants';
import { AzureCredentials, Workspace } from '../types';

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
