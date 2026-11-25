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

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const count = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: count }, () => runWorker()));
  return results;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSingleAssetMetadata(aemHost, assetId, headers) {
  const url = `${aemHost}/adobe/assets/${encodeURIComponent(assetId)}/metadata`;
  let lastError = null;
  let lastStatus = 504;
  let lastBody = null;

  // Max 2 attempts x 9s = ~18.5s worst case (always under CloudFront's 30s 504 cutoff)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const resp = await fetchWithTimeout(url, { method: 'GET', headers }, 9000);
      const text = await resp.text();
      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { raw: text };
      }

      if (resp.ok) {
        return {
          assetId,
          ok: true,
          status: 200,
          data: body,
          etag: resp.headers.get('etag') || null
        };
      }

      lastStatus = resp.status;
      lastBody = body;

      if (RETRYABLE_STATUSES.has(resp.status) && attempt === 0) {
        const retryAfter = Number(resp.headers.get('retry-after'));
        const delayMs = !Number.isNaN(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 1500)
          : 400;
        await sleep(delayMs);
        continue;
      }

      return {
        assetId,
        ok: false,
        status: resp.status,
        error: `Failed to fetch metadata (${resp.status})`,
        details: body
      };
    } catch (err) {
      lastError = err;
      lastStatus = err?.name === 'AbortError' ? 504 : 502;
      if (attempt === 0) {
        await sleep(400);
      }
    }
  }

  return {
    assetId,
    ok: false,
    status: lastStatus,
    error: lastError?.message || `Failed after retries (HTTP ${lastStatus})`,
    details: lastBody
  };
}

/**
 * Fetches metadata for up to 50 assets in ONE single POST /adobe/assets/search call.
 * Dramatically faster and avoids per-asset rate limiting / 504s.
 */
async function handleSearchMetadata(aemHost, params) {
  const { assetIds } = params;
  if (!Array.isArray(assetIds) || assetIds.length === 0 || assetIds.length > 50) {
    return errorResponse(400, 'assetIds must be an array of 1 to 50 asset IDs');
  }

  const validIds = assetIds.filter((id) => validateAssetId(id));
  if (validIds.length === 0) {
    return errorResponse(400, 'No valid assetIds provided');
  }

  const headers = buildHeaders(params, { 'Content-Type': 'application/json' });
  const fieldCandidates = ['assetId', 'repositoryMetadata.repo:assetId'];

  for (const fieldName of fieldCandidates) {
    try {
      const url = `${aemHost}/adobe/assets/search?allowUnindexedSearch=true`;
      const resp = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query: [{ term: { [fieldName]: validIds } }],
            limit: Math.min(validIds.length, 50)
          })
        },
        10000
      );

      if (!resp.ok) {
        continue;
      }

      const json = await resp.json().catch(() => null);
      const results = json?.hits?.results || [];
      if (results.length > 0) {
        const items = results.map((hit) => ({
          assetId: hit.assetId || hit.repositoryMetadata?.['repo:assetId'],
          ok: true,
          status: 200,
          data: {
            assetId: hit.assetId,
            assetMetadata: hit.assetMetadata || {},
            repositoryMetadata: hit.repositoryMetadata || {}
          },
          etag: null
        }));
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: { available: true, items }
        };
      }
    } catch {
      // Fall through to next field candidate or caller fallback
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: { available: false, items: [] }
  };
}

async function handleGetMetadata(aemHost, params) {
  const { assetId } = params;
  if (!validateAssetId(assetId)) {
    return errorResponse(400, 'Invalid or missing assetId');
  }

  const res = await fetchSingleAssetMetadata(aemHost, assetId, buildHeaders(params));
  if (!res.ok) {
    return errorResponse(res.status, res.error, res.details);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      ...res.data,
      etag: res.etag
    }
  };
}

