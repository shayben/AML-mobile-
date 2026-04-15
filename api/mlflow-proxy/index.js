const axios = require('axios');

module.exports = async function (context, req) {
  const routePath = req.params.path || '';
  const token = req.headers['x-azure-token'];

  if (!token) {
    context.res = { status: 401, body: { error: 'Missing X-Azure-Token header' } };
    return;
  }

  const slashIdx = routePath.indexOf('/');
  if (slashIdx < 0) {
    context.res = { status: 400, body: { error: 'Invalid path: expected {region}/{path}' } };
    return;
  }

  const region = routePath.substring(0, slashIdx);
  const mlflowPath = routePath.substring(slashIdx + 1);

  // Reconstruct query string from the original URL to avoid SWA param conflicts
  const originalUrl = req.url || '';
  const qsIdx = originalUrl.indexOf('?');
  const queryString = qsIdx >= 0 ? originalUrl.substring(qsIdx) : '';

  const targetUrl = `https://${region}.api.azureml.ms/mlflow/v1.0/${mlflowPath}${queryString}`;
  const isArtifactDownload = mlflowPath.includes('artifacts/get');

  context.log(`[mlflow-proxy] ${req.method} ${mlflowPath}${queryString ? ' (with qs)' : ''}`);

  try {
    const config = {
      method: req.method.toLowerCase(),
      url: targetUrl,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(req.body && { data: req.body }),
      timeout: 30000,
      responseType: isArtifactDownload ? 'text' : 'json',
    };

    const response = await axios(config);

    context.res = {
      status: response.status,
      headers: { 'Content-Type': isArtifactDownload ? 'text/plain' : 'application/json' },
      body: response.data,
    };
  } catch (err) {
    const status = err.response?.status || 500;
    const body = err.response?.data || { error: err.message };
    context.log(`[mlflow-proxy] Error ${status}: ${JSON.stringify(body).substring(0, 200)}`);
    context.res = { status, body };
  }
};
