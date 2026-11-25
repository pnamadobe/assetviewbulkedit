import React, { useMemo, useState } from 'react';
import {
  ActionButton,
  Badge,
  Button,
  ButtonGroup,
  Checkbox,
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
  Tooltip,
  TooltipTrigger,
  View
} from '@adobe/react-spectrum';
import AssetIcon from '@spectrum-icons/workflow/Asset';
import DocumentIcon from '@spectrum-icons/workflow/Document';
import FilmIcon from '@spectrum-icons/workflow/Filmroll';
import FolderIcon from '@spectrum-icons/workflow/Folder';
import ImageIcon from '@spectrum-icons/workflow/Image';
import PropertiesIcon from '@spectrum-icons/workflow/Properties';
import RailLeftIcon from '@spectrum-icons/workflow/RailLeft';
import {
  intersectCommonFields,
  resolveEffectiveFormForAsset
} from '../services/schemaResolver';
import { computeCommonFieldStates } from '../services/metadataDiff';
import MetadataFieldRenderer from './MetadataFieldRenderer';

function AssetThumbnail({ asset, thumbnailUrl }) {
  const mime = (asset.mimeType || '').toLowerCase();
  const FallbackIcon = mime.startsWith('image/')
    ? ImageIcon
    : mime.startsWith('video/')
    ? FilmIcon
    : mime.includes('pdf') || mime.startsWith('text/')
    ? DocumentIcon
    : AssetIcon;

  return (
    <div
      style={{
        width: 40,
        height: 40,
        minWidth: 40,
        borderRadius: 4,
        overflow: 'hidden',
        border: '1px solid var(--spectrum-global-color-gray-300)',
        backgroundColor: 'var(--spectrum-global-color-gray-100)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={asset.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <FallbackIcon size="S" />
      )}
    </div>
  );
}

function getCommonFolder(assets) {
  if (!assets || assets.length === 0) return null;
  const folders = assets.map((a) => {
    if (!a.path) return '';
    const parts = a.path.split('/').filter(Boolean);
    parts.pop();
    return '/' + parts.join('/');
  });
  const first = folders[0];
  return first && folders.every((f) => f === first) ? first : null;
}