async function handleGetMetadataBatch(aemHost, params) {
  const { assetIds } = params;
  if (!Array.isArray(assetIds) || assetIds.length === 0 || assetIds.length > 50) {
    return errorResponse(400, 'assetIds must be an array of 1 to 50 asset IDs');
  }

  const headers = buildHeaders(params);
  const items = await runWithConcurrency(assetIds, 3, async (assetId) => {
    if (!validateAssetId(assetId)) {
      return { assetId, ok: false, status: 400, error: 'Invalid assetId' };
    }
    try {
      return await fetchSingleAssetMetadata(aemHost, assetId, headers);
    } catch (err) {
      return { assetId, ok: false, status: 502, error: err.message };
    }
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: { items }
  };
}

async function patchSingleAssetMetadata(aemHost, { assetId, etag, patch }, params) {
  const url = `${aemHost}/adobe/assets/${encodeURIComponent(assetId)}/metadata`;

  // AEM Assets Author API requires If-Match; use asset's ETag when available or "*" fallback
  const extraHeaders = {
    'Content-Type': 'application/json-patch+json',
    'If-Match': etag || '*'
  };

  let lastStatus = 504;
  let lastBody = null;
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const resp = await fetchWithTimeout(
        url,
        {
          method: 'PATCH',
          headers: buildHeaders(params, extraHeaders),
          body: JSON.stringify(patch)
        },
        12000
      );

      const text = await resp.text();
      let body;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { raw: text };
      }

      if (resp.ok) {
        return {
          assetId,
          ok: true,
          status: 200,
          data: body,
          etag: resp.headers.get('etag') || null
        };
      }

      lastStatus = resp.status;
      lastBody = body;

      // If 412 Precondition Failed with a stale ETag, retry once with "*"
      if (resp.status === 412 && extraHeaders['If-Match'] !== '*' && attempt === 0) {
        extraHeaders['If-Match'] = '*';
        continue;
      }

      if (RETRYABLE_STATUSES.has(resp.status) && attempt === 0) {
        await sleep(500);
        continue;
      }

      const detail = body?.detail || body?.title || body?.message || body?.raw || '';
      return {
        assetId,
        ok: false,
        status: resp.status,
        error: `HTTP ${resp.status}${detail ? `: ${detail}` : ''}`,
        details: body
      };
    } catch (err) {
      lastError = err;
      lastStatus = err?.name === 'AbortError' ? 504 : 502;
      if (attempt === 0) {
        await sleep(500);
      }
    }
  }

  return {
    assetId,
    ok: false,
    status: lastStatus,
    error: lastError?.message || `HTTP ${lastStatus}: PATCH timed out`,
    details: lastBody
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

  const res = await patchSingleAssetMetadata(aemHost, { assetId, etag, patch }, params);
  if (!res.ok) {
    return errorResponse(res.status, res.error, res.details);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      ...res.data,
      etag: res.etag
    }
  };
}

