import React, { useEffect, useState } from 'react';
import { attach } from '@adobe/uix-guest';
import {
  Button,
  Content,
  Flex,
  Heading,
  InlineAlert,
  ProgressCircle,
  Provider,
  Text,
  View,
  defaultTheme
} from '@adobe/react-spectrum';
import { extensionId } from './Constants';
import {
  fetchAemTags,
  fetchAllAssetsMetadata,
  fetchAssetThumbnails,
  fetchSchemaRegistry,
  saveBulkMetadata
} from '../services/aemClient';
import BulkMetadataEditor from './BulkMetadataEditor';

const EXT_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  heic: 'image/heic',
  avif: 'image/avif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  pdf: 'application/pdf',
  ai: 'application/postscript',
  eps: 'application/postscript',
  psd: 'image/vnd.adobe.photoshop',
  indd: 'application/x-indesign'
};

function inferMimeFromName(name) {
  const ext = String(name || '').split('.').pop()?.toLowerCase();
  return (ext && EXT_TO_MIME[ext]) || '';
}

function buildInitialAssetStubs(resources) {
  return resources.map((r) => {
    const name = r.path ? r.path.split('/').pop() : r.id;
    return {
      id: r.id,
      path: r.path || '',
      name,
      mimeType: r.mimeType || inferMimeFromName(name),
      etag: null,
      assetMetadata: {},
      repositoryMetadata: {},
      metadataLoaded: false
    };
  });
}

