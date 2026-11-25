import React, { useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Content,
  Divider,
  Flex,
  Heading,
  InlineAlert,
  Provider,
  Text,
  View,
  defaultTheme
} from '@adobe/react-spectrum';
import { MOCK_ASSETS, MOCK_SCHEMA_REGISTRY } from '../services/mockData';
import { buildJsonPatchForAsset } from '../services/metadataDiff';
import BulkMetadataEditor from './BulkMetadataEditor';

/**
 * Local standalone demo sandbox (`/#/demo`) so you can test schema intersection,
 * <Mixed Entries>, Append vs. Replace tags, and inspect generated RFC 6902 JSON Patches
 * right in the browser without an AEM Assets View host.
 */
export default function DemoSandbox() {
  const [selectedIds, setSelectedIds] = useState([MOCK_ASSETS[0].id, MOCK_ASSETS[1].id]);
  const [editorOpen, setEditorOpen] = useState(true);
  const [lastPatches, setLastPatches] = useState(null);

  const selectedAssets = MOCK_ASSETS.filter((a) => selectedIds.includes(a.id));

  const toggleAsset = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setLastPatches(null);
  };

  const handleSave = (dirtyEdits, fieldsByProperty) => {
    const patches = selectedAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      etag: asset.etag,
      patch: buildJsonPatchForAsset(asset.assetMetadata, dirtyEdits, fieldsByProperty)
    }));
    setLastPatches(patches);
    setEditorOpen(false);
  };

  return (
    <Provider theme={defaultTheme} colorScheme="light" height="100vh">
      <Flex height="100%">
        {/* Left selection sidebar */}
        <View
          width="size-3600"
          padding="size-200"
          backgroundColor="gray-100"
          borderEndWidth="thin"
          borderColor="gray-300"
          overflow="auto"
        >
          <Heading level={4} marginTop={0}>
            Local Demo Sandbox
          </Heading>
          <Text UNSAFE_style={{ fontSize: 12, opacity: 0.8 }}>
            Toggle assets below to see how common metadata fields dynamically intersect across
            folder-assigned &amp; MIME-type schemas.
          </Text>

          <Divider size="S" marginY="size-150" />

          <Flex direction="column" gap="size-100">
            {MOCK_ASSETS.map((asset) => (
              <View
                key={asset.id}
                padding="size-100"
                backgroundColor="gray-50"
                borderWidth="thin"
                borderColor={selectedIds.includes(asset.id) ? 'blue-500' : 'gray-300'}
                borderRadius="small"
              >
                <Checkbox
                  isSelected={selectedIds.includes(asset.id)}
                  onChange={() => toggleAsset(asset.id)}
                >
                  <Flex direction="column">
                    <Text UNSAFE_style={{ fontWeight: 600, fontSize: 13 }}>{asset.name}</Text>
                    <Text UNSAFE_style={{ fontSize: 11, opacity: 0.7 }}>{asset.mimeType}</Text>
                  </Flex>
                </Checkbox>
              </View>
            ))}
          </Flex>

          <Flex direction="column" gap="size-100" marginTop="size-200">
            <Button
              variant="secondary"
              onPress={() => {
                setSelectedIds([MOCK_ASSETS[0].id, MOCK_ASSETS[1].id]);
                setEditorOpen(true);
                setLastPatches(null);
              }}
            >
              Preset: 2 Campaign Images
            </Button>
            <Button
              variant="secondary"
              onPress={() => {
                setSelectedIds(MOCK_ASSETS.map((a) => a.id));
                setEditorOpen(true);
                setLastPatches(null);
              }}
            >
              Preset: Mixed (Img + Vid + PDF)
            </Button>
          </Flex>
        </View>

        {/* Right workspace */}
        <View flex height="100%" overflow="auto">
          {selectedAssets.length === 0 ? (
            <View padding="size-400">
              <InlineAlert variant="info">
                <Heading>Select at least 1 asset</Heading>
                <Content>Choose assets from the left sidebar to launch the bulk editor.</Content>
              </InlineAlert>
            </View>
          ) : editorOpen ? (
            <BulkMetadataEditor
              key={selectedIds.join(',')}
              assets={selectedAssets}
              schemaRegistry={MOCK_SCHEMA_REGISTRY}
              onSave={handleSave}
              onCancel={() => setEditorOpen(false)}
            />
          ) : (
            <View padding="size-300" maxWidth="size-6000" marginX="auto">
              <Flex justifyContent="space-between" alignItems="center" marginBottom="size-200">
                <Heading level={3} margin={0}>
                  Generated RFC 6902 JSON Patch Payloads
                </Heading>
                <Button variant="accent" onPress={() => setEditorOpen(true)}>
                  Re-open Bulk Editor
                </Button>
              </Flex>

              {!lastPatches ? (
                <Text>Editor closed without saving.</Text>
              ) : (
                <Flex direction="column" gap="size-150">
                  {lastPatches.map((item) => (
                    <View
                      key={item.id}
                      padding="size-150"
                      borderWidth="thin"
                      borderColor="gray-300"
                      borderRadius="medium"
                    >
                      <Flex alignItems="center" gap="size-100" marginBottom="size-100">
                        <Text UNSAFE_style={{ fontWeight: 600 }}>{item.name}</Text>
                        <Badge variant="neutral">If-Match: {item.etag}</Badge>
                        <Badge variant={item.patch.length > 0 ? 'positive' : 'neutral'}>
                          {item.patch.length} op(s)
                        </Badge>
                      </Flex>
                      <pre
                        style={{
                          margin: 0,
                          padding: 12,
                          background: '#f5f5f5',
                          borderRadius: 4,
                          fontSize: 12,
                          overflowX: 'auto'
                        }}
                      >
                        {JSON.stringify(item.patch, null, 2)}
                      </pre>
                    </View>
                  ))}
                </Flex>
              )}
            </View>
          )}
        </View>
      </Flex>
    </Provider>
  );
}
