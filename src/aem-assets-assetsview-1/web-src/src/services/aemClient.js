/**
 * AEM Assets Author API & Metadata Form client.
 *
 * Automatically routes through the App Builder Runtime proxy (`aem-metadata-proxy`)
 * when configured in `config.json`, or calls AEM Author directly when CORS is enabled.
 */

import config from '../config.json';
import { createSchemaRegistry, parseAemSchemaTree } from './schemaResolver';
import { buildJsonPatchForAsset } from './metadataDiff';

const DEFAULT_CONCURRENCY = 5;

function getProxyUrl() {
  return (
    config['aem-assets-bulk-metadata/aem-metadata-proxy'] ||
    config['aem-metadata-proxy'] ||
    null
  );
}

function normalizeHost(aemHost) {
  const trimmed = String(aemHost || '').trim().replace(/\/+$/, '');
  return trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`;
}

/**
 * Runs an async worker over `items` with bounded concurrency.
 */
async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function callProxy(proxyUrl, payload, { accessToken, apiKey }) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`
  };
  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
  }

  const resp = await fetch(proxyUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data.error || `Proxy request failed (${resp.status})`);
    err.status = resp.status;
    err.details = data.details;
    throw err;
  }
  return data;
}

/**
 * Fetches metadata + ETag for a single asset.
 */
export async function fetchAssetMetadata(resource, authContext) {
  const { aemHost, accessToken, apiKey } = authContext;
  const proxyUrl = getProxyUrl();

  let data;
  let etag = null;

  if (proxyUrl) {
    data = await callProxy(
      proxyUrl,
      {
        operation: 'getMetadata',
        aemHost: normalizeHost(aemHost),
        assetId: resource.id,
        apiKey
      },
      authContext
    );
    etag = data.etag || null;
  } else {
    const url = `${normalizeHost(aemHost)}/adobe/assets/${encodeURIComponent(resource.id)}/metadata`;
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`
    };
    if (apiKey) {
      headers['X-Api-Key'] = apiKey;
    }

    const resp = await fetch(url, { method: 'GET', headers });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const err = new Error(`Failed to fetch metadata (${resp.status}): ${text}`);
      err.status = resp.status;
      throw err;
    }
    etag = resp.headers.get('etag');
    data = await resp.json();
  }

  const repoMeta = data.repositoryMetadata || {};
  const assetMeta = data.assetMetadata || {};
  const name =
    repoMeta['repo:name'] ||
    (resource.path ? resource.path.split('/').pop() : resource.id);

  return {
    id: resource.id,
    path: resource.path || repoMeta['repo:path'] || '',
    name,
    mimeType: repoMeta['dc:format'] || assetMeta['dc:format'] || '',
    etag,
    assetMetadata: assetMeta,
    repositoryMetadata: repoMeta
  };
}

/**
 * Fetches metadata for all selected assets with bounded concurrency.
 */
export async function fetchAllAssetsMetadata(resources, authContext, onProgress) {
  let completed = 0;
  const loaded = [];
  const errors = [];

  await mapWithConcurrency(resources, DEFAULT_CONCURRENCY, async (resource) => {
    try {
      const asset = await fetchAssetMetadata(resource, authContext);
      loaded.push(asset);
    } catch (err) {
      errors.push({
        id: resource.id,
        path: resource.path,
        message: err.message,
        status: err.status
      });
    } finally {
      completed += 1;
      if (onProgress) {
        onProgress(completed, resources.length);
      }
    }
  });

  return { assets: loaded, errors };
}

/**
 * Loads custom metadata forms from AEM Author (trying Assets View forms first,
 * then Admin View metadata schemas) and merges with built-in defaults.
 */
export async function fetchSchemaRegistry(authContext) {
  const { aemHost, accessToken, apiKey } = authContext;
  const proxyUrl = getProxyUrl();

  for (const source of ['assetsview', 'admin']) {
    try {
      let formsTree = null;
      if (proxyUrl) {
        const res = await callProxy(
          proxyUrl,
          {
            operation: 'getMetadataForms',
            aemHost: normalizeHost(aemHost),
            source,
            apiKey
          },
          authContext
        );
        if (res.available && res.formsTree) {
          formsTree = res.formsTree;
        }
      } else {
        const path =
          source === 'admin'
            ? '/conf/global/settings/dam/adminui-extension/metadataschema.infinity.json'
            : '/content/dam/appdata/metadataforms.infinity.json';
        const resp = await fetch(`${normalizeHost(aemHost)}${path}`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`
          }
        });
        if (resp.ok) {
          formsTree = await resp.json();
        }
      }

      if (formsTree) {
        const parsed = parseAemSchemaTree(formsTree);
        if (Object.keys(parsed.formsById).length > 0) {
          return createSchemaRegistry(parsed);
        }
      }
    } catch {
      // Fall through to next source or built-in defaults
    }
  }

  return createSchemaRegistry();
}

/**
 * Applies bulk metadata edits to all selected assets using RFC 6902 JSON Patch.
 */
export async function saveBulkMetadata(assets, dirtyEdits, fieldsByProperty, authContext, onProgress) {
  const { aemHost, accessToken, apiKey } = authContext;
  const proxyUrl = getProxyUrl();

  let completed = 0;
  const succeeded = [];
  const skipped = [];
  const failed = [];

  await mapWithConcurrency(assets, DEFAULT_CONCURRENCY, async (asset) => {
    const patch = buildJsonPatchForAsset(asset.assetMetadata, dirtyEdits, fieldsByProperty);
    if (patch.length === 0) {
      skipped.push({ id: asset.id, name: asset.name, path: asset.path });
      completed += 1;
      if (onProgress) onProgress(completed, assets.length);
      return;
    }

    try {
      if (proxyUrl) {
        await callProxy(
          proxyUrl,
          {
            operation: 'patchMetadata',
            aemHost: normalizeHost(aemHost),
            assetId: asset.id,
            etag: asset.etag,
            patch,
            apiKey
          },
          authContext
        );
      } else {
        const url = `${normalizeHost(aemHost)}/adobe/assets/${encodeURIComponent(asset.id)}/metadata`;
        const headers = {
          'Content-Type': 'application/json-patch+json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`
        };
        if (apiKey) headers['X-Api-Key'] = apiKey;
        if (asset.etag) headers['If-Match'] = asset.etag;

        const resp = await fetch(url, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(patch)
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          const err = new Error(`PATCH failed (${resp.status}): ${text}`);
          err.status = resp.status;
          throw err;
        }
      }

      succeeded.push({ id: asset.id, name: asset.name, path: asset.path });
    } catch (err) {
      failed.push({
        id: asset.id,
        name: asset.name,
        path: asset.path,
        status: err.status,
        message: err.message
      });
    } finally {
      completed += 1;
      if (onProgress) onProgress(completed, assets.length);
    }
  });

  return { succeeded, skipped, failed };
}
