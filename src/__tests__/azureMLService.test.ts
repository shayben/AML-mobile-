import { AzureMLService } from '../services/azureMLService';
import axios from 'axios';

// Manual factory mock to avoid triggering the real axios fetch adapter at module init time
jest.mock('axios', () => {
  const mockAxios = {
    post: jest.fn(),
    create: jest.fn(),
  };
  return { ...mockAxios, default: mockAxios };
});

const mockCredentials = {
  tenantId: 'test-tenant',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  subscriptionId: 'test-sub',
};

function makeClientMock(getImpl: jest.Mock = jest.fn()) {
  return {
    get: getImpl,
    post: jest.fn(),
    interceptors: {
      request: {
        use: (fn: (c: unknown) => unknown) => fn,
      },
    },
  };
}

describe('AzureMLService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (axios.create as jest.Mock).mockReturnValue(makeClientMock());
  });

  describe('getAccessToken', () => {
    it('fetches and caches an access token', async () => {
      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'token-abc', token_type: 'Bearer', expires_in: 3600 },
      });

      const service = new AzureMLService(mockCredentials);
      const token = await service.getAccessToken();
      expect(token).toBe('token-abc');
      expect(axios.post).toHaveBeenCalledTimes(1);

      // Second call should use cached token
      const token2 = await service.getAccessToken();
      expect(token2).toBe('token-abc');
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('throws when authentication fails', async () => {
      (axios.post as jest.Mock).mockRejectedValue(new Error('401 Unauthorized'));
      const service = new AzureMLService(mockCredentials);
      await expect(service.getAccessToken()).rejects.toThrow('401 Unauthorized');
    });
  });

  describe('listWorkspaces', () => {
    it('maps API response to Workspace objects', async () => {
      const apiWorkspaces = [
        {
          id: '/subscriptions/test-sub/resourceGroups/rg1/providers/Microsoft.MachineLearningServices/workspaces/ws1',
          name: 'ws1',
          location: 'eastus',
        },
      ];
      const mockGet = jest.fn().mockResolvedValue({ data: { value: apiWorkspaces } });
      (axios.create as jest.Mock).mockReturnValue(makeClientMock(mockGet));
      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 },
      });

      const service = new AzureMLService(mockCredentials);
      const workspaces = await service.listWorkspaces();

      expect(workspaces).toHaveLength(1);
      expect(workspaces[0]).toMatchObject({
        id: apiWorkspaces[0].id,
        name: 'ws1',
        resourceGroup: 'rg1',
        location: 'eastus',
        subscriptionId: 'test-sub',
      });
    });

    it('returns empty array when no workspaces found', async () => {
      const mockGet = jest.fn().mockResolvedValue({ data: { value: [] } });
      (axios.create as jest.Mock).mockReturnValue(makeClientMock(mockGet));
      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 },
      });

      const service = new AzureMLService(mockCredentials);
      const workspaces = await service.listWorkspaces();
      expect(workspaces).toEqual([]);
    });
  });

  describe('listJobs', () => {
    it('maps API response to Run objects', async () => {
      const apiJobs = [
        {
          name: 'run-001',
          properties: {
            displayName: 'Training Run 1',
            status: 'Completed',
            startTime: '2024-01-01T10:00:00Z',
            endTime: '2024-01-01T11:00:00Z',
            experimentName: 'exp1',
            jobType: 'Command',
          },
        },
      ];
      const mockGet = jest.fn().mockResolvedValue({ data: { value: apiJobs } });
      (axios.create as jest.Mock).mockReturnValue(makeClientMock(mockGet));

      const service = new AzureMLService(mockCredentials);
      const runs = await service.listJobs('rg1', 'ws1');

      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        runId: 'run-001',
        displayName: 'Training Run 1',
        status: 'Completed',
        experimentName: 'exp1',
      });
    });
  });

  describe('getJobMetrics', () => {
    it('returns empty metrics when no workspace location provided', async () => {
      const mockGet = jest.fn();
      (axios.create as jest.Mock).mockReturnValue(makeClientMock(mockGet));

      const service = new AzureMLService(mockCredentials);
      const metrics = await service.getJobMetrics('rg1', 'ws1', 'run-001');

      expect(Object.keys(metrics)).toHaveLength(0);
    });

    it('returns empty metrics when MLflow API fails', async () => {
      const mockGet = jest.fn();
      (axios.create as jest.Mock).mockReturnValue(makeClientMock(mockGet));
      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 },
      });

      const service = new AzureMLService(mockCredentials);
      const metrics = await service.getJobMetrics('rg1', 'ws1', 'run-001', 'eastus');

      expect(Object.keys(metrics)).toHaveLength(0);
    });
  });

  describe('getJobLogFiles', () => {
    it('returns empty array when MLflow API fails', async () => {
      const mockGet = jest.fn();
      (axios.create as jest.Mock).mockReturnValue(makeClientMock(mockGet));
      (axios.post as jest.Mock).mockResolvedValue({
        data: { access_token: 'tok', token_type: 'Bearer', expires_in: 3600 },
      });

      const service = new AzureMLService(mockCredentials);
      const logs = await service.getJobLogFiles('rg1', 'ws1', 'run-001', 'eastus');

      expect(logs).toEqual([]);
    });
  });
});
