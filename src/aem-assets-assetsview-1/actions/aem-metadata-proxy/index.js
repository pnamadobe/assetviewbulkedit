/**
 * App Builder I/O Runtime action that proxies metadata & schema requests to AEM Author
 * on behalf of the signed-in Assets View user (forwarding their IMS Bearer token).
 *
 * Using this proxy avoids requiring a custom OSGi CORS policy on AEM Author.
 */

const ALLOWED_HOST_PATTERN = /^https:\/\/[a-z0-9-]+\.(adobeaemcloud\.com|adobecqms\.net)$/i;

function errorResponse(statusCode, message, details = null) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: {
      error: message,
      ...(details ? { details } : {})
    }
  };
}

function validateAemHost(rawHost) {
  if (!rawHost || typeof rawHost !== 'string') {
    return null;
  }
  const normalized = rawHost.trim().replace(/\/+$/, '');
  const withScheme = normalized.startsWith('https://') ? normalized : `https://${normalized}`;
  if (!ALLOWED_HOST_PATTERN.test(withScheme)) {
    return null;
  }
  return withScheme;
}

function validateAssetId(assetId) {
  if (!assetId || typeof assetId !== 'string') {
    return false;
  }
  const trimmed = assetId.trim();
  // AEM asset URNs (e.g. urn:aaid:aem:<uuid>); reject path traversal / query / fragment chars
  return /^[a-z0-9:._-]+$/i.test(trimmed) && !trimmed.includes('..');
}

function buildHeaders(params, extraHeaders = {}) {
  const authHeader = params.__ow_headers?.authorization || params.__ow_headers?.Authorization;
  const apiKey = params.__ow_headers?.['x-api-key'] || params.apiKey;
  const headers = {
    Accept: 'application/json',
    ...extraHeaders
  };
  if (authHeader) {
    headers.Authorization = authHeader;
  }
  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
  }
  return headers;
}

async function handleGetMetadata(aemHost, params) {
  const { assetId } = params;
  if (!validateAssetId(assetId)) {
    return errorResponse(400, 'Invalid or missing assetId');
  }

  const url = `${aemHost}/adobe/assets/${encodeURIComponent(assetId)}/metadata`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(params)
  });

  const text = await resp.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!resp.ok) {
    return errorResponse(resp.status, `Failed to fetch metadata for ${assetId}`, body);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      ...body,
      etag: resp.headers.get('etag') || null
    }
  };
}

async function handlePatchMetadata(aemHost, params) {
  const { assetId, etag, patch } = params;
  if (!validateAssetId(assetId)) {
    return errorResponse(400, 'Invalid or missing assetId');
  }
  if (!Array.isArray(patch) || patch.length === 0) {
    return errorResponse(400, 'patch must be a non-empty JSON Patch array');
  }

  const url = `${aemHost}/adobe/assets/${encodeURIComponent(assetId)}/metadata`;
  const extraHeaders = {
    'Content-Type': 'application/json-patch+json'
  };
  if (etag) {
    extraHeaders['If-Match'] = etag;
  }

  const resp = await fetch(url, {
    method: 'PATCH',
    headers: buildHeaders(params, extraHeaders),
    body: JSON.stringify(patch)
  });

  const text = await resp.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!resp.ok) {
    return errorResponse(resp.status, `Failed to update metadata for ${assetId}`, body);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      ...body,
      etag: resp.headers.get('etag') || null
    }
  };
}

async function handleGetMetadataForms(aemHost, params) {
  // Assets View stores metadata forms under /content/dam/appdata/metadataforms
  // Admin View stores metadata schemas under /conf/global/settings/dam/adminui-extension/metadataschema
  const source = params.source === 'admin' ? 'admin' : 'assetsview';
  const formPath =
    source === 'admin'
      ? '/conf/global/settings/dam/adminui-extension/metadataschema.infinity.json'
      : '/content/dam/appdata/metadataforms.infinity.json';

  const url = `${aemHost}${formPath}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(params)
  });

  if (resp.status === 404 || resp.status === 403) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        available: false,
        status: resp.status,
        source,
        formsTree: null
      }
    };
  }

  const text = await resp.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!resp.ok) {
    return errorResponse(resp.status, 'Failed to fetch metadata forms from AEM', body);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      available: true,
      source,
      formsTree: body
    }
  };
}

async function main(params) {
  const authHeader = params.__ow_headers?.authorization || params.__ow_headers?.Authorization;
  if (!authHeader) {
    return errorResponse(401, 'Missing Authorization header');
  }

  const aemHost = validateAemHost(params.aemHost);
  if (!aemHost) {
    return errorResponse(
      400,
      'Invalid aemHost. Must be an Adobe AEM Cloud Service host (*.adobeaemcloud.com or *.adobecqms.net).'
    );
  }

  try {
    switch (params.operation) {
      case 'getMetadata':
        return await handleGetMetadata(aemHost, params);
      case 'patchMetadata':
        return await handlePatchMetadata(aemHost, params);
      case 'getMetadataForms':
        return await handleGetMetadataForms(aemHost, params);
      default:
        return errorResponse(
          400,
          'Unsupported operation. Expected one of: getMetadata, patchMetadata, getMetadataForms'
        );
    }
  } catch (err) {
    return errorResponse(502, 'Error communicating with AEM Author', {
      message: err.message
    });
  }
}

exports.main = main;
exports.validateAemHost = validateAemHost;
exports.validateAssetId = validateAssetId;
