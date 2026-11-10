'use client';
import { useRef, useState } from 'react';
import { ScheduleEntry, Timeslot, Court, Trainer, Group } from '@/lib/types';

const GENDER_COLORS: Record<string, string> = {
  female: 'bg-orange-100 text-orange-800 border-orange-200',
  male:   'bg-sky-100 text-sky-800 border-sky-200',
};

interface Props {
  timeslots: Timeslot[];
  courts: Court[];
  result: ScheduleEntry[];
  groups?: Group[];
  inProgress?: boolean;
  gapPercent?: number | null;
  // Edit mode
  editMode?: boolean;
  editableSchedule?: ScheduleEntry[];
  trainers?: Trainer[];
  onScheduleChange?: (next: ScheduleEntry[]) => void;
}

export default function ScheduleGrid({
  timeslots, courts, result, groups, inProgress, gapPercent,
  editMode, editableSchedule, trainers, onScheduleChange,
}: Props) {
  const displayed = editMode && editableSchedule ? editableSchedule : result;

  const genderByGroup = new Map(groups?.map(g => [g.name, g.gender]) ?? []);
  const colorOf = (groupName: string) =>
    GENDER_COLORS[genderByGroup.get(groupName) ?? ''] ?? 'bg-gray-100 text-gray-700 border-gray-200';

  // lookup[timeslotId][courtName] = entry
  const lookup = new Map<number, Map<string, ScheduleEntry>>();
  for (const entry of displayed) {
    if (!lookup.has(entry.timeslot)) lookup.set(entry.timeslot, new Map());
    lookup.get(entry.timeslot)!.set(entry.court, entry);
  }

  const indexed = timeslots.map((slot, idx) => ({ slot, idx }));
  const days    = [...new Set(timeslots.map(t => t.day))];

  // Which cell is currently being dragged over (for visual feedback)
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragKey = useRef<{ timeslot: number; court: string } | null>(null);

  function cellKey(timeslot: number, court: string) { return `${timeslot}::${court}`; }

  function handleDragStart(timeslot: number, court: string) {
    dragKey.current = { timeslot, court };
  }

  function handleDragEnd() {
    dragKey.current = null;
    setDropTarget(null);
  }

  function handleDrop(toTimeslot: number, toCourt: string) {
    setDropTarget(null);
    if (!dragKey.current || !editableSchedule || !onScheduleChange) return;
    const { timeslot: fromTs, court: fromCourt } = dragKey.current;
    if (fromTs === toTimeslot && fromCourt === toCourt) return;

    const fromEntry = lookup.get(fromTs)?.get(fromCourt);
    if (!fromEntry) return;
    const toEntry = lookup.get(toTimeslot)?.get(toCourt);

    onScheduleChange(editableSchedule.map(e => {
      if (e.timeslot === fromTs && e.court === fromCourt)
        return { ...e, timeslot: toTimeslot, court: toCourt };
      if (toEntry && e.timeslot === toTimeslot && e.court === toCourt)
        return { ...e, timeslot: fromTs, court: fromCourt };
      return e;
    }));
  }

  function handleTrainerChange(timeslot: number, court: string, newTrainer: string) {
    if (!editableSchedule || !onScheduleChange) return;
    onScheduleChange(editableSchedule.map(e =>
      e.timeslot === timeslot && e.court === court ? { ...e, trainer: newTrainer } : e
    ));
  }

  return (
    <div>
      {inProgress && (
        <div className="mb-4 flex items-center gap-2 text-base text-amber-600">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" />
          Showing latest intermediate solution — still solving…
          {gapPercent != null && ` (${gapPercent.toFixed(1)}% from optimal)`}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full border-collapse text-base">
          <thead>
            <tr className="bg-gray-50">
              <th colSpan={2} className="border-b border-gray-200 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap">
                Timeslot
              </th>
              {courts.map((c, i) => (
                <th key={c.courtName} className="border-b border-l border-gray-200 px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide text-gray-500">
                  Court {i + 1}
                  {c.location && <span className="ml-1.5 font-normal normal-case text-gray-400">· {c.location}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map(day => {
              const daySlots = indexed.filter(({ slot }) => slot.day === day);
              return daySlots.map(({ slot, idx }, slotIdx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  {slotIdx === 0 && (
                    <td rowSpan={daySlots.length} className="border-b border-r border-gray-200 bg-gray-50 px-4 py-3 align-top">
                      <div className="text-sm font-semibold text-gray-700">{day}</div>
                    </td>
                  )}
                  <td className="border-b border-gray-100 px-4 py-2 whitespace-nowrap text-sm text-gray-500">
                    {slot.start}–{slot.finish}
                  </td>
                  {courts.map(court => {
                    const entry  = lookup.get(idx)?.get(court.courtName);
                    const color  = entry ? colorOf(entry.group) : '';
                    const isOver = dropTarget === cellKey(idx, court.courtName);
                    return (
                      <td key={court.courtName} className="border-b border-l border-gray-100 px-2.5 py-2">
                        {/* Drop zone wrapper covers the full cell area */}
                        <div
                          className={`min-h-[3rem] rounded transition-colors ${editMode ? 'select-none' : ''} ${isOver ? 'bg-blue-50 ring-2 ring-blue-300 ring-inset rounded' : ''}`}
                          onDragOver={editMode ? e => { e.preventDefault(); setDropTarget(cellKey(idx, court.courtName)); } : undefined}
                          onDragLeave={editMode ? () => setDropTarget(null) : undefined}
                          onDrop={editMode ? e => { e.preventDefault(); handleDrop(idx, court.courtName); } : undefined}
                        >
                          {entry ? (
                            <div
                              className={`rounded border px-2.5 py-1.5 ${color} ${editMode ? 'cursor-grab active:cursor-grabbing shadow-sm' : ''}`}
                              draggable={editMode}
                              onDragStart={editMode ? e => { e.stopPropagation(); handleDragStart(idx, court.courtName); } : undefined}
                              onDragEnd={editMode ? handleDragEnd : undefined}
                            >
                              <div className="font-medium leading-tight">{entry.group}</div>
                              {editMode && trainers ? (
                                <select
                                  className="mt-1 w-full cursor-pointer rounded border-0 bg-transparent text-sm opacity-80 focus:outline-none focus:ring-1 focus:ring-current"
                                  value={entry.trainer}
                                  onChange={e => handleTrainerChange(idx, court.courtName, e.target.value)}
                                  onClick={e => e.stopPropagation()}
                                  onDragStart={e => e.stopPropagation()}
                                >
                                  {trainers.map(t => (
                                    <option key={t.name} value={t.name}>{t.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <div className="text-sm opacity-70">{entry.trainer}</div>
                              )}
                            </div>
                          ) : (
                            <div className={`h-12 rounded border border-dashed ${isOver ? 'border-blue-400' : 'border-gray-200'}`} />
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
