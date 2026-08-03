'use client';

// components/test-plugins/tester/SchemaForm.tsx
//
// Recursive, free-text form renderer driven purely by FormFieldDescriptor[] (FR3).
// NO JSON editing anywhere in the default form: nested objects render as titled
// groups of labeled inputs; arrays-of-objects render as add/remove-row repeaters of
// flattened inputs; 2-D arrays render as a repeater of comma-separated rows. No
// plugin/action names appear here — everything is descriptor-driven (F5).

import type { FormFieldDescriptor } from '@/lib/plugins/tester/tester-types';
import { seedRow } from '@/lib/plugins/tester/form-values';

/** Nested field values mirroring the payload shape. */
export type FormValues = Record<string, unknown>;

type Path = (string | number)[];

interface SchemaFormProps {
  fields: FormFieldDescriptor[];
  values: FormValues;
  /** Set a single value by absolute path. */
  onChange: (path: Path, value: unknown) => void;
}

const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 };
const inputStyle: React.CSSProperties = { width: '100%', padding: 8, fontSize: 13, border: '1px solid #ccc', borderRadius: 3 };
const hintStyle: React.CSSProperties = { fontSize: 11, color: '#666', marginTop: 2 };

export function SchemaForm({ fields, values, onChange }: SchemaFormProps) {
  if (fields.length === 0) {
    return <div style={{ fontSize: 13, color: '#666' }}>This action takes no parameters.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {fields.map((field) => (
        <FieldRenderer key={field.name} field={field} value={values[field.name]} path={field.path} onChange={onChange} />
      ))}
    </div>
  );
}

function FieldRenderer({
  field,
  value,
  path,
  onChange,
}: {
  field: FormFieldDescriptor;
  value: unknown;
  path: Path;
  onChange: (path: Path, value: unknown) => void;
}) {
  // ── Object group: titled fieldset of flattened child inputs ────────────────
  if (field.control === 'object') {
    return (
      <fieldset data-testid={`group-${field.name}`} style={{ border: '1px solid #e0e0e0', borderRadius: 4, padding: 12, margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 13, padding: '0 6px' }}>
          {field.label}
          {field.required && <span style={{ color: '#dc3545' }} aria-hidden> *</span>}
        </legend>
        {field.description && <div style={hintStyle}>{field.description}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          {(field.children || []).map((child) => (
            <FieldRenderer
              key={child.name}
              field={child}
              value={(value as Record<string, unknown> | undefined)?.[child.name]}
              path={[...path, child.name]}
              onChange={onChange}
            />
          ))}
        </div>
      </fieldset>
    );
  }

  // ── Object array: add/remove-row repeater of flattened item inputs ─────────
  if (field.control === 'object-array') {
    const rows = Array.isArray(value) ? (value as unknown[]) : [];
    const addRow = () => onChange(path, [...rows, seedRow(field)]);
    const removeRow = (idx: number) => onChange(path, rows.filter((_, i) => i !== idx));
    return (
      <div data-testid={`objectarray-${field.name}`}>
        <label style={labelStyle}>
          {field.label}
          {field.required && <span style={{ color: '#dc3545' }} aria-hidden> *</span>}
        </label>
        {field.description && <div style={hintStyle}>{field.description}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
          {rows.map((row, idx) => (
            <div key={idx} style={{ border: '1px dashed #ccc', borderRadius: 4, padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: '#888' }}>Row {idx + 1}</span>
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  style={{ padding: '2px 8px', fontSize: 11, backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                >
                  Remove
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(field.itemFields || []).map((item) => (
                  <FieldRenderer
                    key={item.name}
                    field={item}
                    value={(row as Record<string, unknown> | undefined)?.[item.name]}
                    path={[...path, idx, item.name]}
                    onChange={onChange}
                  />
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            style={{ alignSelf: 'flex-start', padding: '4px 12px', fontSize: 12, backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}
          >
            + Add row
          </button>
        </div>
      </div>
    );
  }

  // ── 2-D matrix: repeater of comma-separated rows ───────────────────────────
  if (field.control === 'scalar-matrix') {
    const rows = Array.isArray(value) ? (value as string[]) : [];
    const addRow = () => onChange(path, [...rows, '']);
    const removeRow = (idx: number) => onChange(path, rows.filter((_, i) => i !== idx));
    return (
      <div data-testid={`matrix-${field.name}`}>
        <label style={labelStyle}>
          {field.label}
          {field.required && <span style={{ color: '#dc3545' }} aria-hidden> *</span>}
        </label>
        <div style={hintStyle}>Each row = comma-separated values (one row per line item).</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          {rows.map((row, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                style={inputStyle}
                placeholder={`Row ${idx + 1}: a, b, c`}
                value={typeof row === 'string' ? row : ''}
                onChange={(e) => onChange([...path, idx], e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeRow(idx)}
                style={{ padding: '4px 8px', fontSize: 11, backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            style={{ alignSelf: 'flex-start', padding: '4px 12px', fontSize: 12, backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}
          >
            + Add row
          </button>
        </div>
      </div>
    );
  }

  // ── Leaf controls ──────────────────────────────────────────────────────────
  const id = `tester-${field.path.join('-')}`;
  return (
    <div data-testid={`field-${field.path.join('-')}`}>
      <label style={labelStyle} htmlFor={id}>
        {field.label}
        {field.required && <span style={{ color: '#dc3545' }} aria-hidden> *</span>}
        {field.isDynamicOption && (
          <span style={{ fontWeight: 400, color: '#0a58ca', fontSize: 11 }}>
            {' '}(ID — options from {field.dynamicOptionSource})
          </span>
        )}
      </label>
      {renderLeaf(field, value, path, onChange, id)}
      {field.description && <div style={hintStyle}>{field.description}</div>}
    </div>
  );
}

function renderLeaf(
  field: FormFieldDescriptor,
  value: unknown,
  path: Path,
  onChange: (path: Path, value: unknown) => void,
  id: string
) {
  switch (field.control) {
    case 'boolean':
      return (
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(path, e.target.checked)} />
      );

    case 'number':
      return (
        <input
          id={id}
          type="number"
          style={inputStyle}
          min={field.min}
          max={field.max}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(path, e.target.value === '' ? '' : Number(e.target.value))}
        />
      );

    case 'enum':
      return (
        <select id={id} style={inputStyle} value={value === undefined || value === null ? '' : String(value)} onChange={(e) => onChange(path, e.target.value)}>
          <option value="">-- select --</option>
          {(field.enumValues || []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    case 'scalar-array':
      return (
        <input
          id={id}
          type="text"
          style={inputStyle}
          placeholder="comma-separated values"
          value={Array.isArray(value) ? (value as unknown[]).join(', ') : String(value ?? '')}
          onChange={(e) => onChange(path, e.target.value)}
        />
      );

    case 'text':
    default:
      return (
        <input
          id={id}
          type="text"
          style={inputStyle}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(path, e.target.value)}
        />
      );
  }
}
