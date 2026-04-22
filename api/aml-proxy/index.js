const axios = require('axios');

// Generic proxy for AzureML data-plane endpoints (everything under
// `https://{region}.api.azureml.ms/`). Unlike mlflow-proxy, this does NOT
// hardcode the `/mlflow/v1.0/` prefix, so it can hit `/history/v1.0/...`,
// `/artifact/v2.0/...`, etc.
//
// Special case: when the request targets `.../artifacts/artifacturi?path=...`,
// the proxy performs a server-side 2-step download (fetch SAS URL, then
// fetch the blob body) and returns the body as text. This is required
// because Azure Blob Storage doesn't allow arbitrary cross-origin GETs from
// a browser, so the SAS URL can't be fetched client-side.
module.exports = async function (context, req) {
  const routePath = req.params.restOfPath || '';
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
  const amlPath = routePath.substring(slashIdx + 1);

  const queryParts = [];
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      if (value !== undefined && value !== null) {
        queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
      }
    }
  }
  const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
  const targetUrl = `https://${region}.api.azureml.ms/${amlPath}${queryString}`;

  context.log(`[aml-proxy] ${req.method} -> ${targetUrl}`);

  const isArtifactUri = amlPath.includes('/artifacts/artifacturi');

  try {
    if (isArtifactUri) {
      // Step 1: get SAS URI
      const sasResp = await axios.get(targetUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 30000,
      });
      const sasUrl = sasResp.data?.artifactUri || sasResp.data?.contentUri;
      if (!sasUrl) {
        context.res = {
          status: 502,
          body: { error: 'No artifactUri/contentUri in response', upstream: sasResp.data },
        };
        return;
      }
      // Step 2: fetch blob body. Do NOT forward Authorization to blob storage —
      // the SAS token in the URL is the credential.
      const blobResp = await axios.get(sasUrl, {
        responseType: 'text',
        timeout: 30000,
        transformResponse: [(d) => d],
      });
      context.res = {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: typeof blobResp.data === 'string' ? blobResp.data : String(blobResp.data),
      };
      return;
    }

    // Generic forward
    const config = {
      method: req.method.toLowerCase(),
      url: targetUrl,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(req.body && { data: req.body }),
      timeout: 30000,
    };
    const response = await axios(config);
    context.res = {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: response.data,
    };
  } catch (err) {
    const status = err.response?.status || 500;
    const errData = err.response?.data;
    const body = typeof errData === 'string'
      ? { error: errData.substring(0, 500), upstream: targetUrl }
      : (errData || { error: err.message, upstream: targetUrl });
    context.log(`[aml-proxy] Error ${status}: ${JSON.stringify(body).substring(0, 300)}`);
    context.res = { status, body };
  }
};
