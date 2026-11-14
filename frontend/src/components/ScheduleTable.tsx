'use client';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { ScheduleEntry, Space, Timeslot, sortDays, toMinutes } from '@/lib/types';

// The schedule as a plain table, one row per session in time order: the Scheduler page's
// alternative to the calendar. Copy Table puts it on the clipboard as tab-separated text,
// which Excel and Google Sheets paste into separate cells.

const HEADINGS = ['Group', 'Trainer', 'Day', 'Start Time', 'End Time', 'Location', 'Space'];

interface Props {
  timeslots: Timeslot[];
  spaces: Space[];
  result: ScheduleEntry[];
  toolbar?: React.ReactNode; // shown on the left of the Copy Table button (the view switch)
}

export default function ScheduleTable({ timeslots, spaces, result, toolbar }: Props) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const spaceByName = new Map(spaces.map(s => [s.spaceName, s]));
  const spaceOrder = new Map(spaces.map((s, i) => [s.spaceName, i]));
  const dayOrder = sortDays([...new Set(timeslots.map(t => t.day))]);

  // Sorted by day, then start time, then location and space (in the order they're entered).
  const rows = result
    .filter(entry => timeslots[entry.timeslot])
    .map(entry => ({ entry, slot: timeslots[entry.timeslot], space: spaceByName.get(entry.space) }))
    .sort((a, b) =>
      dayOrder.indexOf(a.slot.day) - dayOrder.indexOf(b.slot.day)
      || toMinutes(a.slot.start) - toMinutes(b.slot.start)
      || (spaceOrder.get(a.entry.space) ?? 0) - (spaceOrder.get(b.entry.space) ?? 0))
    .map(({ entry, slot, space }) => [
      entry.group, entry.trainer, slot.day, slot.start, slot.finish,
      space?.location ?? '', space?.label ?? entry.space,
    ]);

  async function copyTable() {
    // Tabs between cells and new lines between rows; a tab or line break inside a name
    // would split the cell, so those become spaces.
    const text = [HEADINGS, ...rows]
      .map(row => row.map(cell => cell.replace(/[\t\r\n]+/g, ' ')).join('\t'))
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    setTimeout(() => setCopyState('idle'), 2500);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {toolbar}
        <div className="flex items-center gap-3">
          {copyState === 'failed' && (
            <span className="text-sm text-red-600">The table couldn&apos;t be copied. Select it with your mouse and press Ctrl+C.</span>
          )}
          <button
            onClick={copyTable}
            className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {copyState === 'copied' ? <Check size={17} className="text-green-600" /> : <Copy size={17} />}
            {copyState === 'copied' ? 'Copied' : 'Copy Table'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-gray-600">
            <tr>
              {HEADINGS.map(h => <th key={h} className="px-4 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-800">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                {row.map((cell, j) => (
                  <td key={j} className={`px-4 py-2 ${j >= 2 && j <= 4 ? 'whitespace-nowrap tabular-nums' : ''}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
