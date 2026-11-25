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
const BATCH_CHUNK_SIZE = 5;

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function normalizeLoadedAsset(resource, data, etag) {
  const repoMeta = data?.repositoryMetadata || {};
  const assetMeta = data?.assetMetadata || {};
  const name =
    repoMeta['repo:name'] ||
    (resource.path ? resource.path.split('/').pop() : resource.id);

  return {
    id: resource.id,
    path: resource.path || repoMeta['repo:path'] || '',
    name,
    mimeType: repoMeta['dc:format'] || assetMeta['dc:format'] || '',
    etag: etag || null,
    assetMetadata: assetMeta,
    repositoryMetadata: repoMeta
  };
}

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

async function callProxy(proxyUrl, payload, { accessToken, apiKey, imsOrg }) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`
  };
  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
  }
  if (imsOrg) {
    headers['x-gw-ims-org-id'] = imsOrg;
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
 * Fetches metadata for all selected assets.
 * When using the App Builder proxy, batches up to 25 assets into a single HTTP request
 * (`getMetadataBatch`) so Runtime fetches them in parallel over Adobe's internal network.
 */
export async function fetchAllAssetsMetadata(resources, authContext, onProgress) {
  const proxyUrl = getProxyUrl();
  let completed = 0;
  const loaded = [];
  const errors = [];

  if (proxyUrl && resources.length > 1) {
    const resourceById = new Map(resources.map((r) => [r.id, r]));
    const chunks = chunkArray(resources, BATCH_CHUNK_SIZE);

    await mapWithConcurrency(chunks, 2, async (chunk) => {
      try {
        const res = await callProxy(
          proxyUrl,
          {
            operation: 'getMetadataBatch',
            aemHost: normalizeHost(authContext.aemHost),
            assetIds: chunk.map((r) => r.id),
            apiKey: authContext.apiKey
          },
          authContext
        );

        for (const item of res.items || []) {
          const resource = resourceById.get(item.assetId) || { id: item.assetId };
          if (item.ok) {
            loaded.push(normalizeLoadedAsset(resource, item.data, item.etag));
          } else {
            errors.push({
              id: resource.id,
              path: resource.path,
              message: item.error || `Failed (${item.status})`,
              status: item.status
            });
          }
          completed += 1;
        }
        if (onProgress) {
          onProgress(completed, resources.length);
        }
      } catch {
        // Automatic fallback to per-asset calls if a batch hits a gateway timeout (504/502)
        await mapWithConcurrency(chunk, 3, async (resource) => {
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
      }
    });

    return { assets: loaded, errors };
  }

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
 * Extracts unique parent folder paths from an array of resources/assets.
 */
function extractUniqueParentFolders(resources = []) {
  const folders = new Set();
  for (const r of resources) {
    if (!r?.path || typeof r.path !== 'string') continue;
    const parts = r.path.split('/').filter(Boolean);
    parts.pop(); // remove filename
    if (parts.length >= 2) {
      folders.add('/' + parts.join('/'));
    }
  }
  return Array.from(folders);
}

/**
 * Queries folder `jcr:content` ancestors for folder-assigned metadata schemas.
 * When all selected assets are in the same folder, only a single lookup is performed.
 */
async function fetchFolderSchemas(resources, authContext) {
  const { aemHost, accessToken, apiKey } = authContext;
  const proxyUrl = getProxyUrl();
  const uniqueFolders = extractUniqueParentFolders(resources);

  const formsById = {};
  const folderAssignments = {};
  let resolvedCount = 0;

  await mapWithConcurrency(uniqueFolders, DEFAULT_CONCURRENCY, async (folderPath) => {
    try {
      let result = null;
      if (proxyUrl) {
        result = await callProxy(
          proxyUrl,
          {
            operation: 'getFolderSchema',
            aemHost: normalizeHost(aemHost),
            folderPath,
            apiKey
          },
          authContext
        );
      } else {
        // Direct mode: walk up ancestor folders checking jcr:content.json
        const parts = folderPath.split('/').filter(Boolean);
        while (parts.length >= 2) {
          const candidate = '/' + parts.join('/');
          const encoded = candidate.split('/').map(encodeURIComponent).join('/');
          const resp = await fetch(`${normalizeHost(aemHost)}${encoded}/jcr:content.json`, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${accessToken}`
            }
          });
          if (resp.ok) {
            const jcr = await resp.json().catch(() => null);
            const ref =
              jcr?.assetsViewMetadataForm ||
              jcr?.metadataForm ||
              jcr?.metadataSchema ||
              jcr?.['dam:metadataSchema'];
            if (typeof ref === 'string' && ref.trim()) {
              result = {
                found: true,
                assignedAt: candidate,
                schemaRef: ref.trim(),
                formId: ref.trim().split('/').filter(Boolean).pop().toLowerCase(),
                formNode: null
              };
              break;
            }
          }
          parts.pop();
        }
      }

      if (result?.found && result.formId && result.assignedAt) {
        folderAssignments[result.assignedAt] = result.formId;
        if (result.formNode) {
          const parsed = parseAemSchemaTree({ [result.formId]: result.formNode });
          if (Object.keys(parsed.formsById).length > 0) {
            Object.assign(formsById, parsed.formsById);
            resolvedCount += 1;
          }
        }
      }
    } catch {
      // Non-fatal: fall back to forms tree or MIME-type defaults
    }
  });

  return { formsById, folderAssignments, allResolved: uniqueFolders.length > 0 && resolvedCount === uniqueFolders.length };
}

/**
 * Loads custom metadata forms from AEM Author (folder `jcr:content` assignments +
 * Assets View metadata forms + Admin View metadata schemas) and merges with defaults.
 */
