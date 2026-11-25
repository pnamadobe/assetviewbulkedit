import React, { useEffect, useMemo, useState } from 'react';
import {
  ActionButton,
  Button,
  ButtonGroup,
  Checkbox,
  Content,
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
    <div className="aem-asset-thumb">
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt={asset.name} />
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
  loadErrors = [],
  retryingLoad = false,
  onRetryLoad = null,
  thumbnailsById = {},
  availableTags = [],
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

  // Automatically check newly loaded assets (e.g. after retrying failed assets)
  useEffect(() => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      for (const a of assets) {
        if (!prev.has(a.id)) next.add(a.id);
      }
      return next;
    });
  }, [assets.length]);

  const activeAssets = useMemo(
    () => assets.filter((a) => checkedIds.has(a.id)),
    [assets, checkedIds]
  );

  const allChecked = assets.length > 0 && activeAssets.length === assets.length;
  const someChecked = activeAssets.length > 0 && activeAssets.length < assets.length;

  const commonFolder = useMemo(() => getCommonFolder(activeAssets), [activeAssets]);

  const { tabs, fields, omittedFields, distinctForms } = useMemo(() => {
    const activeForms = activeAssets.map((a) =>
      resolveEffectiveFormForAsset(a, schemaRegistry)
    );
    return intersectCommonFields(activeForms);
  }, [activeAssets, schemaRegistry]);

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
    setCheckedIds(checked ? new Set(assets.map((a) => a.id)) : new Set());
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

  const subtitleParts = [
    `${activeAssets.length} of ${assets.length} selected`,
    distinctForms.length === 1
      ? distinctForms[0].name
      : distinctForms.length > 1
      ? `${distinctForms.length} forms · ${fields.length} common fields`
      : null,
    dirtyCount > 0 ? `${dirtyCount} ${dirtyCount === 1 ? 'change' : 'changes'}` : null
  ].filter(Boolean);

  return (
    <Flex
      direction="column"
      height="100%"
      UNSAFE_style={{ backgroundColor: 'var(--spectrum-global-color-gray-50)' }}
    >
      {/* Slim Utility Action Bar (modal host chrome already displays the main title) */}
      <View
        paddingX="size-250"
        paddingY="size-100"
        backgroundColor="gray-50"
        borderBottomWidth="thin"
        borderColor="gray-200"
      >
        <Flex alignItems="center" justifyContent="space-between" gap="size-200">
          <Flex alignItems="center" gap="size-125" minWidth={0}>
            <TooltipTrigger delay={300}>
              <ActionButton
                isQuiet
                aria-label={railOpen ? 'Hide selected assets' : 'Show selected assets'}
                onPress={() => setRailOpen((v) => !v)}
              >
                <RailLeftIcon size="S" />
              </ActionButton>
              <Tooltip>{railOpen ? 'Hide selected assets' : 'Show selected assets'}</Tooltip>
            </TooltipTrigger>

            <Text
              UNSAFE_style={{
                fontSize: 13,
                color: 'var(--spectrum-global-color-gray-700)'
              }}
            >
              {subtitleParts.join(' · ')}
            </Text>
          </Flex>

          <div className="aem-s2-pill-buttons">
            <ButtonGroup>
              {dirtyCount > 0 && (
                <Button variant="secondary" isQuiet onPress={handleResetAll} isDisabled={saving}>
                  Reset
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
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </ButtonGroup>
          </div>
        </Flex>
      </View>

      {/* Main Two-Pane AEM Layout */}
      <Flex flex minHeight={0}>
        {/* Left Asset List Rail — borderless rows, checkboxes, small thumbnails, filenames */}
        {railOpen && (
          <View
            width="size-3600"
            backgroundColor="gray-75"
            borderEndWidth="thin"
            borderColor="gray-200"
            overflow="auto"
            paddingX="size-150"
            paddingY="size-200"
          >
            <Flex direction="column" gap="size-100">
              <View paddingX="size-125" paddingBottom="size-50">
                <Checkbox
                  isSelected={allChecked}
                  isIndeterminate={someChecked}
                  onChange={toggleAll}
                  isDisabled={saving}
                >
                  <Text UNSAFE_style={{ fontSize: 12, fontWeight: 600 }}>
                    Select all ({activeAssets.length}/{assets.length})
                  </Text>
                </Checkbox>

                {commonFolder && (
                  <Flex
                    alignItems="center"
                    gap="size-75"
                    marginTop="size-50"
                    UNSAFE_style={{
                      fontSize: 11,
                      color: 'var(--spectrum-global-color-gray-600)',
                      wordBreak: 'break-all'
                    }}
                  >
                    <FolderIcon size="XS" />
                    <Text>{commonFolder.replace(/^\/content\/dam\/?/, '/')}</Text>
                  </Flex>
                )}
              </View>

              <Flex direction="column" gap="size-25">
                {assets.map((asset) => {
                  const isChecked = checkedIds.has(asset.id);
                  return (
                    <div
                      key={asset.id}
                      className={`aem-asset-row ${isChecked ? '' : 'aem-asset-row--unchecked'}`}
                    >
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
                        {asset.mimeType && (
                          <Text
                            UNSAFE_style={{
                              fontSize: 11,
                              color: 'var(--spectrum-global-color-gray-600)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {asset.mimeType}
                          </Text>
                        )}
                      </Flex>
                    </div>
                  );
                })}
              </Flex>
            </Flex>
          </View>
        )}

        {/* Right Tabbed Metadata Form Canvas */}
        <View flex overflow="auto" paddingX="size-400" paddingY="size-300" backgroundColor="gray-50">
          <Flex direction="column" gap="size-250" maxWidth="920px">
            {loadErrors.length > 0 && (
              <InlineAlert variant="notice" width="100%">
                <Heading>
                  {loadErrors.length} {loadErrors.length === 1 ? 'asset' : 'assets'} could not be
                  loaded
                </Heading>
                <Content>
                  <Flex direction="column" gap="size-100">
                    <Flex alignItems="center" justifyContent="space-between" gap="size-150" wrap>
                      <Text>
                        The following selected items could not be loaded (you can retry or continue
                        editing the {assets.length} loaded assets):
                      </Text>
                      {onRetryLoad && (
                        <Button
                          variant="secondary"
                          onPress={onRetryLoad}
                          isDisabled={retryingLoad}
                        >
                          {retryingLoad ? 'Retrying…' : `Retry (${loadErrors.length})`}
                        </Button>
                      )}
                    </Flex>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                      {loadErrors.map((err) => {
                        const label = err.path ? err.path.split('/').pop() : err.id;
                        return (
                          <div key={err.id}>
                            <strong>{label}</strong>
                            {err.status ? ` (HTTP ${err.status})` : ''}: {err.message}
                          </div>
                        );
                      })}
                    </div>
                  </Flex>
                </Content>
              </InlineAlert>
            )}

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
              <Text
                UNSAFE_style={{
                  fontSize: 14,
                  color: 'var(--spectrum-global-color-gray-600)',
                  paddingTop: 16
                }}
              >
                Select one or more assets on the left to edit their common metadata fields.
              </Text>
            ) : (
              <>
                {omittedFields.length > 0 && (
                  <Text
                    UNSAFE_style={{
                      fontSize: 12,
                      color: 'var(--spectrum-global-color-gray-600)'
                    }}
                  >
                    Showing {fields.length} common fields across {distinctForms.length} metadata
                    forms ({omittedFields.length} type-specific{' '}
                    {omittedFields.length === 1 ? 'field' : 'fields'} hidden).
                  </Text>
                )}

                {tabs.length === 0 ? (
                  <Text
                    UNSAFE_style={{
                      fontSize: 14,
                      color: 'var(--spectrum-global-color-gray-600)'
                    }}
                  >
                    The selected assets do not share any editable metadata fields.
                  </Text>
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
                          <View paddingTop="size-300">
                            <div className="aem-bulk-field-grid">
                              {tab.fields.map((field) => (
                                <MetadataFieldRenderer
                                  key={field.property}
                                  field={field}
                                  initialState={initialStates[field.property]}
                                  edit={dirtyEdits[field.property]}
                                  availableTags={availableTags}
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
