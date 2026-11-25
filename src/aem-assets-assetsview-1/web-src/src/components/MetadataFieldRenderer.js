import React, { useState } from 'react';
import {
  ActionButton,
  Checkbox,
  Flex,
  Item,
  Picker,
  Radio,
  RadioGroup,
  Text,
  TextArea,
  TextField,
  Tooltip,
  TooltipTrigger
} from '@adobe/react-spectrum';
import Undo from '@spectrum-icons/workflow/Undo';

const MIXED_PLACEHOLDER = '<Mixed Entries>';

function FieldLabelRow({ field, initialState, isDirty, onReset }) {
  return (
    <Flex alignItems="center" justifyContent="space-between" marginBottom="size-65" minHeight="size-250">
      <Flex alignItems="center" gap="size-100">
        <Text
          UNSAFE_style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--spectrum-alias-label-text-color, var(--spectrum-global-color-gray-700))'
          }}
        >
          {field.label}
          {field.required ? (
            <span style={{ color: 'var(--spectrum-global-color-red-600)', marginLeft: 2 }}>*</span>
          ) : null}
        </Text>

        {isDirty ? (
          <Text
            UNSAFE_style={{
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--spectrum-global-color-blue-600, #1473e6)'
            }}
          >
            Modified
          </Text>
        ) : initialState?.isMixed ? (
          <Text
            UNSAFE_style={{
              fontSize: 11,
              color: 'var(--spectrum-global-color-gray-600, #6e6e6e)'
            }}
          >
            Mixed
          </Text>
        ) : null}
      </Flex>

      {isDirty && (
        <TooltipTrigger delay={300}>
          <ActionButton
            isQuiet
            aria-label={`Reset ${field.label}`}
            onPress={onReset}
            UNSAFE_style={{ height: 22, minWidth: 22 }}
          >
            <Undo size="XS" />
          </ActionButton>
          <Tooltip>Reset {field.label}</Tooltip>
        </TooltipTrigger>
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

  return (
    <div>
      <FieldLabelRow
        field={field}
        initialState={initialState}
        isDirty={isDirty}
        onReset={onReset}
      />

      <Flex gap="size-100" alignItems="center" marginBottom="size-100">
        <TextField
          aria-label={`Add ${field.label}`}
          placeholder={
            field.type === 'tags'
              ? 'Add tag and press Enter'
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

      <RadioGroup
        aria-label={`${field.label} update mode`}
        orientation="horizontal"
        value={mode}
        onChange={handleModeChange}
        marginBottom="size-100"
      >
        <Radio value="append">Append to existing</Radio>
        <Radio value="replace">Replace all</Radio>
      </RadioGroup>

      {(commonValues.length > 0 || partialValues.length > 0 || addedValues.length > 0) && (
        <Flex wrap gap="size-75" marginTop="size-50">
          {mode === 'append' &&
            commonValues.map((val) => {
              const isRemoved = removedValues.includes(val);
              return (
                <span
                  key={`common-${val}`}
                  className={`aem-spectrum-chip ${isRemoved ? 'aem-spectrum-chip--removed' : ''}`}
                >
                  <span>{val}</span>
                  <button
                    type="button"
                    className="aem-spectrum-chip-btn"
                    onClick={() => toggleRemoveExisting(val)}
                    title={isRemoved ? 'Undo remove' : 'Remove from all checked assets'}
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
                  className={`aem-spectrum-chip ${
                    isRemoved ? 'aem-spectrum-chip--removed' : 'aem-spectrum-chip--partial'
                  }`}
                  title="Present on some (not all) checked assets"
                >
                  <span>{val}</span>
                  <button
                    type="button"
                    className="aem-spectrum-chip-btn"
                    onClick={() => toggleRemoveExisting(val)}
                    title={isRemoved ? 'Undo remove' : 'Remove from assets that have this value'}
                  >
                    {isRemoved ? '↺' : '×'}
                  </button>
                </span>
              );
            })}

          {addedValues.map((val) => (
            <span key={`added-${val}`} className="aem-spectrum-chip aem-spectrum-chip--added">
              <span>
                {mode === 'append' ? '+ ' : ''}
                {val}
              </span>
              <button
                type="button"
                className="aem-spectrum-chip-btn"
                onClick={() => removeAdded(val)}
                title="Remove"
              >
                ×
              </button>
            </span>
          ))}
        </Flex>
      )}
    </div>
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
      <div className="aem-bulk-field-wide">
        <MultiValueField
          field={field}
          initialState={initialState}
          edit={edit}
          onChange={onChange}
          onReset={onReset}
        />
      </div>
    );
  }

  const currentValue = isDirty
    ? edit.value
    : initialState?.isMixed
    ? ''
    : initialState?.sharedValue ?? '';

  const placeholder = !isDirty && initialState?.isMixed ? MIXED_PLACEHOLDER : '';
  const wrapperClass = field.type === 'textarea' ? 'aem-bulk-field-wide' : undefined;

  if (field.type === 'boolean') {
    const isIndeterminate = !isDirty && Boolean(initialState?.isMixed);
    return (
      <div className={wrapperClass}>
        <FieldLabelRow
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
      </div>
    );
  }

  if (field.type === 'select' && Array.isArray(field.options) && field.options.length > 0) {
    return (
      <div className={wrapperClass}>
        <FieldLabelRow
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
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className={wrapperClass}>
        <FieldLabelRow
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
      </div>
    );
  }

  if (field.type === 'date') {
    return (
      <div className={wrapperClass}>
        <FieldLabelRow
          field={field}
          initialState={initialState}
          isDirty={isDirty}
          onReset={onReset}
        />
        <Flex alignItems="center" gap="size-100">
          <input
            type="date"
            aria-label={field.label}
            className="aem-spectrum-date-input"
            value={String(currentValue ?? '')}
            onChange={(e) => onChange({ value: e.target.value })}
          />
          {!isDirty && initialState?.isMixed && (
            <Text UNSAFE_style={{ fontSize: 12, opacity: 0.65 }}>{MIXED_PLACEHOLDER}</Text>
          )}
        </Flex>
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      <FieldLabelRow
        field={field}
        initialState={initialState}
        isDirty={isDirty}
        onReset={onReset}
      />
      <TextField
        aria-label={field.label}
        width="100%"
        type={field.type === 'number' ? 'number' : 'text'}
        placeholder={placeholder}
        value={String(currentValue ?? '')}
        onChange={(val) => onChange({ value: val })}
      />
    </div>
  );
}
