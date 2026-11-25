import React, { useEffect } from 'react';
import { Text } from '@adobe/react-spectrum';
import { register } from '@adobe/uix-guest';
import {
  extensionId,
  SUPPORTED_CONTEXTS,
  OVERRIDE_BUILTIN_EDIT_ON_MULTISELECT,
  HIDE_BUILTIN_BULK_EDIT_IDS
} from './Constants';

/**
 * Filters a resourceSelection to asset items (excluding folders when detectable).
 */
function filterAssetResources(resourceSelection) {
  const resources = resourceSelection?.resources || [];
  return resources.filter((r) => {
    if (!r || !r.id) return false;
    // Folders typically lack a file extension or carry a folder type/URN
    if (r.type === 'folder' || r.mimeType === 'folder') return false;
    return true;
  });
}

export default function ExtensionRegistration() {
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const guestConnection = await register({
        id: extensionId,
        methods: {
          actionBar: {
            async getActions({ context, resourceSelection }) {
              if (!SUPPORTED_CONTEXTS.has(context)) {
                return [];
              }

              const assets = filterAssetResources(resourceSelection);
              if (assets.length < 2) {
                return [];
              }

              return [
                {
                  id: 'bulk-edit-metadata',
                  icon: 'Edit',
                  label: 'Bulk Edit All Metadata',
                  onClick: async () => {
                    guestConnection.host.modal.openDialog({
                      title: `Bulk Edit Metadata (${assets.length} assets)`,
                      contentUrl: '/#modal-bulk-metadata',
                      type: 'fullscreen',
                      payload: {
                        context,
                        resources: assets
                      }
                    });
                  }
                }
              ];
            },

            async getHiddenBuiltInActions({ context, resourceSelection }) {
              if (!SUPPORTED_CONTEXTS.has(context)) {
                return [];
              }
              const assets = filterAssetResources(resourceSelection);
              if (assets.length >= 2) {
                return HIDE_BUILTIN_BULK_EDIT_IDS;
              }
              return [];
            },

            async overrideBuiltInAction({ actionId, context, resourceSelection }) {
              console.debug('[aem-assets-bulk-metadata] built-in action triggered:', actionId);
              if (
                OVERRIDE_BUILTIN_EDIT_ON_MULTISELECT &&
                HIDE_BUILTIN_BULK_EDIT_IDS.includes(actionId) &&
                SUPPORTED_CONTEXTS.has(context)
              ) {
                const assets = filterAssetResources(resourceSelection);
                if (assets.length >= 2) {
                  guestConnection.host.modal.openDialog({
                    title: `Bulk Edit Metadata (${assets.length} assets)`,
                    contentUrl: '/#modal-bulk-metadata',
                    type: 'fullscreen',
                    payload: {
                      context,
                      resources: assets
                    }
                  });
                  return true;
                }
              }
              return false;
            }
          },

          // Both actionBar and quickActions namespaces are required for Browse View registration
          quickActions: {
            async getHiddenBuiltInActions() {
              return [];
            },
            async overrideBuiltInAction() {
              return false;
            }
          }
        }
      });

      if (cancelled) {
        guestConnection?.close?.();
      }
    };

    init().catch((err) => {
      console.error('[aem-assets-bulk-metadata] Extension registration failed:', err);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return <Text>AEM Assets View Bulk Metadata Extension host bridge active.</Text>;
}