async function handlePatchMetadataBatch(aemHost, params) {
  const { patches } = params;
  if (!Array.isArray(patches) || patches.length === 0 || patches.length > 50) {
    return errorResponse(400, 'patches must be an array of 1 to 50 patch items');
  }

  const items = await runWithConcurrency(patches, 3, async (entry) => {
    if (!entry || !validateAssetId(entry.assetId) || !Array.isArray(entry.patch) || entry.patch.length === 0) {
      return { assetId: entry?.assetId, ok: false, status: 400, error: 'Invalid patch entry' };
    }
    try {
      return await patchSingleAssetMetadata(aemHost, entry, params);
    } catch (err) {
      return { assetId: entry.assetId, ok: false, status: 502, error: err.message };
    }
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: { items }
  };
}

async function handleGetMetadataForms(aemHost, params) {
  const source = params.source === 'admin' ? 'admin' : 'assetsview';
  const formPath =
    source === 'admin'
      ? '/conf/global/settings/dam/adminui-extension/metadataschema.infinity.json'
      : '/content/dam/appdata/metadataforms.infinity.json';

  const url = `${aemHost}${formPath}`;
  const resp = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: buildHeaders(params),
      redirect: 'manual'
    },
    6000
  );

  if (resp.status === 404 || resp.status === 403 || (resp.status >= 300 && resp.status < 400)) {
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
 * Checks all ancestor folders from `folderPath` up to `/content/dam` IN PARALLEL
 * for a folder-assigned metadata schema/form property, picking the deepest match.
 */
async function handleGetFolderSchema(aemHost, params) {
  const folderPath = validateDamPath(params.folderPath);
  if (!folderPath) {
    return errorResponse(400, 'Invalid folderPath. Must start with /content/dam');
  }

  const headers = buildHeaders(params);
  const parts = folderPath.split('/').filter(Boolean);
  const candidates = [];
  for (let len = parts.length; len >= 2; len -= 1) {
    candidates.push('/' + parts.slice(0, len).join('/'));
  }

  const checks = await Promise.all(
    candidates.map(async (candidate) => {
      const url = `${aemHost}${encodeJcrPath(candidate)}/jcr:content.json`;
      try {
        const resp = await fetchWithTimeout(
          url,
          { method: 'GET', headers, redirect: 'manual' },
          5000
        );
        if (!resp.ok) return null;
        const jcrContent = await resp.json().catch(() => null);
        if (!jcrContent || typeof jcrContent !== 'object') return null;

        for (const propName of FOLDER_SCHEMA_PROPS) {
          const rawVal = jcrContent[propName];
          if (typeof rawVal === 'string' && rawVal.trim().length > 0) {
            return { candidate, propName, schemaRef: rawVal.trim() };
          }
        }
      } catch {
        // Ignore individual ancestor read errors
      }
      return null;
    })
  );

  // Pick the deepest (first) matching ancestor
  const match = checks.find(Boolean);
  if (match) {
    const formId = match.schemaRef.split('/').filter(Boolean).pop().toLowerCase();
    let formNode = null;
    const safeSchemaPath = validateSchemaPath(match.schemaRef);
    if (safeSchemaPath) {
      try {
        const schemaResp = await fetchWithTimeout(
          `${aemHost}${encodeJcrPath(safeSchemaPath)}.infinity.json`,
          { method: 'GET', headers, redirect: 'manual' },
          6000
        );
        if (schemaResp.ok) {
          formNode = await schemaResp.json().catch(() => null);
        }
      } catch {
        // Fall back to forms tree
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        found: true,
        assignedAt: match.candidate,
        property: match.propName,
        schemaRef: match.schemaRef,
        formId,
        formNode
      }
    };
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
      const resp = await fetchWithTimeout(
        url,
        { method: 'GET', headers, redirect: 'manual' },
        5000
      );
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

/**
 * Flattens an AEM `/content/cq:tags.infinity.json` tree into searchable tag entries.
 */
function flattenTagTree(rootNode, maxTags = 2000) {
  const tags = [];
  if (!rootNode || typeof rootNode !== 'object') return tags;

  function walk(node, namespace, pathSegments, titleSegments) {
    if (tags.length >= maxTags || !node || typeof node !== 'object') return;

    for (const [key, child] of Object.entries(node)) {
      if (tags.length >= maxTags) break;
      if (key.startsWith('jcr:') || key.startsWith('sling:') || key.startsWith('rep:')) continue;
      if (!child || typeof child !== 'object') continue;

      const isTag = child['jcr:primaryType'] === 'cq:Tag';
      const title = child['jcr:title'] || key;

      if (!namespace) {
        // Top-level namespace node (e.g., "brand", "properties", "we-retail")
        if (isTag) {
          walk(child, key, [], [title]);
        }
      } else if (isTag) {
        const nextPath = [...pathSegments, key];
        const nextTitles = [...titleSegments, title];
        const id = `${namespace}:${nextPath.join('/')}`;
        tags.push({
          id,
          title,
          displayPath: nextTitles.join(' / ')
        });
        walk(child, namespace, nextPath, nextTitles);
      }
    }
  }

  walk(rootNode, null, [], []);
  return tags;
}

async function handleGetTags(aemHost, params) {
  const url = `${aemHost}/content/cq:tags.infinity.json`;
  const resp = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: buildHeaders(params),
      redirect: 'manual'
    },
    6000
  );

  if (!resp.ok) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { available: false, status: resp.status, tags: [] }
    };
  }

  const tree = await resp.json().catch(() => null);
  const tags = flattenTagTree(tree);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: { available: true, tags }
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
      case 'getMetadataBatch':
        return await handleGetMetadataBatch(aemHost, params);
      case 'searchMetadata':
        return await handleSearchMetadata(aemHost, params);
      case 'patchMetadata':
        return await handlePatchMetadata(aemHost, params);
      case 'patchMetadataBatch':
        return await handlePatchMetadataBatch(aemHost, params);
      case 'getMetadataForms':
        return await handleGetMetadataForms(aemHost, params);
      case 'getFolderSchema':
        return await handleGetFolderSchema(aemHost, params);
      case 'getThumbnail':
        return await handleGetThumbnail(aemHost, params);
      case 'getTags':
        return await handleGetTags(aemHost, params);
      default:
        return errorResponse(
          400,
          'Unsupported operation. Expected one of: getMetadata, getMetadataBatch, patchMetadata, patchMetadataBatch, getMetadataForms, getFolderSchema, getThumbnail, getTags'
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
exports.flattenTagTree = flattenTagTree;
