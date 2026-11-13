'use client';
import { useEffect, useRef, useState } from 'react';
import { ScheduleEntry, Space, Trainer, Group, Timeslot, slotRunsOn, sortDays, toMinutes } from '@/lib/types';

// Calendar scale: pixels per minute of the day (a 90-minute session is 108px tall).
const PX_PER_MINUTE = 1.2;
// Calendar layout: space columns are at least this wide, beside a time axis this wide.
const MIN_COLUMN_WIDTH = 110;
const AXIS_WIDTH = 56;

function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const GENDER_COLORS: Record<string, string> = {
  female: 'bg-orange-100 text-orange-800 border-orange-200',
  male:   'bg-sky-100 text-sky-800 border-sky-200',
};

interface Props {
  timeslots: Timeslot[];
  spaces: Space[];
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
  timeslots, spaces, result, groups, inProgress, gapPercent,
  editMode, editableSchedule, trainers, onScheduleChange,
}: Props) {
  const displayed = editMode && editableSchedule ? editableSchedule : result;

  const genderByGroup = new Map(groups?.map(g => [g.name, g.gender]) ?? []);
  const colorOf = (groupName: string) =>
    // Without gender colours (groups not gendered), every session uses the blue.
    GENDER_COLORS[genderByGroup.get(groupName) ?? ''] ?? GENDER_COLORS.male;

  // lookup[timeslotId][spaceName] = entry
  const lookup = new Map<number, Map<string, ScheduleEntry>>();
  for (const entry of displayed) {
    if (!lookup.has(entry.timeslot)) lookup.set(entry.timeslot, new Map());
    lookup.get(entry.timeslot)!.set(entry.space, entry);
  }

  const days = sortDays([...new Set(timeslots.map(t => t.day))]);
  // Location order, for timeslots limited by location (the spaces list them in order).
  const locationNames = [...new Set(spaces.map(c => c.location))];

  // Which cell is currently being dragged over (for visual feedback)
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragKey = useRef<{ timeslot: number; space: string } | null>(null);

  function cellKey(timeslot: number, space: string) { return `${timeslot}::${space}`; }

  function handleDragStart(timeslot: number, space: string) {
    dragKey.current = { timeslot, space };
  }

  function handleDragEnd() {
    dragKey.current = null;
    setDropTarget(null);
  }

  function handleDrop(toTimeslot: number, toSpace: string) {
    setDropTarget(null);
    if (!dragKey.current || !editableSchedule || !onScheduleChange) return;
    const { timeslot: fromTs, space: fromSpace } = dragKey.current;
    if (fromTs === toTimeslot && fromSpace === toSpace) return;

    const fromEntry = lookup.get(fromTs)?.get(fromSpace);
    if (!fromEntry) return;
    const toEntry = lookup.get(toTimeslot)?.get(toSpace);

    onScheduleChange(editableSchedule.map(e => {
      if (e.timeslot === fromTs && e.space === fromSpace)
        return { ...e, timeslot: toTimeslot, space: toSpace };
      if (toEntry && e.timeslot === toTimeslot && e.space === toSpace)
        return { ...e, timeslot: fromTs, space: fromSpace };
      return e;
    }));
  }

  function handleTrainerChange(timeslot: number, space: string, newTrainer: string) {
    if (!editableSchedule || !onScheduleChange) return;
    onScheduleChange(editableSchedule.map(e =>
      e.timeslot === timeslot && e.space === space ? { ...e, trainer: newTrainer } : e
    ));
  }

  const calendarRef = useRef<HTMLDivElement>(null);
  const [calendarWidth, setCalendarWidth] = useState(0);
  useEffect(() => {
    const el = calendarRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setCalendarWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A day's slots in start-time order, with their index in `timeslots`.
  const slotsOn = (day: string) => timeslots
    .map((slot, idx) => ({ slot, idx }))
    .filter(({ slot }) => slot.day === day)
    .sort((a, b) => toMinutes(a.slot.start) - toMinutes(b.slot.start));

  // Makes an element the drop target for (slot, space) in edit mode.
  function dropTargetProps(idx: number, spaceName: string) {
    if (!editMode) return {};
    return {
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDropTarget(cellKey(idx, spaceName)); },
      onDragLeave: () => setDropTarget(null),
      onDrop: (e: React.DragEvent) => { e.preventDefault(); handleDrop(idx, spaceName); },
    };
  }

  // A scheduled session (shared by both views): group, its times in the calendar, and the
  // trainer (a dropdown in edit mode). Draggable in edit mode.
  function sessionBlock(entry: ScheduleEntry, idx: number, spaceName: string, times?: string) {
    return (
      <div
        className={`h-full overflow-hidden rounded border px-2 py-1 ${colorOf(entry.group)} ${
          editMode ? 'cursor-grab active:cursor-grabbing shadow-sm' : ''
        }`}
        draggable={editMode}
        onDragStart={editMode ? e => { e.stopPropagation(); handleDragStart(idx, spaceName); } : undefined}
        onDragEnd={editMode ? handleDragEnd : undefined}
      >
        <div className="truncate text-sm font-medium leading-tight">{entry.group}</div>
        {times && <div className="text-xs tabular-nums opacity-60">{times}</div>}
        {editMode && trainers ? (
          <select
            className="mt-0.5 w-full cursor-pointer rounded border-0 bg-transparent text-sm opacity-80 focus:outline-none focus:ring-1 focus:ring-current"
            value={entry.trainer}
            onChange={e => handleTrainerChange(idx, spaceName, e.target.value)}
            onClick={e => e.stopPropagation()}
            onDragStart={e => e.stopPropagation()}
          >
            {trainers.map(t => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        ) : (
          <div className="truncate text-sm opacity-70">{entry.trainer}</div>
        )}
      </div>
    );
  }

  const emptySlot = (isOver: boolean) => (
    <div className={`h-full rounded border border-dashed ${isOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200'}`} />
  );

  // Week-view layout: as many whole days side by side as fit (each space column at
  // least MIN_COLUMN_WIDTH), spread evenly over rows. Every day panel has the same
  // width and the same time range, so the panels line up in a grid; a single day too
  // wide for the screen scrolls sideways.
  const dayWidthAtMin = spaces.length * MIN_COLUMN_WIDTH + 2;   // + the day divider
  const fitPerRow = Math.max(1, Math.floor((calendarWidth - AXIS_WIDTH - 2) / dayWidthAtMin));
  const rowCount  = Math.ceil(days.length / Math.min(fitPerRow, Math.max(1, days.length)));
  const perRow    = Math.ceil(days.length / rowCount);
  const rows = Array.from({ length: rowCount }, (_, r) => days.slice(r * perRow, (r + 1) * perRow));
  const columnWidth = Math.max(
    MIN_COLUMN_WIDTH,
    Math.floor((calendarWidth - AXIS_WIDTH - 2 - perRow * 2) / (perRow * spaces.length)),
  );

  // (No timeslots means no schedule is shown, but keep the range valid regardless.)
  const allStarts   = timeslots.length > 0 ? timeslots.map(t => toMinutes(t.start)) : [0];
  const allFinishes = timeslots.length > 0 ? timeslots.map(t => toMinutes(t.finish)) : [0];
  const rangeStart = Math.floor(Math.min(...allStarts) / 30) * 30;
  const rangeEnd   = Math.ceil(Math.max(...allFinishes) / 30) * 30;
  const height     = (rangeEnd - rangeStart) * PX_PER_MINUTE;
  const halfHours  = Array.from({ length: (rangeEnd - rangeStart) / 30 + 1 }, (_, i) => rangeStart + i * 30);
  const top = (minutes: number) => (minutes - rangeStart) * PX_PER_MINUTE;

  return (
    <div>
      {inProgress && (
        <div className="mb-4 flex items-center gap-2 text-base text-amber-600">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400" />
          Still running. This is the best schedule so far
          {gapPercent != null && ` (within ${gapPercent.toFixed(1)}% of the best possible score)`}.
        </div>
      )}

      <div ref={calendarRef} className="flex flex-col gap-6">
        {rows.map(rowDays => (
          <div key={rowDays.join()} className="max-w-full self-start overflow-x-auto overflow-y-hidden rounded-lg border border-gray-200 bg-white">
            <div className="flex">
              {/* Time axis, shared by the row's days */}
              <div className="shrink-0" style={{ width: AXIS_WIDTH }}>
                <div className="h-8 border-b border-transparent" />
                <div className="h-10 border-b border-gray-200" />
                <div className="relative my-3" style={{ height }}>
                  {halfHours.map(m => (
                    <div
                      key={m}
                      className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-gray-400"
                      style={{ top: top(m) }}
                    >
                      {m % 60 === 0 ? formatTime(m) : ''}
                    </div>
                  ))}
                </div>
              </div>

              {rowDays.map(day => {
                const daySlots = slotsOn(day);
                return (
                  <div key={day} className="shrink-0 border-l-2 border-gray-200">
                    <div className="flex h-8 items-center border-b border-gray-200 bg-gray-50 px-3 text-sm font-semibold text-gray-700">
                      {day}
                    </div>
                    <div className="flex">
                      {spaces.map(space => (
                        <div key={space.spaceName} className="shrink-0 border-l border-gray-100 first:border-l-0" style={{ width: columnWidth }}>
                          <div className="flex h-10 flex-col justify-center border-b border-gray-200 px-2 leading-tight">
                            <span className="truncate text-sm font-semibold text-gray-600">{space.label}</span>
                            {space.location && <span className="truncate text-xs text-gray-400">{space.location}</span>}
                          </div>
                          <div className="relative my-3" style={{ height }}>
                            {/* Half-hour gridlines */}
                            {halfHours.map(m => (
                              <div
                                key={m}
                                className={`absolute inset-x-0 border-t ${m % 60 === 0 ? 'border-gray-200' : 'border-dashed border-gray-100'}`}
                                style={{ top: top(m) }}
                              />
                            ))}

                            {daySlots.filter(({ slot }) => slotRunsOn(slot, space, locationNames)).map(({ slot, idx }) => {
                              const entry  = lookup.get(idx)?.get(space.spaceName);
                              const isOver = dropTarget === cellKey(idx, space.spaceName);
                              const start  = toMinutes(slot.start);
                              const length = toMinutes(slot.finish) - start;
                              return (
                                <div
                                  key={idx}
                                  className={`absolute inset-x-1 rounded ${entry ? 'z-10' : ''} ${editMode ? 'select-none' : ''} ${
                                    isOver ? 'ring-2 ring-blue-300' : ''
                                  }`}
                                  style={{ top: top(start) + 1, height: length * PX_PER_MINUTE - 2 }}
                                  {...dropTargetProps(idx, space.spaceName)}
                                >
                                  {entry
                                    ? sessionBlock(entry, idx, space.spaceName, `${slot.start}-${slot.finish}`)
                                    : emptySlot(isOver)}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
