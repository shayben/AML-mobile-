const axios = require('axios');

module.exports = async function (context, req) {
  const path = req.params.path || '';
  const authorization = req.headers['authorization'];

  if (!authorization) {
    context.res = { status: 401, body: { error: 'Missing authorization header' } };
    return;
  }

  // The path contains: {region}/{mlflowPath}
  // e.g., westus2/subscriptions/.../api/2.0/mlflow/runs/search
  const slashIdx = path.indexOf('/');
  if (slashIdx < 0) {
    context.res = { status: 400, body: { error: 'Invalid path: expected {region}/{path}' } };
    return;
  }

  const region = path.substring(0, slashIdx);
  const mlflowPath = path.substring(slashIdx + 1);
  const targetUrl = `https://${region}.api.azureml.ms/mlflow/v1.0/${mlflowPath}`;

  try {
    const config = {
      method: req.method.toLowerCase(),
      url: targetUrl,
      headers: {
        'Authorization': authorization,
        'Content-Type': 'application/json',
      },
      ...(req.body && { data: req.body }),
      ...(req.query && Object.keys(req.query).length > 0 && { params: req.query }),
      timeout: 30000,
      // For artifact downloads, get raw data
      responseType: mlflowPath.includes('artifacts/get') ? 'arraybuffer' : 'json',
    };

    const response = await axios(config);

    const headers = { 'Content-Type': 'application/json' };
    if (mlflowPath.includes('artifacts/get')) {
      headers['Content-Type'] = response.headers['content-type'] || 'text/plain';
    }

    context.res = {
      status: response.status,
      headers,
      body: response.data,
      isRaw: mlflowPath.includes('artifacts/get'),
    };
  } catch (err) {
    const status = err.response?.status || 500;
    const body = err.response?.data || { error: err.message };
    context.res = { status, body };
  }
};