export default function BulkMetadataEditor({
  assets,
  thumbnailsById = {},
  schemaRegistry,
  onSave,
  onCancel,
  saving = false,
  saveProgress = null,
  saveResult = null
}) {
  const [checkedIds, setCheckedIds] = useState(() => new Set(assets.map((a) => a.id)));
  const [dirtyEdits, setDirtyEdits] = useState({});
  const [railOpen, setRailOpen] = useState(true);

  const activeAssets = useMemo(
    () => assets.filter((a) => checkedIds.has(a.id)),
    [assets, checkedIds]
  );

  const allChecked = assets.length > 0 && activeAssets.length === assets.length;
  const someChecked = activeAssets.length > 0 && activeAssets.length < assets.length;

  const commonFolder = useMemo(() => getCommonFolder(activeAssets), [activeAssets]);

  const { tabs, fields, omittedFields, distinctForms, resolvedByAssetId } = useMemo(() => {
    const map = {};
    for (const asset of assets) {
      map[asset.id] = resolveEffectiveFormForAsset(asset, schemaRegistry);
    }
    const activeForms = activeAssets.map((a) => map[a.id]);
    const intersection = intersectCommonFields(activeForms);
    return { ...intersection, resolvedByAssetId: map };
  }, [assets, activeAssets, schemaRegistry]);

  const initialStates = useMemo(
    () => computeCommonFieldStates(fields, activeAssets),
    [fields, activeAssets]
  );

  const fieldsByProperty = useMemo(() => {
    const map = {};
    for (const f of fields) {
      map[f.property] = f;
    }
    return map;
  }, [fields]);

  const dirtyCount = Object.keys(dirtyEdits).length;

  const toggleAsset = (id) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = (checked) => {
    if (checked) {
      setCheckedIds(new Set(assets.map((a) => a.id)));
    } else {
      setCheckedIds(new Set());
    }
  };

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
    if (dirtyCount === 0 || activeAssets.length === 0 || saving) return;
    onSave(activeAssets, dirtyEdits, fieldsByProperty);
  };

  return (
    <Flex
      direction="column"
      height="100%"
      UNSAFE_style={{ backgroundColor: 'var(--spectrum-global-color-gray-50)' }}
    >
      {/* AEM Assets View Top Action Bar */}
      <View
        paddingX="size-300"
        paddingY="size-150"
        backgroundColor="gray-50"
        borderBottomWidth="thin"
        borderColor="gray-300"
      >
        <Flex alignItems="center" justifyContent="space-between" gap="size-150" wrap>
          <Flex alignItems="center" gap="size-150">
            <TooltipTrigger delay={300}>
              <ActionButton
                isQuiet
                aria-label={railOpen ? 'Hide selected assets rail' : 'Show selected assets rail'}
                onPress={() => setRailOpen((v) => !v)}
              >
                <RailLeftIcon size="S" />
              </ActionButton>
              <Tooltip>{railOpen ? 'Hide selected assets' : 'Show selected assets'}</Tooltip>
            </TooltipTrigger>

            <Divider orientation="vertical" size="S" />

            <PropertiesIcon size="S" />
            <Heading level={4} margin={0}>
              Edit Metadata
            </Heading>

            <Badge variant="neutral">
              {activeAssets.length} of {assets.length} selected
            </Badge>
            {distinctForms.length > 0 && (
              <Badge variant="info">
                {distinctForms.length === 1
                  ? distinctForms[0].name
                  : `${distinctForms.length} forms · ${fields.length} common fields`}
              </Badge>
            )}
            {dirtyCount > 0 && (
              <Badge variant="positive">
                {dirtyCount} {dirtyCount === 1 ? 'change' : 'changes'}
              </Badge>
            )}
          </Flex>

          <ButtonGroup>
            {dirtyCount > 0 && (
              <Button variant="secondary" style="outline" onPress={handleResetAll} isDisabled={saving}>
                Reset All
              </Button>
            )}
            <Button variant="secondary" onPress={onCancel} isDisabled={saving}>
              Cancel
            </Button>
            <Button
              variant="accent"
              onPress={handleSubmit}
              isDisabled={dirtyCount === 0 || activeAssets.length === 0 || saving}
            >
              {saving ? 'Saving…' : `Save (${activeAssets.length})`}
            </Button>
          </ButtonGroup>
        </Flex>
      </View>

      {/* Main Two-Pane AEM Assets View Body */}
      <Flex flex minHeight={0}>
        {/* Left Selected Assets Rail: Checkboxes + Thumbnails + Filenames */}
        {railOpen && (
          <View
            width="size-3600"
            backgroundColor="gray-75"
            borderEndWidth="thin"
            borderColor="gray-300"
            overflow="auto"
            padding="size-200"
          >
            <Flex direction="column" gap="size-125">
              <Flex alignItems="center" justifyContent="space-between">
                <Checkbox
                  isSelected={allChecked}
                  isIndeterminate={someChecked}
                  onChange={toggleAll}
                  isDisabled={saving}
                >
                  <Text UNSAFE_style={{ fontSize: 13, fontWeight: 600 }}>
                    Assets ({activeAssets.length}/{assets.length})
                  </Text>
                </Checkbox>
              </Flex>

              {commonFolder && (
                <Flex
                  alignItems="center"
                  gap="size-75"
                  UNSAFE_style={{
                    fontSize: 11,
                    color: 'var(--spectrum-global-color-gray-700)',
                    wordBreak: 'break-all'
                  }}
                >
                  <FolderIcon size="XS" />
                  <Text>{commonFolder.replace(/^\/content\/dam\/?/, '/')}</Text>
                </Flex>
              )}

              <Divider size="S" />

              <Flex direction="column" gap="size-75">
                {assets.map((asset) => {
                  const isChecked = checkedIds.has(asset.id);
                  return (
                    <View
                      key={asset.id}
                      paddingX="size-100"
                      paddingY="size-75"
                      backgroundColor={isChecked ? 'gray-50' : 'gray-100'}
                      borderWidth="thin"
                      borderColor={isChecked ? 'blue-400' : 'gray-200'}
                      borderRadius="regular"
                      UNSAFE_style={{ opacity: isChecked ? 1 : 0.6 }}
                    >
                      <Flex alignItems="center" gap="size-100">
                        <Checkbox
                          aria-label={`Select ${asset.name}`}
                          isSelected={isChecked}
                          onChange={() => toggleAsset(asset.id)}
                          isDisabled={saving}
                          UNSAFE_style={{ marginRight: 0 }}
                        />
                        <AssetThumbnail
                          asset={asset}
                          thumbnailUrl={thumbnailsById[asset.id] || asset.thumbnailUrl}
                        />
                        <Flex direction="column" minWidth={0} flex>
                          <Text
                            UNSAFE_style={{
                              fontSize: 13,
                              fontWeight: 500,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {asset.name}
                          </Text>
                          <Text
                            UNSAFE_style={{
                              fontSize: 11,
                              color: 'var(--spectrum-global-color-gray-600)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {asset.mimeType || 'Asset'} ·{' '}
                            {resolvedByAssetId[asset.id]?.name || 'Default'}
                          </Text>
                        </Flex>
                      </Flex>
                    </View>
                  );
                })}
              </Flex>
            </Flex>
          </View>
        )}

        {/* Right Tabbed Metadata Form / Schema Panel */}
        <View flex overflow="auto" padding="size-300" backgroundColor="gray-50">
          <Flex direction="column" gap="size-250" maxWidth="960px" marginX="auto">
            {saving && saveProgress && (
              <ProgressBar
                label={`Saving metadata (${saveProgress.completed} of ${saveProgress.total})…`}
                value={saveProgress.completed}
                maxValue={saveProgress.total}
                width="100%"
              />
            )}

            {saveResult && saveResult.failed?.length > 0 && (
              <InlineAlert variant="negative" width="100%">
                <Heading>
                  Updated {saveResult.succeeded.length} of {activeAssets.length} assets (
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

            {activeAssets.length === 0 ? (
              <InlineAlert variant="notice" width="100%">
                <Heading>No assets selected</Heading>
                <Content>
                  Check one or more assets in the left panel to edit their common metadata fields.
                </Content>
              </InlineAlert>
            ) : (
              <>
                {omittedFields.length > 0 && (
                  <InlineAlert variant="info" width="100%">
                    <Heading>
                      Showing {fields.length} metadata fields common to all {activeAssets.length}{' '}
                      checked assets
                    </Heading>
                    <Content>
                      {omittedFields.length} type- or folder-specific{' '}
                      {omittedFields.length === 1 ? 'field is' : 'fields are'} hidden because the
                      selection spans {distinctForms.length} metadata forms (
                      {omittedFields
                        .slice(0, 6)
                        .map((f) => f.label)
                        .join(', ')}
                      {omittedFields.length > 6 ? `, +${omittedFields.length - 6} more` : ''}).
                    </Content>
                  </InlineAlert>
                )}

                {tabs.length === 0 ? (
                  <InlineAlert variant="notice" width="100%">
                    <Heading>No common editable metadata fields</Heading>
                    <Content>
                      The checked assets do not share any editable metadata fields across their
                      assigned metadata forms.
                    </Content>
                  </InlineAlert>
                ) : (
                  <Tabs
                    key={tabs.map((t) => t.id).join('|')}
                    aria-label="Metadata form tabs"
                    defaultSelectedKey={tabs[0].id}
                    isQuiet
                  >
                    <TabList>
                      {tabs.map((tab) => {
                        const tabDirtyCount = tab.fields.filter(
                          (f) => dirtyEdits[f.property]
                        ).length;
                        return (
                          <Item key={tab.id}>
                            {tab.label}
                            {tabDirtyCount > 0 ? ` (${tabDirtyCount})` : ''}
                          </Item>
                        );
                      })}
                    </TabList>
                    <TabPanels>
                      {tabs.map((tab) => (
                        <Item key={tab.id}>
                          <View paddingTop="size-250">
                            <div className="aem-bulk-field-grid">
                              {tab.fields.map((field) => (
                                <MetadataFieldRenderer
                                  key={field.property}
                                  field={field}
                                  initialState={initialStates[field.property]}
                                  edit={dirtyEdits[field.property]}
                                  onChange={(nextEdit) =>
                                    handleFieldChange(field.property, nextEdit)
                                  }
                                  onReset={() => handleFieldReset(field.property)}
                                />
                              ))}
                            </div>
                          </View>
                        </Item>
                      ))}
                    </TabPanels>
                  </Tabs>
                )}
              </>
            )}
          </Flex>
        </View>
      </Flex>
    </Flex>
  );
}
