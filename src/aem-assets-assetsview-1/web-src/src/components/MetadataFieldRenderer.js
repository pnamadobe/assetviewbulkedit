import React, { useMemo, useState } from 'react';
import { parseDate } from '@internationalized/date';
import {
  ActionButton,
  Checkbox,
  ComboBox,
  DatePicker,
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

function safeParseDate(str) {
  if (!str || typeof str !== 'string') return null;
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  try {
    return parseDate(match[1]);
  } catch {
    return null;
  }
}

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

function MultiValueField({ field, initialState, edit, onChange, onReset, availableTags = [] }) {
  const [draft, setDraft] = useState('');
  const isDirty = Boolean(edit);
  const mode = edit?.mode || 'append';
  const addedValues = edit?.values || [];
  const removedValues = edit?.removedValues || [];

  const commonValues = initialState?.commonValues || [];
  const partialValues = initialState?.partialValues || [];

  const tagTitleById = useMemo(() => {
    const map = new Map();
    for (const t of availableTags) {
      map.set(t.id, t.displayPath || t.title || t.id);
    }
    return map;
  }, [availableTags]);

  const addValue = (rawVal) => {
    const trimmed = String(rawVal || '').trim();
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

  const formatChipLabel = (val) => {
    if (field.type === 'tags' && tagTitleById.has(val)) {
      return tagTitleById.get(val);
    }
    return val;
  };

  const useTagComboBox = field.type === 'tags' && availableTags.length > 0;

  return (
    <div>
      <FieldLabelRow
        field={field}
        initialState={initialState}
        isDirty={isDirty}
        onReset={onReset}
      />

      <Flex gap="size-100" alignItems="center" marginBottom="size-100">
        {useTagComboBox ? (
          <ComboBox
            aria-label={`Search ${field.label}`}
            placeholder="Search AEM tags or type a tag ID…"
            allowsCustomValue
            inputValue={draft}
            onInputChange={setDraft}
            onSelectionChange={(key) => {
              if (key) {
                addValue(String(key));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                e.preventDefault();
                addValue(draft);
              }
            }}
            flex
          >
            {availableTags.map((tag) => (
              <Item key={tag.id} textValue={`${tag.displayPath} ${tag.id}`}>
                <Text>{tag.displayPath}</Text>
                <Text slot="description">{tag.id}</Text>
              </Item>
            ))}
          </ComboBox>
        ) : (
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
                addValue(draft);
              }
            }}
            flex
          />
        )}
        <ActionButton onPress={() => addValue(draft)} isDisabled={!draft.trim()}>
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
                  title={val}
                >
                  <span>{formatChipLabel(val)}</span>
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
                  title={`${val} — present on some (not all) checked assets`}
                >
                  <span>{formatChipLabel(val)}</span>
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
            <span
              key={`added-${val}`}
              className="aem-spectrum-chip aem-spectrum-chip--added"
              title={val}
            >
              <span>
                {mode === 'append' ? '+ ' : ''}
                {formatChipLabel(val)}
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
  onReset,
  availableTags = []
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
          availableTags={availableTags}
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
    const parsedDate = safeParseDate(String(currentValue ?? ''));
    return (
      <div className={wrapperClass}>
        <FieldLabelRow
          field={field}
          initialState={initialState}
          isDirty={isDirty}
          onReset={onReset}
        />
        <DatePicker
          aria-label={field.label}
          width="100%"
          value={parsedDate}
          onChange={(dateVal) => onChange({ value: dateVal ? dateVal.toString() : '' })}
        />
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
