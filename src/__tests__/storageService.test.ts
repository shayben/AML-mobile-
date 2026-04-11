import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearCredentials,
  loadCredentials,
  saveCredentials,
  loadSelectedWorkspace,
  saveSelectedWorkspace,
} from '../services/storageService';
import { AzureCredentials, Workspace } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const mockCreds: AzureCredentials = {
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  subscriptionId: 'sub-1',
};

const mockWorkspace: Workspace = {
  id: '/subscriptions/sub-1/resourceGroups/rg1/providers/Microsoft.MachineLearningServices/workspaces/ws1',
  name: 'ws1',
  resourceGroup: 'rg1',
  location: 'eastus',
  subscriptionId: 'sub-1',
};

describe('storageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('saveCredentials / loadCredentials', () => {
    it('saves credentials to AsyncStorage', async () => {
      await saveCredentials(mockCreds);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        '@aml_credentials',
        JSON.stringify(mockCreds),
      );
    });

    it('loads and parses stored credentials', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockCreds));
      const result = await loadCredentials();
      expect(result).toEqual(mockCreds);
    });

    it('returns null when no credentials stored', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
      const result = await loadCredentials();
      expect(result).toBeNull();
    });

    it('returns null when stored value is invalid JSON', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue('{invalid json}');
      const result = await loadCredentials();
      expect(result).toBeNull();
    });
  });

  describe('clearCredentials', () => {
    it('removes credentials from AsyncStorage', async () => {
      await clearCredentials();
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@aml_credentials');
    });
  });

  describe('saveSelectedWorkspace / loadSelectedWorkspace', () => {
    it('saves and loads workspace', async () => {
      await saveSelectedWorkspace(mockWorkspace);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        '@aml_selected_workspace',
        JSON.stringify(mockWorkspace),
      );

      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(mockWorkspace));
      const result = await loadSelectedWorkspace();
      expect(result).toEqual(mockWorkspace);
    });
  });
});
