'use client';
import { Trash2, Plus } from 'lucide-react';

export interface Column {
  key: string;
  header: string;
  type?: 'text' | 'number' | 'select';
  options?: string[];
  placeholder?: string;
  width?: string;
  render?: (value: string, onChange: (v: string) => void, row: Record<string, string>) => React.ReactNode;
  parsePaste?: (values: string[]) => { value: string; consumed: number };
}

interface Props {
  columns: Column[];
  rows: Record<string, string>[];
  onChange: (rows: Record<string, string>[]) => void;
  createEmpty: () => Record<string, string>;
}

export default function EditableTable({ columns, rows, onChange, createEmpty }: Props) {
  function update(rowIdx: number, key: string, value: string) {
    onChange(rows.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r)));
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>, rowIdx: number, colIdx: number) {
    const text = e.clipboardData.getData('text');
    const pasteRows = text.trimEnd().split('\n');
    if (pasteRows.length === 1 && !pasteRows[0].includes('\t')) return;
    e.preventDefault();
    const matrix = pasteRows.map(r => r.split('\t'));
    const next = [...rows];
    matrix.forEach((pasteRow, dr) => {
      const ri = rowIdx + dr;
      while (next.length <= ri) next.push(createEmpty());
      let ci = colIdx;
      let pi = 0;
      while (ci < columns.length && pi < pasteRow.length) {
        const col = columns[ci];
        if (col.parsePaste) {
          const { value, consumed } = col.parsePaste(pasteRow.slice(pi));
          next[ri] = { ...next[ri], [col.key]: value };
          pi += consumed;
        } else if (col.type === 'select' && col.options) {
          const raw = pasteRow[pi].trim().toLowerCase();
          const match = col.options.find(o => o.toLowerCase() === raw) ?? col.options[0];
          next[ri] = { ...next[ri], [col.key]: match };
          pi++;
        } else {
          next[ri] = { ...next[ri], [col.key]: pasteRow[pi].trim() };
          pi++;
        }
        ci++;
      }
    });
    onChange(next);
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full border-collapse text-base">
        <thead>
          <tr className="bg-gray-50">
            {columns.map(col => (
              <th
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                className="border-b border-gray-200 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide text-gray-500"
              >
                {col.header}
              </th>
            ))}
            <th className="w-12 border-b border-gray-200" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="py-12 text-center text-base text-gray-400">
                No rows — paste from a spreadsheet or click Add row
              </td>
            </tr>
          )}
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="group hover:bg-gray-50">
              {columns.map((col, colIdx) => (
                <td key={col.key} className="border-b border-gray-100 px-2.5 py-1">
                  {col.render ? (
                    col.render(row[col.key] ?? '', v => update(rowIdx, col.key, v), row)
                  ) : col.type === 'select' ? (
                    <select
                      value={row[col.key] ?? ''}
                      onChange={e => update(rowIdx, col.key, e.target.value)}
                      onPaste={e => handlePaste(e as unknown as React.ClipboardEvent<HTMLInputElement>, rowIdx, colIdx)}
                      className="w-full rounded border-0 bg-transparent px-1.5 py-1.5 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
                    >
                      {(col.options ?? []).map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={col.type === 'number' ? 'number' : 'text'}
                      value={row[col.key] ?? ''}
                      placeholder={col.placeholder}
                      onChange={e => update(rowIdx, col.key, e.target.value)}
                      onPaste={e => handlePaste(e, rowIdx, colIdx)}
                      className="w-full rounded border-0 bg-transparent px-1.5 py-1.5 text-base text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
                    />
                  )}
                </td>
              ))}
              <td className="border-b border-gray-100 px-2.5 py-1">
                <button
                  onClick={() => onChange(rows.filter((_, i) => i !== rowIdx))}
                  className="invisible rounded p-1 text-gray-300 hover:text-red-400 group-hover:visible"
                >
                  <Trash2 size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-gray-100 bg-gray-50 px-4 py-2.5">
        <button
          onClick={() => onChange([...rows, createEmpty()])}
          className="flex items-center gap-1.5 text-base text-gray-400 hover:text-gray-700"
        >
          <Plus size={15} />
          Add row
        </button>
      </div>
    </div>
  );
}
