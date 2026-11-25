export const extensionId = 'aem-assets-bulk-metadata';

/**
 * Browsing contexts where Bulk Edit Metadata is offered in the ActionBar.
 */
export const SUPPORTED_CONTEXTS = new Set(['assets', 'search', 'collections']);

/**
 * Built-in action interception toggle.
 * Note: AEM Assets View does not currently expose a hideable built-in action ID
 * for "Bulk Metadata Edit" (returning undocumented IDs in getHiddenBuiltInActions
 * can cause Assets View to drop the extension's actionBar actions).
 */
export const OVERRIDE_BUILTIN_EDIT_ON_MULTISELECT = false;

/**
 * Maximum number of assets recommended in a single client-side bulk edit session.
 */
export const MAX_RECOMMENDED_SELECTION = 100;