export default function BulkMetadataModal() {
  const [guestConnection, setGuestConnection] = useState(null);
  const [colorScheme, setColorScheme] = useState('light');
  const [authContext, setAuthContext] = useState(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [assets, setAssets] = useState([]);
  const [metadataProgress, setMetadataProgress] = useState(null);
  const [loadErrors, setLoadErrors] = useState([]);
  const [retryingLoad, setRetryingLoad] = useState(false);
  const [thumbnailsById, setThumbnailsById] = useState({});
  const [availableTags, setAvailableTags] = useState([]);
  const [schemaRegistry, setSchemaRegistry] = useState(null);

  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(null);
  const [saveResult, setSaveResult] = useState(null);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const connection = await attach({ id: extensionId });
        if (!active) return;
        setGuestConnection(connection);

        const [themeInfo, imsInfo, apiKey, aemHost, payload] = await Promise.all([
          connection.host.theme.getThemeInfo(),
          connection.host.auth.getIMSInfo(),
          connection.host.auth.getApiKey(),
          connection.host.discovery.getAemHost(),
          connection.host.modal.getPayload()
        ]);

        if (!active) return;
        setColorScheme(themeInfo?.colorScheme || 'light');

        const auth = {
          aemHost,
          accessToken: imsInfo?.accessToken,
          imsOrg: imsInfo?.imsOrg,
          apiKey
        };
        setAuthContext(auth);

        const resources = payload?.resources || [];
        if (resources.length === 0) {
          setLoadError('No assets were passed to the Bulk Metadata Editor.');
          setLoading(false);
          return;
        }

        const initialStubs = buildInitialAssetStubs(resources);

        // 1. Resolve only the metadata form/schema first (~300ms) so the modal opens immediately
        const registry = await fetchSchemaRegistry(auth, resources);
        if (!active) return;

        setAssets(initialStubs);
        setSchemaRegistry(registry);
        setMetadataProgress({ completed: 0, total: resources.length });
        setLoading(false);

        // 2. Stream existing asset metadata in the background without blocking editing
        fetchAllAssetsMetadata(
          resources,
          auth,
          (completed, total) => {
            if (active) {
              setMetadataProgress(completed < total ? { completed, total } : null);
            }
          },
          (batchAssets) => {
            if (!active || !batchAssets?.length) return;
            const byId = new Map(batchAssets.map((a) => [a.id, { ...a, metadataLoaded: true }]));
            setAssets((prev) => prev.map((item) => byId.get(item.id) || item));
          }
        ).then((metadataResult) => {
          if (!active) return;
          setMetadataProgress(null);
          setLoadErrors(metadataResult.errors || []);
        });

        // 3. Lazily load thumbnails & AEM tag taxonomy in the background
        fetchAssetThumbnails(initialStubs, auth, (assetId, dataUrl) => {
          if (active) {
            setThumbnailsById((prev) => ({ ...prev, [assetId]: dataUrl }));
          }
        });
        fetchAemTags(auth).then((tags) => {
          if (active && tags.length > 0) {
            setAvailableTags(tags);
          }
        });
      } catch (err) {
        if (active) {
          setLoadError(err.message || 'Failed to initialize Bulk Metadata Editor.');
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const closeDialog = () => {
    guestConnection?.host?.modal?.closeDialog();
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !saving) {
        if (document.querySelector('[role="dialog"], [role="listbox"]')) {
          return;
        }
        e.preventDefault();
        guestConnection?.host?.modal?.closeDialog();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [guestConnection, saving]);

  const handleRetryFailedLoad = async () => {
    if (!authContext || loadErrors.length === 0 || retryingLoad) return;
    setRetryingLoad(true);
    try {
      const retryResources = loadErrors.map((e) => ({ id: e.id, path: e.path }));
      const retryRes = await fetchAllAssetsMetadata(retryResources, authContext);
      if (retryRes.assets.length > 0) {
        const byId = new Map(
          retryRes.assets.map((a) => [a.id, { ...a, metadataLoaded: true }])
        );
        setAssets((prev) => prev.map((item) => byId.get(item.id) || item));
      }
      setLoadErrors(retryRes.errors || []);
    } finally {
      setRetryingLoad(false);
    }
  };

  const handleSave = async (activeAssets, dirtyEdits, fieldsByProperty) => {
    if (!authContext || !activeAssets?.length) return;
    setSaving(true);
    setSaveResult(null);
    setSaveProgress({ completed: 0, total: activeAssets.length });

    try {
      const result = await saveBulkMetadata(
        activeAssets,
        dirtyEdits,
        fieldsByProperty,
        authContext,
        (completed, total) => setSaveProgress({ completed, total })
      );

      setSaveResult(result);

      if (result.failed.length === 0) {
        const updatedCount = result.succeeded.length;
        await guestConnection?.host?.toast?.display({
          variant: 'positive',
          message: `Updated metadata on ${updatedCount} ${
            updatedCount === 1 ? 'asset' : 'assets'
          }.`
        });
        closeDialog();
      } else {
        await guestConnection?.host?.toast?.display({
          variant: 'negative',
          message: `Updated ${result.succeeded.length} assets, but ${result.failed.length} failed.`
        });
      }
    } catch (err) {
      setSaveResult({
        succeeded: [],
        skipped: [],
        failed: [{ id: 'batch', name: 'Batch update', message: err.message }]
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Provider theme={defaultTheme} colorScheme={colorScheme} height="100vh">
      {loading ? (
        <Flex
          direction="column"
          alignItems="center"
          justifyContent="center"
          height="100%"
          gap="size-200"
          padding="size-300"
        >
          <ProgressCircle aria-label="Loading metadata form" isIndeterminate size="L" />
          <Text>Loading metadata form…</Text>
        </Flex>
      ) : loadError ? (
        <View padding="size-400" maxWidth="size-6000" marginX="auto">
          <InlineAlert variant="negative" width="100%">
            <Heading>Unable to open Bulk Metadata Editor</Heading>
            <Content>{loadError}</Content>
          </InlineAlert>
          <Flex marginTop="size-200" justifyContent="end">
            <Button variant="primary" onPress={closeDialog}>
              Close
            </Button>
          </Flex>
        </View>
      ) : (
        <BulkMetadataEditor
          assets={assets}
          metadataProgress={metadataProgress}
          loadErrors={loadErrors}
          retryingLoad={retryingLoad}
          onRetryLoad={handleRetryFailedLoad}
          thumbnailsById={thumbnailsById}
          availableTags={availableTags}
          schemaRegistry={schemaRegistry}
          onSave={handleSave}
          onCancel={closeDialog}
          saving={saving}
          saveProgress={saveProgress}
          saveResult={saveResult}
        />
      )}
    </Provider>
  );
}
