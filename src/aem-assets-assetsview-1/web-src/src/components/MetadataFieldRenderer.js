import React, { useState } from 'react';
import {
  ActionButton,
  Badge,
  Checkbox,
  Flex,
  Item,
  Picker,
  Radio,
  RadioGroup,
  Text,
  TextArea,
  TextField,
  View
} from '@adobe/react-spectrum';

const MIXED_PLACEHOLDER = '<Mixed Entries>';

function FieldHeader({ field, initialState, isDirty, onReset }) {
  return (
    <Flex alignItems="center" justifyContent="space-between" marginBottom="size-50">
      <Flex alignItems="center" gap="size-100">
        <Text UNSAFE_style={{ fontWeight: 600, fontSize: 13 }}>
          {field.label}
          {field.required ? ' *' : ''}
        </Text>
        <Text UNSAFE_style={{ fontSize: 11, opacity: 0.65 }}>{field.property}</Text>
        {initialState?.isMixed && !isDirty && (
          <Badge variant="info">Mixed Entries</Badge>
        )}
        {isDirty && <Badge variant="positive">Modified</Badge>}
      </Flex>
      {isDirty && (
        <ActionButton isQuiet onPress={onReset} UNSAFE_style={{ height: 24 }}>
          Reset
        </ActionButton>
      )}
    </Flex>
  );
}

function MultiValueField({ field, initialState, edit, onChange, onReset }) {
  const [draft, setDraft] = useState('');
  const isDirty = Boolean(edit);
  const mode = edit?.mode || 'append';
  const addedValues = edit?.values || [];
  const removedValues = edit?.removedValues || [];

  const commonValues = initialState?.commonValues || [];
  const partialValues = initialState?.partialValues || [];

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const nextValues = addedValues.includes(trimmed) ? addedValues : [...addedValues, trimmed];
    onChange({
      mode,
      values: nextValues,
      removedValues: removedValues.filter((v) => v !== trimmed)
    });
    setDraft('');
  };

  const handleModeChange = (nextMode) => {
    if (nextMode === 'replace') {
      const seed = Array.from(new Set([...commonValues, ...addedValues])).filter(
        (v) => !removedValues.includes(v)
      );
      onChange({ mode: 'replace', values: seed, removedValues: [] });
    } else {
      onChange({ mode: 'append', values: addedValues, removedValues });
    }
  };

  const toggleRemoveExisting = (val) => {
    if (mode === 'replace') {
      onChange({
        mode: 'replace',
        values: addedValues.filter((v) => v !== val),
        removedValues: []
      });
      return;
    }
    const nextRemoved = removedValues.includes(val)
      ? removedValues.filter((v) => v !== val)
      : [...removedValues, val];
    onChange({ mode: 'append', values: addedValues, removedValues: nextRemoved });
  };

  const removeAdded = (val) => {
    onChange({
      mode,
      values: addedValues.filter((v) => v !== val),
      removedValues
    });
  };

  const chipStyle = (variant) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 10px',
    borderRadius: 12,
    fontSize: 12,
    border: '1px solid var(--spectrum-global-color-gray-400)',
    backgroundColor:
      variant === 'added'
        ? 'var(--spectrum-global-color-blue-100)'
        : variant === 'removed'
        ? 'var(--spectrum-global-color-red-100)'
        : variant === 'partial'
        ? 'var(--spectrum-global-color-gray-100)'
        : 'var(--spectrum-global-color-gray-200)',
    textDecoration: variant === 'removed' ? 'line-through' : 'none',
    opacity: variant === 'partial' ? 0.8 : 1
  });

  return (
    <View
      padding="size-150"
      borderWidth="thin"
      borderColor={isDirty ? 'blue-500' : 'gray-300'}
      borderRadius="medium"
    >
      <FieldHeader field={field} initialState={initialState} isDirty={isDirty} onReset={onReset} />

      <RadioGroup
        aria-label={`${field.label} update mode`}
        orientation="horizontal"
        value={mode}
        onChange={handleModeChange}
        marginBottom="size-100"
      >
        <Radio value="append">Append / Remove (preserve existing per-asset values)</Radio>
        <Radio value="replace">Replace all values</Radio>
      </RadioGroup>

      <Flex gap="size-100" alignItems="end" marginBottom="size-100">
        <TextField
          aria-label={`Add ${field.label}`}
          placeholder={
            field.type === 'tags'
              ? 'Add tag (e.g. brand:spring-2026) and press Enter'
              : `Add ${field.label.toLowerCase()} and press Enter`
          }
          value={draft}
          onChange={setDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          flex
        />
        <ActionButton onPress={handleAdd} isDisabled={!draft.trim()}>
          Add
        </ActionButton>
      </Flex>

      <Flex wrap gap="size-75">
        {mode === 'append' &&
          commonValues.map((val) => {
            const isRemoved = removedValues.includes(val);
            return (
              <span key={`common-${val}`} style={chipStyle(isRemoved ? 'removed' : 'common')}>
                <span>{val}</span>
                <button
                  type="button"
                  onClick={() => toggleRemoveExisting(val)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: 0,
                    fontWeight: 700
                  }}
                  title={isRemoved ? 'Undo remove' : 'Remove from all selected assets'}
                >
                  {isRemoved ? '↺' : '×'}
                </button>
              </span>
            );
          })}

        {mode === 'append' &&
          partialValues.map((val) => {
            const isRemoved = removedValues.includes(val);
            return (
              <span
                key={`partial-${val}`}
                style={chipStyle(isRemoved ? 'removed' : 'partial')}
                title="Present on some (not all) selected assets"
              >
                <span>{val} (partial)</span>
                <button
                  type="button"
                  onClick={() => toggleRemoveExisting(val)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: 0,
                    fontWeight: 700
                  }}
                  title={isRemoved ? 'Undo remove' : 'Remove from assets that have this value'}
                >
                  {isRemoved ? '↺' : '×'}
                </button>
              </span>
            );
          })}

        {addedValues.map((val) => (
          <span key={`added-${val}`} style={chipStyle('added')}>
            <span>
              {mode === 'append' ? '+ ' : ''}
              {val}
            </span>
            <button
              type="button"
              onClick={() => removeAdded(val)}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: 0,
                fontWeight: 700
              }}
              title="Remove"
            >
              ×
            </button>
          </span>
        ))}
      </Flex>
    </View>
  );
}