export async function fetchSchemaRegistry(authContext, resources = []) {
  const { aemHost, accessToken, apiKey } = authContext;
  const proxyUrl = getProxyUrl();

  const mergedFormsById = {};
  const mergedFolderAssignments = {};

  // 1. Check folder-level metadata schema assignments on ancestor jcr:content nodes
  const folderResult = await fetchFolderSchemas(resources, authContext);
  Object.assign(mergedFormsById, folderResult.formsById);
  Object.assign(mergedFolderAssignments, folderResult.folderAssignments);

  // If every selected folder resolved its exact schema directly, skip downloading the full forms tree
  if (folderResult.allResolved) {
    return createSchemaRegistry({
      formsById: mergedFormsById,
      folderAssignments: mergedFolderAssignments
    });
  }

  // 2. Load organization metadata forms tree (Assets View first, then Admin View)
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
        Object.assign(mergedFormsById, parsed.formsById);
        // Folder jcr:content assignments take precedence over form-node folderPaths
        Object.assign(mergedFolderAssignments, parsed.folderAssignments, folderResult.folderAssignments);
        if (Object.keys(parsed.formsById).length > 0) {
          break;
        }
      }
    } catch {
      // Fall through to next source or built-in defaults
    }
  }

  return createSchemaRegistry({
    formsById: mergedFormsById,
    folderAssignments: mergedFolderAssignments
  });
}

/**
 * Lazily fetches small thumbnail data URLs for selected assets in the background.
 * Calls `onThumbnail(assetId, dataUrl)` as each thumbnail resolves.
 */
export async function fetchAssetThumbnails(assets, authContext, onThumbnail) {
  const { aemHost, apiKey } = authContext;
  const proxyUrl = getProxyUrl();
  if (!proxyUrl || !Array.isArray(assets) || assets.length === 0) {
    return;
  }

  await mapWithConcurrency(assets, 4, async (asset) => {
    try {
      const res = await callProxy(
        proxyUrl,
        {
          operation: 'getThumbnail',
          aemHost: normalizeHost(aemHost),
          assetId: asset.id,
          assetPath: asset.path,
          apiKey
        },
        authContext
      );
      if (res?.available && res.dataUrl && onThumbnail) {
        onThumbnail(asset.id, res.dataUrl);
      }
    } catch {
      // Non-fatal: UI keeps the Spectrum file-type icon fallback
    }
  });
}

/**
 * Lazily fetches AEM taxonomy tags (`/content/cq:tags`) for the searchable Tag Picker.
 */
export async function fetchAemTags(authContext) {
  const { aemHost, accessToken, apiKey } = authContext;
  const proxyUrl = getProxyUrl();

  try {
    if (proxyUrl) {
      const res = await callProxy(
        proxyUrl,
        {
          operation: 'getTags',
          aemHost: normalizeHost(aemHost),
          apiKey
        },
        authContext
      );
      return res?.available && Array.isArray(res.tags) ? res.tags : [];
    }

    const resp = await fetch(`${normalizeHost(aemHost)}/content/cq:tags.infinity.json`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!resp.ok) return [];
    // Direct mode fallback returns empty array if not flattened server-side
    return [];
  } catch {
    return [];
  }
}

/**
 * Applies bulk metadata edits to all selected assets using RFC 6902 JSON Patch.
 * Batches up to 25 patches per proxy call when using the App Builder proxy.
 */
export async function saveBulkMetadata(assets, dirtyEdits, fieldsByProperty, authContext, onProgress) {
  const { aemHost, accessToken, apiKey } = authContext;
  const proxyUrl = getProxyUrl();

  let completed = 0;
  const succeeded = [];
  const skipped = [];
  const failed = [];

  const toPatch = [];
  for (const asset of assets) {
    const patch = buildJsonPatchForAsset(asset.assetMetadata, dirtyEdits, fieldsByProperty);
    if (patch.length === 0) {
      skipped.push({ id: asset.id, name: asset.name, path: asset.path });
      completed += 1;
    } else {
      toPatch.push({ asset, patch });
    }
  }
  if (onProgress && skipped.length > 0) {
    onProgress(completed, assets.length);
  }

  if (proxyUrl && toPatch.length > 1) {
    const assetById = new Map(toPatch.map(({ asset }) => [asset.id, asset]));
    const chunks = chunkArray(toPatch, BATCH_CHUNK_SIZE);

    for (const chunk of chunks) {
      try {
        const res = await callProxy(
          proxyUrl,
          {
            operation: 'patchMetadataBatch',
            aemHost: normalizeHost(aemHost),
            patches: chunk.map(({ asset, patch }) => ({
              assetId: asset.id,
              etag: asset.etag,
              patch
            })),
            apiKey
          },
          authContext
        );

        for (const item of res.items || []) {
          const asset = assetById.get(item.assetId) || { id: item.assetId, name: item.assetId };
          if (item.ok) {
            succeeded.push({ id: asset.id, name: asset.name, path: asset.path });
          } else {
            failed.push({
              id: asset.id,
              name: asset.name,
              path: asset.path,
              status: item.status,
              message: item.error || `PATCH failed (${item.status})`
            });
          }
          completed += 1;
        }
      } catch (err) {
        for (const { asset } of chunk) {
          failed.push({
            id: asset.id,
            name: asset.name,
            path: asset.path,
            status: err.status,
            message: err.message
          });
          completed += 1;
        }
      }

      if (onProgress) {
        onProgress(completed, assets.length);
      }
    }

    return { succeeded, skipped, failed };
  }

  await mapWithConcurrency(toPatch, DEFAULT_CONCURRENCY, async ({ asset, patch }) => {
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
