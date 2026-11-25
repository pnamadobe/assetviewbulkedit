/**
 * Schema resolution & common-field intersection engine for AEM Assets View.
 *
 * Replicates AEM Admin View's bulk metadata behavior:
 * 1. Resolves the effective metadata form for each selected asset
 *    (folder-assigned form walking up the DAM path -> exact MIME type -> MIME family -> default).
 * 2. Computes the intersection of editable fields across all selected assets' resolved forms.
 */

export const READ_ONLY_SYSTEM_PROPERTIES = new Set([
  'jcr:created',
  'jcr:createdBy',
  'jcr:lastModified',
  'jcr:lastModifiedBy',
  'jcr:uuid',
  'jcr:primaryType',
  'dc:format',
  'dam:size',
  'dam:sha1',
  'dam:MIMEtype',
  'tiff:ImageWidth',
  'tiff:ImageLength',
  'dam:Fileformat',
  'dam:Physicalwidthininches',
  'dam:Physicalheightininches'
]);

/**
 * Normalizes an AEM JCR property mapping path into an assetMetadata key.
 * Example: "./jcr:content/metadata/dc:title" -> "dc:title"
 */
export function normalizePropertyName(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') {
    return null;
  }
  let prop = rawPath.trim();
  prop = prop.replace(/^\.?\//, '');
  prop = prop.replace(/^jcr:content\/metadata\//, '');
  prop = prop.replace(/^metadata\//, '');
  if (!prop || prop.includes(' ') || prop.startsWith('jcr:content/')) {
    return null;
  }
  return prop;
}

/**
 * Built-in fallback schemas matching standard AEM Assets metadata properties.
 * Used when custom forms are not present or not readable by the current user.
 */
export const DEFAULT_SCHEMAS = {
  default: {
    id: 'default',
    name: 'Default Asset Form',
    tabs: [
      {
        id: 'basic',
        label: 'Basic',
        fields: [
          { property: 'dc:title', label: 'Title', type: 'text' },
          { property: 'dc:description', label: 'Description', type: 'textarea' },
          {
            property: 'dam:status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Draft', value: 'draft' },
              { label: 'In Review', value: 'inReview' },
              { label: 'Approved', value: 'approved' },
              { label: 'Rejected', value: 'rejected' }
            ]
          },
          { property: 'dc:creator', label: 'Author / Creator', type: 'text' },
          { property: 'dc:language', label: 'Language', type: 'text' },
          { property: 'cq:tags', label: 'Tags', type: 'tags', multiValue: true },
          { property: 'dc:subject', label: 'Keywords', type: 'keywords', multiValue: true }
        ]
      },
      {
        id: 'rights',
        label: 'Rights & Governance',
        fields: [
          { property: 'pur:expirationDate', label: 'Expiration Date', type: 'date' },
          { property: 'dc:rights', label: 'Copyright Notice', type: 'text' },
          { property: 'xmpRights:UsageTerms', label: 'Usage Terms', type: 'textarea' },
          { property: 'xmpRights:Owner', label: 'Copyright Owner', type: 'text' }
        ]
      }
    ]
  },
  image: {
    id: 'image',
    name: 'Image Metadata Form',
    extends: 'default',
    tabs: [
      {
        id: 'advanced',
        label: 'Image Details',
        fields: [
          { property: 'photoshop:Headline', label: 'Headline', type: 'text' },
          { property: 'photoshop:Credit', label: 'Credit Line', type: 'text' },
          { property: 'photoshop:Source', label: 'Source', type: 'text' },
          { property: 'Iptc4xmpCore:Location', label: 'Location', type: 'text' },
          { property: 'Iptc4xmpCore:AltTextAccessibility', label: 'Alt Text (Accessibility)', type: 'textarea' }
        ]
      }
    ]
  },
  video: {
    id: 'video',
    name: 'Video Metadata Form',
    extends: 'default',
    tabs: [
      {
        id: 'advanced',
        label: 'Video Details',
        fields: [
          { property: 'xmpDM:artist', label: 'Artist / Director', type: 'text' },
          { property: 'xmpDM:genre', label: 'Genre', type: 'text' },
          { property: 'xmpDM:scene', label: 'Scene / Campaign', type: 'text' },
          { property: 'xmpDM:logComment', label: 'Production Notes', type: 'textarea' }
        ]
      }
    ]
  },
  'application/pdf': {
    id: 'application/pdf',
    name: 'PDF Document Form',
    extends: 'default',
    tabs: [
      {
        id: 'advanced',
        label: 'Document Details',
        fields: [
          { property: 'pdf:Producer', label: 'Producer', type: 'text' },
          { property: 'pdf:Keywords', label: 'PDF Keywords', type: 'text' },
          { property: 'dc:publisher', label: 'Publisher', type: 'text' }
        ]
      }
    ]
  }
};