export default function MetadataFieldRenderer({
  field,
  initialState,
  edit,
  onChange,
  onReset
}) {
  const isDirty = Boolean(edit);

  if (field.multiValue) {
    return (
      <MultiValueField
        field={field}
        initialState={initialState}
        edit={edit}
        onChange={onChange}
        onReset={onReset}
      />
    );
  }

  const currentValue = isDirty
    ? edit.value
    : initialState?.isMixed
    ? ''
    : initialState?.sharedValue ?? '';

  const placeholder = !isDirty && initialState?.isMixed ? MIXED_PLACEHOLDER : '';

  if (field.type === 'boolean') {
    const isIndeterminate = !isDirty && Boolean(initialState?.isMixed);
    return (
      <View
        padding="size-150"
        borderWidth="thin"
        borderColor={isDirty ? 'blue-500' : 'gray-300'}
        borderRadius="medium"
      >
        <FieldHeader
          field={field}
          initialState={initialState}
          isDirty={isDirty}
          onReset={onReset}
        />
        <Checkbox
          isSelected={Boolean(currentValue)}
          isIndeterminate={isIndeterminate}
          onChange={(checked) => onChange({ value: checked })}
        >
          {field.label}
        </Checkbox>
      </View>
    );
  }

  if (field.type === 'select' && Array.isArray(field.options) && field.options.length > 0) {
    return (
      <View
        padding="size-150"
        borderWidth="thin"
        borderColor={isDirty ? 'blue-500' : 'gray-300'}
        borderRadius="medium"
      >
        <FieldHeader
          field={field}
          initialState={initialState}
          isDirty={isDirty}
          onReset={onReset}
        />
        <Picker
          aria-label={field.label}
          width="100%"
          placeholder={placeholder || `Select ${field.label}`}
          selectedKey={currentValue || null}
          onSelectionChange={(key) => onChange({ value: String(key) })}
        >
          {field.options.map((opt) => (
            <Item key={opt.value}>{opt.label}</Item>
          ))}
        </Picker>
      </View>
    );
  }

  if (field.type === 'textarea') {
    return (
      <View
        padding="size-150"
        borderWidth="thin"
        borderColor={isDirty ? 'blue-500' : 'gray-300'}
        borderRadius="medium"
      >
        <FieldHeader
          field={field}
          initialState={initialState}
          isDirty={isDirty}
          onReset={onReset}
        />
        <TextArea
          aria-label={field.label}
          width="100%"
          placeholder={placeholder}
          value={String(currentValue ?? '')}
          onChange={(val) => onChange({ value: val })}
        />
      </View>
    );
  }

  if (field.type === 'date') {
    return (
      <View
        padding="size-150"
        borderWidth="thin"
        borderColor={isDirty ? 'blue-500' : 'gray-300'}
        borderRadius="medium"
      >
        <FieldHeader
          field={field}
          initialState={initialState}
          isDirty={isDirty}
          onReset={onReset}
        />
        <Flex alignItems="center" gap="size-100">
          <input
            type="date"
            aria-label={field.label}
            value={String(currentValue ?? '')}
            onChange={(e) => onChange({ value: e.target.value })}
            style={{
              padding: '6px 10px',
              borderRadius: 4,
              border: '1px solid var(--spectrum-global-color-gray-400)',
              fontSize: 14,
              minWidth: 200
            }}
          />
          {!isDirty && initialState?.isMixed && (
            <Text UNSAFE_style={{ fontSize: 12, opacity: 0.7 }}>{MIXED_PLACEHOLDER}</Text>
          )}
        </Flex>
      </View>
    );
  }

  return (
    <View
      padding="size-150"
      borderWidth="thin"
      borderColor={isDirty ? 'blue-500' : 'gray-300'}
      borderRadius="medium"
    >
      <FieldHeader field={field} initialState={initialState} isDirty={isDirty} onReset={onReset} />
      <TextField
        aria-label={field.label}
        width="100%"
        type={field.type === 'number' ? 'number' : 'text'}
        placeholder={placeholder}
        value={String(currentValue ?? '')}
        onChange={(val) => onChange({ value: val })}
      />
    </View>
  );
}
