import React, { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  ButtonGroup,
  Content,
  Divider,
  Flex,
  Heading,
  InlineAlert,
  Item,
  ProgressBar,
  TabList,
  TabPanels,
  Tabs,
  Text,
  View
} from '@adobe/react-spectrum';
import {
  intersectCommonFields,
  resolveEffectiveFormForAsset
} from '../services/schemaResolver';
import { computeCommonFieldStates } from '../services/metadataDiff';
import MetadataFieldRenderer from './MetadataFieldRenderer';

export default function BulkMetadataEditor({
  assets,
  schemaRegistry,
  onSave,
  onCancel,
  saving = false,
  saveProgress = null,
  saveResult = null
}) {
  const [dirtyEdits, setDirtyEdits] = useState({});
  const [showAssetsList, setShowAssetsList] = useState(false);

  const { tabs, fields, omittedFields, distinctForms, resolvedByAssetId } = useMemo(() => {
    const map = {};
    const resolvedForms = assets.map((asset) => {
      const form = resolveEffectiveFormForAsset(asset, schemaRegistry);
      map[asset.id] = form;
      return form;
    });
    const intersection = intersectCommonFields(resolvedForms);
    return { ...intersection, resolvedByAssetId: map };
  }, [assets, schemaRegistry]);

  const initialStates = useMemo(
    () => computeCommonFieldStates(fields, assets),
    [fields, assets]
  );

  const fieldsByProperty = useMemo(() => {
    const map = {};
    for (const f of fields) {
      map[f.property] = f;
    }
    return map;
  }, [fields]);

  const dirtyCount = Object.keys(dirtyEdits).length;

  const handleFieldChange = (property, nextEdit) => {
    setDirtyEdits((prev) => ({ ...prev, [property]: nextEdit }));
  };

  const handleFieldReset = (property) => {
    setDirtyEdits((prev) => {
      const copy = { ...prev };
      delete copy[property];
      return copy;
    });
  };

  const handleResetAll = () => {
    setDirtyEdits({});
  };

  const handleSubmit = () => {
    if (dirtyCount === 0 || saving) return;
    onSave(dirtyEdits, fieldsByProperty);
  };

  return (
    <Flex direction="column" height="100%">
      {/* Top Toolbar */}
      <View
        paddingX="size-300"
        paddingY="size-150"
        backgroundColor="gray-75"
        borderBottomWidth="thin"
        borderColor="gray-300"
      >
        <Flex alignItems="center" justifyContent="space-between" wrap gap="size-150">
          <Flex direction="column" gap="size-50">
            <Flex alignItems="center" gap="size-150">
              <Heading level={3} margin={0}>
                Bulk Edit Metadata
              </Heading>
              <Badge variant="neutral">{assets.length} assets selected</Badge>
              <Badge variant="info">
                {fields.length} common {fields.length === 1 ? 'field' : 'fields'}
              </Badge>
              {dirtyCount > 0 && (
                <Badge variant="positive">{dirtyCount} modified</Badge>
              )}
            </Flex>
            <Text UNSAFE_style={{ fontSize: 12, opacity: 0.75 }}>
              Matched forms:{' '}
              {distinctForms.map((f) => f.name).join(' ∩ ') || 'Default'}
              {' · '}
              <button
                type="button"
                onClick={() => setShowAssetsList((v) => !v)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--spectrum-global-color-blue-600)',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                  fontSize: 12
                }}
              >
                {showAssetsList ? 'Hide selected assets' : 'Show selected assets'}
              </button>
            </Text>
          </Flex>

          <ButtonGroup>
            {dirtyCount > 0 && (
              <Button variant="secondary" onPress={handleResetAll} isDisabled={saving}>
                Reset All
              </Button>
            )}
            <Button variant="secondary" onPress={onCancel} isDisabled={saving}>
              Cancel
            </Button>
            <Button
              variant="accent"
              onPress={handleSubmit}
              isDisabled={dirtyCount === 0 || saving}
            >
              {saving ? 'Saving…' : `Save to ${assets.length} Assets`}
            </Button>
          </ButtonGroup>
        </Flex>
      </View>

      {/* Scrollable Body */}
      <View flex overflow="auto" padding="size-300">
        <Flex direction="column" gap="size-200" maxWidth="size-6000" marginX="auto">
          {saving && saveProgress && (
            <ProgressBar
              label={`Updating metadata (${saveProgress.completed} of ${saveProgress.total})…`}
              value={saveProgress.completed}
              maxValue={saveProgress.total}
              width="100%"
            />
          )}

          {saveResult && saveResult.failed?.length > 0 && (
            <InlineAlert variant="negative" width="100%">
              <Heading>
                Updated {saveResult.succeeded.length} of {assets.length} assets (
                {saveResult.failed.length} failed)
              </Heading>
              <Content>
                {saveResult.failed.map((f) => (
                  <div key={f.id}>
                    <strong>{f.name}</strong>: {f.message}
                  </div>
                ))}
              </Content>
            </InlineAlert>
          )}

          {omittedFields.length > 0 && (
            <InlineAlert variant="info" width="100%">
              <Heading>
                Showing only metadata fields common to all {assets.length} selected assets
              </Heading>
              <Content>
                {omittedFields.length} type- or folder-specific{' '}
                {omittedFields.length === 1 ? 'field is' : 'fields are'} hidden because the
                selection spans {distinctForms.length} different metadata forms (
                {omittedFields
                  .slice(0, 6)
                  .map((f) => f.label)
                  .join(', ')}
                {omittedFields.length > 6 ? `, +${omittedFields.length - 6} more` : ''}).
              </Content>
            </InlineAlert>
          )}

          {showAssetsList && (
            <View
              padding="size-150"
              backgroundColor="gray-75"
              borderWidth="thin"
              borderColor="gray-300"
              borderRadius="medium"
            >
              <Heading level={5} marginTop={0} marginBottom="size-100">
                Selected Assets ({assets.length})
              </Heading>
              <Flex direction="column" gap="size-50">
                {assets.map((asset) => (
                  <Flex
                    key={asset.id}
                    justifyContent="space-between"
                    alignItems="center"
                    gap="size-150"
                  >
                    <Text UNSAFE_style={{ fontSize: 13 }}>
                      <strong>{asset.name}</strong>{' '}
                      <span style={{ opacity: 0.65 }}>{asset.path}</span>
                    </Text>
                    <Flex gap="size-100" alignItems="center">
                      <Badge variant="neutral">{asset.mimeType || 'unknown'}</Badge>
                      <Badge variant="info">
                        {resolvedByAssetId[asset.id]?.name || 'Default'}
                      </Badge>
                    </Flex>
                  </Flex>
                ))}
              </Flex>
            </View>
          )}

          {tabs.length === 0 ? (
            <InlineAlert variant="notice" width="100%">
              <Heading>No common editable metadata fields</Heading>
              <Content>
                The selected assets do not share any editable metadata fields across their
                assigned forms.
              </Content>
            </InlineAlert>
          ) : (
            <Tabs aria-label="Common metadata tabs" defaultSelectedKey={tabs[0].id}>
              <TabList>
                {tabs.map((tab) => {
                  const tabDirtyCount = tab.fields.filter((f) => dirtyEdits[f.property]).length;
                  return (
                    <Item key={tab.id}>
                      {tab.label}
                      {tabDirtyCount > 0 ? ` (${tabDirtyCount})` : ''}
                    </Item>
                  );
                })}
              </TabList>
              <Divider size="S" />
              <TabPanels>
                {tabs.map((tab) => (
                  <Item key={tab.id}>
                    <Flex direction="column" gap="size-150" marginTop="size-200">
                      {tab.fields.map((field) => (
                        <MetadataFieldRenderer
                          key={field.property}
                          field={field}
                          initialState={initialStates[field.property]}
                          edit={dirtyEdits[field.property]}
                          onChange={(nextEdit) => handleFieldChange(field.property, nextEdit)}
                          onReset={() => handleFieldReset(field.property)}
                        />
                      ))}
                    </Flex>
                  </Item>
                ))}
              </TabPanels>
            </Tabs>
          )}
        </Flex>
      </View>
    </Flex>
  );
}
