import React, { useEffect, useState } from 'react';
import { attach } from '@adobe/uix-guest';
import {
  Button,
  Content,
  Flex,
  Heading,
  InlineAlert,
  ProgressBar,
  ProgressCircle,
  Provider,
  Text,
  View,
  defaultTheme
} from '@adobe/react-spectrum';
import { extensionId } from './Constants';
import {
  fetchAllAssetsMetadata,
  fetchSchemaRegistry,
  saveBulkMetadata
} from '../services/aemClient';
import BulkMetadataEditor from './BulkMetadataEditor';

export default function BulkMetadataModal() {
  const [guestConnection, setGuestConnection] = useState(null);
  const [colorScheme, setColorScheme] = useState('light');
  const [authContext, setAuthContext] = useState(null);

  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState({ completed: 0, total: 0 });
  const [loadError, setLoadError] = useState(null);

  const [assets, setAssets] = useState([]);
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

        setLoadProgress({ completed: 0, total: resources.length });

        const [metadataResult, registry] = await Promise.all([
          fetchAllAssetsMetadata(resources, auth, (completed, total) => {
            if (active) setLoadProgress({ completed, total });
          }),
          fetchSchemaRegistry(auth)
        ]);

        if (!active) return;

        if (metadataResult.assets.length === 0) {
          const firstErr = metadataResult.errors[0]?.message || 'Unable to read asset metadata.';
          setLoadError(firstErr);
        } else {
          setAssets(metadataResult.assets);
          setSchemaRegistry(registry);
        }
      } catch (err) {
        if (active) {
          setLoadError(err.message || 'Failed to initialize Bulk Metadata Editor.');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const closeDialog = () => {
    guestConnection?.host?.modal?.closeDialog();
  };

  const handleSave = async (dirtyEdits, fieldsByProperty) => {
    if (!authContext) return;
    setSaving(true);
    setSaveResult(null);
    setSaveProgress({ completed: 0, total: assets.length });

    try {
      const result = await saveBulkMetadata(
        assets,
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
          <ProgressCircle aria-label="Loading asset metadata" isIndeterminate size="L" />
          <Text>
            Loading metadata &amp; resolving common schemas ({loadProgress.completed}/
            {loadProgress.total})…
          </Text>
          {loadProgress.total > 0 && (
            <ProgressBar
              aria-label="Metadata load progress"
              value={loadProgress.completed}
              maxValue={loadProgress.total}
              width="size-3600"
            />
          )}
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
