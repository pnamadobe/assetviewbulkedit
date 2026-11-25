export const extensionId = 'aem-assets-bulk-metadata';

/**
 * Browsing contexts where Bulk Edit Metadata is offered in the ActionBar.
 */
export const SUPPORTED_CONTEXTS = new Set(['assets', 'search', 'collections']);

/**
 * Set to `true` if you also want to intercept Assets View's built-in "edit" action
 * when 2 or more assets are selected and route it to this schema-driven editor.
 */
export const OVERRIDE_BUILTIN_EDIT_ON_MULTISELECT = false;

/**
 * Maximum number of assets recommended in a single client-side bulk edit session.
 */
export const MAX_RECOMMENDED_SELECTION = 100;
