export const extensionId = 'aem-assets-bulk-metadata';

/**
 * Browsing contexts where Bulk Edit Metadata is offered in the ActionBar.
 */
export const SUPPORTED_CONTEXTS = new Set(['assets', 'search', 'collections']);

/**
 * Built-in action IDs to hide / intercept when 2 or more assets are selected.
 * Assets View documents "edit" in its built-in action list; we also include
 * "bulkMetadataEdit" / "bulkEdit" in case the host maps the Bulk Metadata Edit
 * button to one of those IDs.
 */
export const OVERRIDE_BUILTIN_EDIT_ON_MULTISELECT = true;
export const HIDE_BUILTIN_BULK_EDIT_IDS = ['edit', 'bulkMetadataEdit', 'bulkEdit'];

/**
 * Maximum number of assets recommended in a single client-side bulk edit session.
 */
export const MAX_RECOMMENDED_SELECTION = 100;
