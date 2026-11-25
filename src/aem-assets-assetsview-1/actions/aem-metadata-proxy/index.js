/**
 * App Builder I/O Runtime action that proxies metadata & schema requests to AEM Author
 * on behalf of the signed-in Assets View user (forwarding their IMS Bearer token).
 *
 * Using this proxy avoids requiring a custom OSGi CORS policy on AEM Author.
 */

const ALLOWED_HOST_PATTERN = /^https:\/\/[a-z0-9-]+\.(adobeaemcloud\.com|adobecqms\.net)$/i;

const FOLDER_SCHEMA_PROPS = [
  'assetsViewMetadataForm',
  'metadataForm',
  'metadataSchema',
  'dam:metadataSchema'
];

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

function validateDamPath(damPath) {
  if (!damPath || typeof damPath !== 'string') {
    return null;
  }
  const trimmed = damPath.trim().replace(/\/+$/, '');
  if (!trimmed.startsWith('/content/dam') || trimmed.includes('..') || /[?#]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function validateSchemaPath(schemaPath) {
  if (!schemaPath || typeof schemaPath !== 'string') {
    return null;
  }
  const trimmed = schemaPath.trim().replace(/\/+$/, '');
  const allowedPrefix =
    trimmed.startsWith('/content/dam/appdata/metadataforms/') ||
    trimmed.startsWith('/conf/global/settings/dam/adminui-extension/metadataschema/');
  if (!allowedPrefix || trimmed.includes('..') || /[?#]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function encodeJcrPath(jcrPath) {
  return jcrPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
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

/**
 * Walks up a DAM folder path to `/content/dam`, reading `<folder>/jcr:content.json`
 * to find any folder-assigned metadata schema/form property. If found and the value
 * is a JCR schema path, also fetches that schema node directly.
 */
async function handleGetFolderSchema(aemHost, params) {
  const folderPath = validateDamPath(params.folderPath);
  if (!folderPath) {
    return errorResponse(400, 'Invalid folderPath. Must start with /content/dam');
  }

  const headers = buildHeaders(params);
  const parts = folderPath.split('/').filter(Boolean);

  while (parts.length >= 2) {
    const candidate = '/' + parts.join('/');
    const url = `${aemHost}${encodeJcrPath(candidate)}/jcr:content.json`;

    try {
      const resp = await fetch(url, { method: 'GET', headers });
      if (resp.ok) {
        const jcrContent = await resp.json().catch(() => null);
        if (jcrContent && typeof jcrContent === 'object') {
          for (const propName of FOLDER_SCHEMA_PROPS) {
            const rawVal = jcrContent[propName];
            if (typeof rawVal === 'string' && rawVal.trim().length > 0) {
              const schemaRef = rawVal.trim();
              const formId = schemaRef.split('/').filter(Boolean).pop().toLowerCase();

              let formNode = null;
              const safeSchemaPath = validateSchemaPath(schemaRef);
              if (safeSchemaPath) {
                const schemaResp = await fetch(
                  `${aemHost}${encodeJcrPath(safeSchemaPath)}.infinity.json`,
                  { method: 'GET', headers }
                );
                if (schemaResp.ok) {
                  formNode = await schemaResp.json().catch(() => null);
                }
              }

              return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: {
                  found: true,
                  assignedAt: candidate,
                  property: propName,
                  schemaRef,
                  formId,
                  formNode
                }
              };
            }
          }
        }
      }
    } catch {
      // Continue walking up to parent folder
    }

    parts.pop();
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      found: false,
      assignedAt: null,
      schemaRef: null,
      formId: null,
      formNode: null
    }
  };
}

/**
 * Fetches a small thumbnail rendition for an asset and returns it as a base64 data URL
 * so the extension iframe can render thumbnails without cross-origin cookie issues.
 */
async function handleGetThumbnail(aemHost, params) {
  const { assetId, assetPath } = params;
  if (!validateAssetId(assetId)) {
    return errorResponse(400, 'Invalid or missing assetId');
  }

  const headers = buildHeaders(params, { Accept: 'image/*,*/*;q=0.8' });
  const candidates = [];

  const safePath = validateDamPath(assetPath);
  if (safePath) {
    candidates.push(
      `${aemHost}${encodeJcrPath(safePath)}/jcr:content/renditions/cq5dam.thumbnail.140.100.png`
    );
    candidates.push(
      `${aemHost}${encodeJcrPath(safePath)}/jcr:content/renditions/cq5dam.thumbnail.48.48.png`
    );
  }
  candidates.push(`${aemHost}/adobe/assets/${encodeURIComponent(assetId)}`);

  for (const url of candidates) {
    try {
      const resp = await fetch(url, { method: 'GET', headers });
      if (resp.ok) {
        const contentType = resp.headers.get('content-type') || 'image/png';
        if (contentType.startsWith('image/')) {
          const arrayBuf = await resp.arrayBuffer();
          // Skip unusually large responses (> 512 KB) to keep proxy responses fast
          if (arrayBuf.byteLength > 0 && arrayBuf.byteLength <= 512 * 1024) {
            const base64 = Buffer.from(arrayBuf).toString('base64');
            return {
              statusCode: 200,
              headers: { 'Content-Type': 'application/json' },
              body: {
                available: true,
                dataUrl: `data:${contentType.split(';')[0]};base64,${base64}`
              }
            };
          }
        }
      }
    } catch {
      // Try next candidate
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: { available: false, dataUrl: null }
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
      case 'getFolderSchema':
        return await handleGetFolderSchema(aemHost, params);
      case 'getThumbnail':
        return await handleGetThumbnail(aemHost, params);
      default:
        return errorResponse(
          400,
          'Unsupported operation. Expected one of: getMetadata, patchMetadata, getMetadataForms, getFolderSchema, getThumbnail'
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
exports.validateDamPath = validateDamPath;