const DEFAULT_ASSET_STATUS_OPTIONS = [
  { label: 'Draft', value: 'draft' },
  { label: 'In Review', value: 'inReview' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' }
];

const DEFAULT_ACTIVATION_TARGET_OPTIONS = [
  { label: 'Delivery', value: 'delivery' },
  { label: 'Content Hub', value: 'contenthub' }
];

const STATUS_PROPERTIES = new Set(['dam:status', 'dam:assetStatus', 'assetStatus']);
const TARGET_PROPERTIES = new Set(['dam:activationTarget', 'activationTarget']);

/**
 * Maps an AEM Granite / Assets View component resourceType to our renderer type.
 */
function inferFieldType(node) {
  const rt = (node['sling:resourceType'] || node.type || '').toLowerCase();
  const prop = normalizePropertyName(node.name || node.mapToProperty || node.property || '');
  const label = String(node.fieldLabel || node.label || node['jcr:title'] || '').toLowerCase();

  if (prop === 'cq:tags' || rt.includes('tag')) return { type: 'tags', multiValue: true };
  if (
    STATUS_PROPERTIES.has(prop) ||
    TARGET_PROPERTIES.has(prop) ||
    rt.includes('assetstatus') ||
    rt.includes('activationtarget') ||
    label === 'asset status' ||
    label === 'approval target' ||
    label === 'approval for'
  ) {
    return { type: 'select', multiValue: false };
  }
  if (prop === 'dc:subject' || rt.includes('multifield') || node.multiple === true) {
    return { type: rt.includes('select') ? 'multiselect' : 'keywords', multiValue: true };
  }
  if (rt.includes('datepicker') || rt.includes('date')) return { type: 'date', multiValue: false };
  if (rt.includes('textarea')) return { type: 'textarea', multiValue: false };
  if (rt.includes('checkbox') || rt.includes('switch') || rt.includes('boolean')) {
    return { type: 'boolean', multiValue: false };
  }
  if (rt.includes('numberfield') || rt.includes('number')) return { type: 'number', multiValue: false };
  if (rt.includes('select') || rt.includes('dropdown') || rt.includes('choice')) {
    return { type: 'select', multiValue: Boolean(node.multiple) };
  }
  return { type: 'text', multiValue: false };
}

function extractOptions(node) {
  const options = [];
  const items = node.items || node.choices || node.options;
  if (!items || typeof items !== 'object') return options;

  const entries = Array.isArray(items) ? items : Object.values(items);
  for (const item of entries) {
    if (typeof item === 'string' && item.trim()) {
      options.push({ label: item.trim(), value: item.trim() });
    } else if (
      item &&
      typeof item === 'object' &&
      ('value' in item || 'text' in item || 'label' in item || 'jcr:title' in item)
    ) {
      const value = item.value ?? item.text ?? item.label ?? item['jcr:title'];
      const label = item.text ?? item.label ?? item['jcr:title'] ?? String(value);
      if (value !== undefined && value !== null) {
        options.push({ label: String(label), value: String(value) });
      }
    }
  }
  return options;
}

/**
 * Recursively collects field definitions from a Granite/JCR tab subtree.
 */
function collectFieldsFromNode(node, fields = []) {
  if (!node || typeof node !== 'object') return fields;

  const rawProp = node.name || node.mapToProperty || node.property;
  const property = normalizePropertyName(rawProp);
  const label = node.fieldLabel || node.label || node['jcr:title'];

  if (property && label && !node.readOnly && !node.disabled) {
    const { type, multiValue } = inferFieldType(node);
    const lowerLabel = String(label).toLowerCase();
    let options = extractOptions(node);
    if (options.length === 0 && (STATUS_PROPERTIES.has(property) || lowerLabel === 'asset status')) {
      options = DEFAULT_ASSET_STATUS_OPTIONS;
    } else if (
      options.length === 0 &&
      (TARGET_PROPERTIES.has(property) ||
        lowerLabel === 'approval target' ||
        lowerLabel === 'approval for')
    ) {
      options = DEFAULT_ACTIVATION_TARGET_OPTIONS;
    }
    fields.push({
      property,
      label: String(label),
      type,
      multiValue: Boolean(multiValue),
      required: Boolean(node.required),
      readOnly: Boolean(node.readOnly || node.disabled || READ_ONLY_SYSTEM_PROPERTIES.has(property)),
      ...(options.length > 0 ? { options } : {})
    });
  }

  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('jcr:') || key.startsWith('sling:') || key === 'items' && property) {
      continue;
    }
    if (child && typeof child === 'object') {
      collectFieldsFromNode(child, fields);
    }
  }

  return fields;
}

