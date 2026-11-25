/**
 * Mixed-entry computation and RFC 6902 JSON Patch builder for bulk metadata editing.
 *
 * Mirrors AEM Admin View's behavior:
 * - Fields with identical values across all selected assets show that shared value.
 * - Fields with differing values show "<Mixed Entries>" and are NOT overwritten unless edited.
 * - Multi-value fields (Tags, Keywords, Multi-select) support Append (merge) and Replace modes.
 */

function toArray(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).filter((v) => v.length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }
  return [];
}

function normalizeScalar(value, fieldType) {
  if (value === undefined || value === null) return '';
  if (fieldType === 'boolean') return Boolean(value);
  if (fieldType === 'date') {
    // Normalize ISO datetime strings to YYYY-MM-DD for consistent comparison
    const str = String(value);
    const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : str;
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return String(value);
}

/**
 * Computes initial field display state across all selected assets.
 *
 * Returns a map keyed by field.property:
 * {
 *   isMixed: boolean,
 *   sharedValue: string | boolean | string[] | null,
 *   // For multi-value fields:
 *   commonValues: string[],   // present on EVERY selected asset
 *   partialValues: string[],  // present on SOME (not all) selected assets
 *   allValues: string[]       // union of values across selected assets
 * }
 */
export function computeCommonFieldStates(commonFields, assets) {
  const states = {};
  if (!Array.isArray(commonFields) || !Array.isArray(assets) || assets.length === 0) {
    return states;
  }

  for (const field of commonFields) {
    const prop = field.property;

    if (field.multiValue) {
      const perAssetSets = assets.map((a) => new Set(toArray(a.assetMetadata?.[prop])));
      const allValuesSet = new Set();
      for (const s of perAssetSets) {
        for (const v of s) allValuesSet.add(v);
      }

      const allValues = Array.from(allValuesSet).sort();
      const commonValues = allValues.filter((v) => perAssetSets.every((s) => s.has(v)));
      const partialValues = allValues.filter((v) => !perAssetSets.every((s) => s.has(v)));
      const isMixed = partialValues.length > 0;

      states[prop] = {
        isMixed,
        sharedValue: isMixed ? null : commonValues,
        commonValues,
        partialValues,
        allValues
      };
    } else {
      const normalizedValues = assets.map((a) =>
        normalizeScalar(a.assetMetadata?.[prop], field.type)
      );
      const first = normalizedValues[0];
      const allEqual = normalizedValues.every((v) => v === first);

      states[prop] = {
        isMixed: !allEqual,
        sharedValue: allEqual ? first : null
      };
    }
  }

  return states;
}

/**
 * Escapes a property key for RFC 6901 JSON Pointer.
 */
function escapeJsonPointer(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Formats a value for the AEM Assets Author API PATCH payload.
 */
function formatValueForAem(value, field) {
  if (field.type === 'number') {
    const num = Number(value);
    return Number.isNaN(num) ? value : num;
  }
  if (field.type === 'boolean') {
    return Boolean(value);
  }
  if (field.type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00.000Z`;
  }
  return value;
}

/**
 * Builds an RFC 6902 JSON Patch array for a single asset based on only the user's dirty edits.
 *
 * dirtyEdits shape:
 * {
 *   [property]: {
 *     // For scalar fields:
 *     value: string | number | boolean | null,
 *     // For multi-value fields:
 *     mode: 'append' | 'replace',
 *     values: string[],          // items to append (in append mode) or full set (in replace mode)
 *     removedValues?: string[]   // items explicitly removed in append mode
 *   }
 * }
 */
export function buildJsonPatchForAsset(assetMetadata = {}, dirtyEdits = {}, fieldsByProperty = {}) {
  const operations = [];

  for (const [prop, edit] of Object.entries(dirtyEdits)) {
    if (!edit) continue;
    const field = fieldsByProperty[prop];
    if (!field || field.readOnly) continue;

    const pointer = `/assetMetadata/${escapeJsonPointer(prop)}`;
    const hasExisting =
      Object.prototype.hasOwnProperty.call(assetMetadata, prop) &&
      assetMetadata[prop] !== undefined &&
      assetMetadata[prop] !== null;

    if (field.multiValue) {
      const existing = toArray(assetMetadata[prop]);
      const mode = edit.mode || 'append';
      let nextValues;

      if (mode === 'replace') {
        nextValues = Array.from(new Set(toArray(edit.values)));
      } else {
        // Append mode: start with existing, remove any explicitly removed values, add new ones
        const removedSet = new Set(toArray(edit.removedValues));
        const merged = existing.filter((v) => !removedSet.has(v));
        for (const v of toArray(edit.values)) {
          if (!merged.includes(v)) {
            merged.push(v);
          }
        }
        nextValues = merged;
      }

      // Skip no-op if array is identical
      const sameLength = existing.length === nextValues.length;
      const sameContent = sameLength && existing.every((v, idx) => v === nextValues[idx]);
      if (sameContent) {
        continue;
      }

      if (nextValues.length === 0 && hasExisting) {
        operations.push({ op: 'remove', path: pointer });
      } else if (nextValues.length > 0) {
        // RFC 6902 / AEM Assets Author API: `add` creates if absent AND overwrites if present
        operations.push({
          op: 'add',
          path: pointer,
          value: nextValues
        });
      }
    } else {
      const rawValue = edit.value;
      const isClearing = rawValue === '' || rawValue === null || rawValue === undefined;

      if (isClearing) {
        if (hasExisting) {
          operations.push({ op: 'remove', path: pointer });
        }
        continue;
      }

      const formatted = formatValueForAem(rawValue, field);
      if (assetMetadata[prop] === formatted) {
        continue;
      }

      operations.push({
        op: 'add',
        path: pointer,
        value: formatted
      });
    }
  }

  return operations;
}