/**
 * Parses a JCR infinity.json tree from either Assets View metadataforms or Admin View metadataschema
 * into a schema registry: { formsById, folderAssignments }.
 */
export function parseAemSchemaTree(formsTree) {
  const formsById = {};
  const folderAssignments = {};

  if (!formsTree || typeof formsTree !== 'object') {
    return { formsById, folderAssignments };
  }

  for (const [formKey, formNode] of Object.entries(formsTree)) {
    if (formKey.startsWith('jcr:') || !formNode || typeof formNode !== 'object') {
      continue;
    }

    const tabs = [];
    const tabsRoot =
      formNode.items?.tabs?.items ||
      formNode.tabs?.items ||
      formNode.items ||
      formNode;

    if (tabsRoot && typeof tabsRoot === 'object') {
      for (const [tabKey, tabNode] of Object.entries(tabsRoot)) {
        if (tabKey.startsWith('jcr:') || tabKey.startsWith('sling:') || !tabNode || typeof tabNode !== 'object') {
          continue;
        }
        const tabFields = collectFieldsFromNode(tabNode, []);
        if (tabFields.length > 0) {
          tabs.push({
            id: tabKey,
            label: tabNode['jcr:title'] || tabNode.title || tabKey,
            fields: tabFields
          });
        }
      }
    }

    if (tabs.length > 0) {
      const formId = formKey.toLowerCase();
      formsById[formId] = {
        id: formId,
        name: formNode['jcr:title'] || formNode.title || formKey,
        tabs
      };

      // Folder assignments may be stored as an array of DAM paths on the form node
      const assignedFolders = formNode.folderPaths || formNode.assignedFolders || [];
      if (Array.isArray(assignedFolders)) {
        for (const folderPath of assignedFolders) {
          if (typeof folderPath === 'string' && folderPath.startsWith('/content/dam')) {
            folderAssignments[folderPath.replace(/\/+$/, '')] = formId;
          }
        }
      }
    }
  }

  return { formsById, folderAssignments };
}

/**
 * Expands a schema that uses `extends` (e.g. `image` extends `default`) into a single merged form.
 */
export function materializeForm(formId, formsById, visited = new Set()) {
  const form = formsById[formId];
  if (!form || visited.has(formId)) {
    return null;
  }
  visited.add(formId);

  if (!form.extends || !formsById[form.extends]) {
    return {
      ...form,
      tabs: form.tabs.map((t) => ({ ...t, fields: [...t.fields] }))
    };
  }

  const parent = materializeForm(form.extends, formsById, visited);
  if (!parent) {
    return form;
  }

  const mergedTabs = parent.tabs.map((t) => ({ ...t, fields: [...t.fields] }));
  const tabIndexById = new Map(mergedTabs.map((t, idx) => [t.id, idx]));

  for (const childTab of form.tabs) {
    if (tabIndexById.has(childTab.id)) {
      const target = mergedTabs[tabIndexById.get(childTab.id)];
      const existingProps = new Set(target.fields.map((f) => f.property));
      for (const field of childTab.fields) {
        if (!existingProps.has(field.property)) {
          target.fields.push(field);
        }
      }
    } else {
      tabIndexById.set(childTab.id, mergedTabs.length);
      mergedTabs.push({ ...childTab, fields: [...childTab.fields] });
    }
  }

  return {
    id: form.id,
    name: form.name,
    tabs: mergedTabs
  };
}

/**
 * Builds a complete schema registry by merging parsed AEM forms with built-in defaults.
 */
export function createSchemaRegistry(customRegistry = {}) {
  return {
    formsById: {
      ...DEFAULT_SCHEMAS,
      ...(customRegistry.formsById || {})
    },
    folderAssignments: {
      ...(customRegistry.folderAssignments || {})
    }
  };
}

/**
 * Walks up an asset's folder hierarchy to find the nearest folder-assigned metadata form.
 */
function findFolderAssignedFormId(assetPath, folderAssignments) {
  if (!assetPath || !folderAssignments) return null;
  const parts = assetPath.split('/').filter(Boolean);
  // Remove filename
  parts.pop();

  while (parts.length >= 2) {
    const candidatePath = '/' + parts.join('/');
    if (folderAssignments[candidatePath]) {
      return folderAssignments[candidatePath];
    }
    parts.pop();
  }
  return null;
}

/**
 * Resolves the effective metadata form for a single asset.
 * Precedence (matching AEM Assets View):
 * 1. Explicit folder-assigned form (closest ancestor folder)
 * 2. Exact MIME type form (e.g. "image/jpeg")
 * 3. MIME type family form (e.g. "image", "video")
 * 4. "default" form
 */
export function resolveEffectiveFormForAsset(asset, registry) {
  const { formsById, folderAssignments } = registry;

  const folderFormId = findFolderAssignedFormId(asset.path, folderAssignments);
  if (folderFormId && formsById[folderFormId]) {
    return materializeForm(folderFormId, formsById);
  }

  const mimeType = (
    asset.mimeType ||
    asset.repositoryMetadata?.['dc:format'] ||
    asset.assetMetadata?.['dc:format'] ||
    ''
  ).toLowerCase();

  if (mimeType && formsById[mimeType]) {
    return materializeForm(mimeType, formsById);
  }

  const mimeFamily = mimeType.split('/')[0];
  if (mimeFamily && formsById[mimeFamily]) {
    return materializeForm(mimeFamily, formsById);
  }

  return materializeForm('default', formsById);
}

/**
 * Computes the intersection of editable fields across all resolved forms.
 *
 * Returns:
 * - tabs: Array of { id, label, fields } containing only fields common to EVERY form
 * - fields: Flat array of common editable fields
 * - omittedFields: Array of fields excluded because they weren't present on all forms
 * - distinctForms: Array of unique form { id, name } matched across the selection
 */
export function intersectCommonFields(resolvedForms) {
  if (!Array.isArray(resolvedForms) || resolvedForms.length === 0) {
    return { tabs: [], fields: [], omittedFields: [], distinctForms: [] };
  }

  const distinctFormsMap = new Map();
  for (const form of resolvedForms) {
    if (form && !distinctFormsMap.has(form.id)) {
      distinctFormsMap.set(form.id, { id: form.id, name: form.name });
    }
  }
  const distinctForms = Array.from(distinctFormsMap.values());

  // Build property sets for each form (excluding read-only & system properties)
  const formPropertySets = resolvedForms.map((form) => {
    const propSet = new Set();
    for (const tab of form.tabs || []) {
      for (const field of tab.fields || []) {
        if (!field.readOnly && !READ_ONLY_SYSTEM_PROPERTIES.has(field.property)) {
          propSet.add(field.property);
        }
      }
    }
    return propSet;
  });

  // Intersect all property sets
  const [firstSet, ...restSets] = formPropertySets;
  const commonProps = new Set(
    Array.from(firstSet).filter((prop) => restSets.every((s) => s.has(prop)))
  );

  // Use the first form's tab ordering for the intersected fields
  const firstForm = resolvedForms[0];
  const tabs = [];
  const fields = [];
  const seenCommon = new Set();

  for (const tab of firstForm.tabs || []) {
    const tabFields = [];
    for (const field of tab.fields || []) {
      if (commonProps.has(field.property) && !seenCommon.has(field.property)) {
        seenCommon.add(field.property);
        const enriched = { ...field, tabId: tab.id, tabLabel: tab.label };
        tabFields.push(enriched);
        fields.push(enriched);
      }
    }
    if (tabFields.length > 0) {
      tabs.push({
        id: tab.id,
        label: tab.label,
        fields: tabFields
      });
    }
  }

  // Collect omitted fields (present on at least one form, but not all)
  const omittedMap = new Map();
  for (const form of resolvedForms) {
    for (const tab of form.tabs || []) {
      for (const field of tab.fields || []) {
        if (
          !commonProps.has(field.property) &&
          !field.readOnly &&
          !READ_ONLY_SYSTEM_PROPERTIES.has(field.property) &&
          !omittedMap.has(field.property)
        ) {
          omittedMap.set(field.property, {
            property: field.property,
            label: field.label,
            formName: form.name
          });
        }
      }
    }
  }

  return {
    tabs,
    fields,
    omittedFields: Array.from(omittedMap.values()),
    distinctForms
  };
}
