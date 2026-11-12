'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import EditableTable, { Column } from '@/components/EditableTable';
import { useSchedule } from '@/components/ScheduleProvider';
import { courtsNamed, levelsInUse, timeslotClashes } from '@/lib/settings';
import { Court, Location, ScheduleData, TravelTime, expandLocations, sortDays, toMinutes } from '@/lib/types';

type Tab = 'locations' | 'timeslots' | 'groups' | 'trainers';

const TABS: { id: Tab; label: string }[] = [
  { id: 'locations', label: 'Locations' },
  { id: 'timeslots', label: 'Timeslots' },
  { id: 'groups',    label: 'Groups' },
  { id: 'trainers',  label: 'Trainers' },
];

const BASE_COLUMNS: Record<Tab, Column[]> = {
  locations: [
    { key: 'name',   header: 'Location Name', placeholder: 'Location' },
    { key: 'courts', header: 'Courts', type: 'number', placeholder: '1', width: '80px' },
  ],
  timeslots: [
    { key: 'day',    header: 'Day',    placeholder: 'Monday' },
    { key: 'start',  header: 'Start',  placeholder: '09:00' },
    { key: 'finish', header: 'Finish', placeholder: '10:00' },
  ],
  groups: [
    { key: 'name',   header: 'Name',   placeholder: 'Beginners', width: '200px' },
    { key: 'level',  header: 'Level',  type: 'number', placeholder: '1', width: '70px' },
    { key: 'gender', header: 'Gender', type: 'select', options: ['female', 'male'], width: '120px' },
  ],
  trainers: [
    { key: 'name',       header: 'Name',         placeholder: 'Alice Coach', width: '200px' },
    { key: 'capacity',   header: 'Capacity',      type: 'number', placeholder: '1', width: '70px' },
  ],
};

// Trainer level columns: one per gender, or a single Level (stored as the female
// level) when teams aren't gendered. Hidden when trainers are assigned to groups.
const GENDERED_LEVEL_COLUMNS: Column[] = [
  { key: 'ladiesRank', header: 'Female Level', type: 'number', placeholder: '0', width: '90px' },
  { key: 'gentsRank',  header: 'Male Level',   type: 'number', placeholder: '0', width: '90px' },
];
const SINGLE_LEVEL_COLUMN: Column = { key: 'ladiesRank', header: 'Level', type: 'number', placeholder: '0', width: '90px' };

type RowMap = Record<Tab, Record<string, string>[]>;

// Parse a bitmask typed or pasted as "1,0,1", "1 0 1" or "101".
function parseBitmask(s: string): number[] {
  if (!s.trim()) return [];
  if (s.includes(',')) return s.split(',').map(v => (parseInt(v.trim(), 10) || 0));
  if (s.includes(' ')) return s.split(/\s+/).map(v => (parseInt(v, 10) || 0));
  return s.split('').map(v => (parseInt(v, 10) || 0));
}

// Training Groups and timeslot Courts are stored in a row as a JSON list of names
// ('' = an empty Training Group slot).
function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function capacityOf(row: Record<string, string>): number {
  return Math.max(1, parseInt(row.capacity, 10) || 1);
}

function toGender(v: string): 'female' | 'male' {
  return (v ?? '').trim().toLowerCase() === 'male' ? 'male' : 'female';
}

function dataToRows(data: ScheduleData): RowMap {
  return {
    locations: (data.locations ?? []).map(l => ({
      name: l.name, courts: String(l.courts),
      courtNames: JSON.stringify(l.courtNames ?? []),
    })),
    timeslots: data.timeslots.map(t => ({
      day: t.day, start: t.start, finish: t.finish,
      location_bitmask: t.location_bitmask?.join(',') ?? '',
      courts: JSON.stringify(t.courts ?? []),
    })),
    groups: data.groups.map(g => ({
      name: g.name, level: String(g.level),
      gender: toGender(g.gender),
      availability_bitmask: g.availability_bitmask.join(','),
      location_bitmask: g.location_bitmask?.join(',') ?? '',
    })),
    trainers: data.trainers.map(t => ({
      name: t.name, groupID: t.groupID,
      ladiesRank: String(t.ladiesRank), gentsRank: String(t.gentsRank),
      capacity: String(t.capacity ?? 1),
      trainingGroups: JSON.stringify(t.trainingGroups ?? []),
      availability_bitmask: t.availability_bitmask.join(','),
    })),
  };
}

// Locations from the Locations tab rows. Court names are kept by position (blank = unnamed).
function rowsToLocations(locationRows: Record<string, string>[]): Location[] {
  return locationRows.filter(r => r.name).map(r => {
    const courts = Math.max(1, parseInt(r.courts, 10) || 1);
    const courtNames = parseList(r.courtNames).slice(0, courts);
    return { name: r.name, courts, courtNames: courtNames.some(n => n.trim()) ? courtNames : undefined };
  });
}

// The court identities ("<location> <name or number>") of one Locations tab row.
function courtIdsOf(locationRow: Record<string, string>): string[] {
  return expandLocations(rowsToLocations([locationRow])).map(c => c.courtName);
}

function rowsToData(rows: RowMap): Omit<ScheduleData, 'travelTimes'> {
  const numSlots = rows.timeslots.filter(r => r.day).length;
  const numLocs  = rows.locations.filter(r => r.name).length;

  const defaultBitmask = (raw: string, count: number) => {
    const bits = parseBitmask(raw ?? '');
    return bits.length > 0 ? bits : Array(count).fill(1);
  };

  const parseLocBitmask = (raw: string) => {
    if (numLocs <= 1) return undefined;
    const bits = parseBitmask(raw ?? '');
    return bits.length > 0 ? bits : Array(numLocs).fill(1);
  };

  const locations = rowsToLocations(rows.locations);
  // Court names that no longer exist (e.g. after renaming a location) are dropped, so a
  // timeslot never silently runs on no court at all.
  const courtNames = new Set(expandLocations(locations).map(c => c.courtName));

  return {
    locations,
    timeslots: rows.timeslots.filter(r => r.day).map(r => ({
      day: r.day, start: r.start, finish: r.finish,
      location_bitmask: parseLocBitmask(r.location_bitmask),
      courts: parseList(r.courts).filter(name => courtNames.has(name)),
    })),
    groups: rows.groups.filter(r => r.name).map(r => ({
      name: r.name, level: parseInt(r.level, 10) || 1,
      gender: toGender(r.gender),
      availability_bitmask: defaultBitmask(r.availability_bitmask, numSlots),
      location_bitmask: parseLocBitmask(r.location_bitmask),
    })),
    trainers: rows.trainers.filter(r => r.name).map(r => ({
      name: r.name, groupID: r.groupID ?? '',
      ladiesRank: parseInt(r.ladiesRank, 10) || 0,
      gentsRank: parseInt(r.gentsRank, 10) || 0,
      capacity: capacityOf(r),
      // Only the slots shown (one per unit of capacity) count.
      trainingGroups: parseList(r.trainingGroups).slice(0, capacityOf(r)).filter(Boolean),
      availability_bitmask: defaultBitmask(r.availability_bitmask, numSlots),
    })),
  };
}

const EMPTY_ROW: Record<Tab, () => Record<string, string>> = {
  locations: () => ({ name: '', courts: '1', courtNames: '[]' }),
  timeslots: () => ({ day: '', start: '', finish: '', location_bitmask: '', courts: '[]' }),
  groups:    () => ({ name: '', level: '', gender: 'female', availability_bitmask: '', location_bitmask: '' }),
  trainers:  () => ({ name: '', groupID: '', ladiesRank: '', gentsRank: '', capacity: '1', trainingGroups: '[]', availability_bitmask: '' }),
};

// One dropdown per unit of the trainer's capacity. Each lists only groups no other
// trainer coaches, that this trainer hasn't already picked in another slot, and that
// isn't their own Player Group (nobody coaches a group they play in).
function TrainingGroupsCell({
  value, onChange, capacity, groupNames, playerGroup, isTakenElsewhere,
}: {
  value: string;
  onChange: (v: string) => void;
  capacity: number;
  groupNames: string[];
  playerGroup: string;
  isTakenElsewhere: (name: string) => boolean;
}) {
  const slots = parseList(value).slice(0, capacity);
  while (slots.length < capacity) slots.push('');

  function setSlot(i: number, name: string) {
    const next = [...slots];
    next[i] = name;
    onChange(JSON.stringify(next));
  }

  return (
    <div className="flex flex-col gap-1 py-1">
      {slots.map((current, i) => (
        <select
          key={i}
          value={current}
          onChange={e => setSlot(i, e.target.value)}
          className="w-full rounded border border-gray-200 bg-transparent px-1.5 py-1 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">None</option>
          {groupNames
            .filter(name => name === current || (name !== playerGroup && !isTakenElsewhere(name) && !slots.includes(name)))
            .map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      ))}
    </div>
  );
}

// A clickable on/off chip: filled blue when selected, grey outline when not.
function Chip({
  selected, onClick, disabled, title, children,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-full border px-2 py-0.5 text-xs tabular-nums transition-colors disabled:cursor-not-allowed ${
        selected
          ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700 disabled:hover:bg-blue-600'
          : 'border-gray-300 bg-white text-gray-400 hover:border-gray-400'
      }`}
    >
      {children}
    </button>
  );
}

// Availability per timeslot: one line per day, with that day's slots in start-time order
// as toggle chips showing their full times. Click a time to toggle it, or the day to toggle
// the whole day. `shown` limits which timeslots appear (e.g. a group sees only those at its
// locations); hidden ones keep their stored availability.
function AvailabilityCell({
  value, onChange, timeslots, shown,
}: {
  value: string;
  onChange: (v: string) => void;
  timeslots: { day: string; start: string; finish: string }[];
  shown?: boolean[];
}) {
  if (timeslots.length === 0) {
    return <span className="text-sm italic text-gray-400">Define timeslots first</span>;
  }
  const visible = timeslots.map((_, i) => i).filter(i => shown?.[i] ?? true);
  if (visible.length === 0) {
    return <span className="text-sm italic text-gray-400">No timeslots at the selected locations</span>;
  }
  const arr  = parseBitmask(value);
  const bits = timeslots.map((_, i) => (arr[i] ?? 1) === 1);

  function setAvailable(indices: number[], available: boolean) {
    const next = bits.map(b => (b ? 1 : 0));
    for (const i of indices) next[i] = available ? 1 : 0;
    onChange(next.join(','));
  }

  const days = sortDays([...new Set(visible.map(i => timeslots[i].day))]);

  return (
    <div className="flex flex-col gap-1 py-1.5">
      {days.map(day => {
        const daySlots = visible
          .filter(i => timeslots[i].day === day)
          .sort((a, b) => toMinutes(timeslots[a].start) - toMinutes(timeslots[b].start));
        const allAvailable = daySlots.every(i => bits[i]);
        return (
          <div key={day} className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAvailable(daySlots, !allAvailable)}
              title={allAvailable ? `Make all of ${day} unavailable` : `Make all of ${day} available`}
              className="w-10 shrink-0 text-left text-xs font-semibold text-gray-600 hover:text-blue-700"
            >
              {day.slice(0, 3)}
            </button>
            {daySlots.map(i => (
              <Chip key={i} selected={bits[i]} onClick={() => setAvailable([i], !bits[i])}>
                {timeslots[i].start}–{timeslots[i].finish}
              </Chip>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// One name box per court (Name Courts). Names must be unique within the location, and
// with court-specific timeslots every court needs one; problems are highlighted.
function CourtNamesCell({
  value, onChange, count, required,
}: {
  value: string;
  onChange: (v: string) => void;
  count: number;
  required: boolean;
}) {
  const names = parseList(value).slice(0, count);
  while (names.length < count) names.push('');

  const isProblem = (name: string) =>
    name.trim() ? names.filter(n => n.trim() === name.trim()).length > 1 : required;

  function setName(i: number, name: string) {
    const next = [...names];
    next[i] = name;
    onChange(JSON.stringify(next));
  }

  return (
    <div className="flex flex-wrap gap-1.5 py-1">
      {names.map((name, i) => (
        <input
          key={i}
          value={name}
          placeholder={`Court ${i + 1}`}
          onChange={e => setName(i, e.target.value)}
          className={`w-32 rounded border px-1.5 py-1 text-base text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            isProblem(name) ? 'border-red-300 bg-red-50' : 'border-gray-200'
          }`}
        />
      ))}
    </div>
  );
}

// Court-specific timeslots: which courts a timeslot runs on, grouped by location.
// An empty list means every court; at least one court always stays ticked.
function CourtsCell({
  value, onChange, courtsByLocation,
}: {
  value: string;
  onChange: (v: string) => void;
  courtsByLocation: { location: string; courts: Court[] }[];
}) {
  const allCourts = courtsByLocation.flatMap(l => l.courts.map(c => c.courtName));
  if (allCourts.length === 0) {
    return <span className="text-sm italic text-gray-400">Define locations first</span>;
  }
  const stored = parseList(value).filter(name => allCourts.includes(name));
  const ticked = new Set(stored.length > 0 ? stored : allCourts);

  function toggle(name: string, checked: boolean) {
    const next = allCourts.filter(c => (c === name ? checked : ticked.has(c)));
    onChange(JSON.stringify(next.length === allCourts.length ? [] : next));
  }

  return (
    <div className="flex flex-col gap-1.5 py-1.5">
      {courtsByLocation.map(({ location, courts }) => (
        <div key={location} className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 shrink-0 truncate text-xs font-semibold text-gray-600" title={location}>{location}</span>
          {courts.map(({ courtName, label }) => {
            const isLast = ticked.has(courtName) && ticked.size === 1;
            return (
              <Chip
                key={courtName}
                selected={ticked.has(courtName)}
                disabled={isLast}
                title={isLast ? 'At least one court must stay selected' : undefined}
                onClick={() => toggle(courtName, !ticked.has(courtName))}
              >
                {label}
              </Chip>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function LocationCell({
  value, onChange, locationNames,
}: {
  value: string;
  onChange: (v: string) => void;
  locationNames: string[];
}) {
  if (locationNames.length === 0) {
    return <span className="text-sm italic text-gray-400">Define locations first</span>;
  }
  if (locationNames.length === 1) {
    return <span className="text-sm italic text-gray-400">{locationNames[0]}</span>;
  }
  const arr  = parseBitmask(value);
  const bits = locationNames.map((_, i) => (arr[i] ?? 1) === 1);

  function toggle(i: number) {
    const next = bits.map(b => (b ? 1 : 0));
    next[i] = bits[i] ? 0 : 1;
    onChange(next.join(','));
  }

  return (
    <div className="flex flex-wrap gap-1.5 py-1.5">
      {locationNames.map((name, i) => (
        <Chip key={i} selected={bits[i]} onClick={() => toggle(i)}>{name}</Chip>
      ))}
    </div>
  );
}

function TravelTimesSection({
  locationNames,
  travelTimes,
  onChange,
}: {
  locationNames: string[];
  travelTimes: TravelTime[];
  onChange: (tt: TravelTime[]) => void;
}) {
  const pairs = useMemo(() => {
    const names = locationNames.filter(Boolean);
    const result: [string, string][] = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        result.push([names[i], names[j]]);
      }
    }
    return result;
  }, [locationNames]);

  if (pairs.length === 0) return null;

  function getMinutes(from: string, to: string): string {
    const found = travelTimes.find(
      tt => (tt.from === from && tt.to === to) || (tt.from === to && tt.to === from)
    );
    return found ? String(found.minutes) : '';
  }

  function setMinutes(from: string, to: string, raw: string) {
    const minutes = parseInt(raw, 10);
    const updated = travelTimes.filter(
      tt => !((tt.from === from && tt.to === to) || (tt.from === to && tt.to === from))
    );
    if (!isNaN(minutes) && minutes > 0) updated.push({ from, to, minutes });
    onChange(updated);
  }

  return (
    <div className="mt-10">
      <h2 className="text-base font-semibold text-gray-700 mb-1">Travel Times</h2>
      <p className="text-sm text-gray-400 mb-5">
        Minutes required to travel between venues. The scheduler will enforce these as hard constraints and reward trainers who stay at one venue.
      </p>
      <div className="space-y-3">
        {pairs.map(([from, to]) => (
          <div key={`${from}__${to}`} className="flex items-center gap-4">
            <span className="text-sm text-gray-700 w-52">
              {from} <span className="text-gray-400 mx-1">↔</span> {to}
            </span>
            <input
              type="number"
              min="1"
              value={getMinutes(from, to)}
              onChange={e => setMinutes(from, to, e.target.value)}
              placeholder="—"
              className="w-20 rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-400">min</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const INIT_ROWS = (): RowMap => ({
  locations: [EMPTY_ROW.locations()],
  timeslots: [EMPTY_ROW.timeslots()],
  groups:    [EMPTY_ROW.groups()],
  trainers:  [EMPTY_ROW.trainers()],
});

// The table rows for a schedule's stored data, keeping the empty starting row for
// any tab that has no data yet (e.g. a new schedule).
function initialRows(data: ScheduleData | null): RowMap {
  const empty = INIT_ROWS();
  if (!data) return empty;
  const loaded = dataToRows(data);
  return {
    locations: loaded.locations.length ? loaded.locations : empty.locations,
    timeslots: loaded.timeslots.length ? loaded.timeslots : empty.timeslots,
    groups:    loaded.groups.length    ? loaded.groups    : empty.groups,
    trainers:  loaded.trainers.length  ? loaded.trainers  : empty.trainers,
  };
}

export default function DataPage() {
  const { data, setData, settings } = useSchedule();
  // The rows are kept here (they hold half-typed values); every edit is passed up to
  // the open schedule as data, which the header's Save writes to the file.
  const [initial] = useState(() => ({ rows: initialRows(data), travelTimes: data?.travelTimes ?? [] }));
  const [tab, setTab]                 = useState<Tab>('locations');
  const [rows, setRows]               = useState<RowMap>(initial.rows);
  const [travelTimes, setTravelTimes] = useState<TravelTime[]>(initial.travelTimes);

  useEffect(() => {
    // Untouched since the page opened: nothing to pass up (avoids marking it modified).
    if (rows === initial.rows && travelTimes === initial.travelTimes) return;
    setData({ ...rowsToData(rows), travelTimes });
  }, [rows, travelTimes, initial, setData]);

  const timeslotList = useMemo(
    () => rows.timeslots.filter(r => r.day).map(r => ({ day: r.day, start: r.start, finish: r.finish })),
    [rows.timeslots],
  );

  const groupNames = useMemo(
    () => rows.groups.map(r => r.name).filter(Boolean),
    [rows.groups],
  );

  const locationNames = useMemo(
    () => rows.locations.map(r => r.name).filter(Boolean),
    [rows.locations],
  );

  const availabilityColumn: Column = useMemo(() => ({
    key: 'availability_bitmask',
    header: 'Availability',
    render: (value, onChange) => (
      <AvailabilityCell value={value} onChange={onChange} timeslots={timeslotList} />
    ),
    parsePaste: (values) => {
      const count = timeslotList.length || values.length;
      const bits  = values.slice(0, count).map(v => {
        const n = v.trim().toUpperCase();
        return n === 'TRUE' || n === '1' ? 1 : 0;
      });
      while (bits.length < count) bits.push(1);
      return { value: bits.join(','), consumed: Math.min(count, values.length) };
    },
  }), [timeslotList]);

  const courtsByLocation = useMemo(
    () => rowsToLocations(rows.locations).map(loc => ({ location: loc.name, courts: expandLocations([loc]) })),
    [rows.locations],
  );

  // The locations each timeslot runs at: those ticked for it (by location, or with
  // court-specific timeslots, by having one of its courts ticked); all when none are.
  const timeslotLocations = useMemo(
    () => rows.timeslots.filter(r => r.day).map(r => {
      if (settings.courtTimeslots) {
        const courts = new Set(parseList(r.courts));
        const at = courtsByLocation.filter(l => l.courts.some(c => courts.has(c.courtName))).map(l => l.location);
        return at.length > 0 ? at : locationNames;
      }
      const bits = parseBitmask(r.location_bitmask ?? '');
      return locationNames.filter((_, i) => (bits[i] ?? 1) === 1);
    }),
    [rows.timeslots, settings.courtTimeslots, courtsByLocation, locationNames],
  );

  // Groups only see the timeslots that run at one of their selected locations.
  const groupAvailabilityColumn: Column = useMemo(() => ({
    ...availabilityColumn,
    render: (value, onChange, row) => {
      const bits = parseBitmask(row.location_bitmask ?? '');
      const groupLocations = locationNames.filter((_, i) => (bits[i] ?? 1) === 1);
      return (
        <AvailabilityCell
          value={value}
          onChange={onChange}
          timeslots={timeslotList}
          shown={timeslotLocations.map(at => at.some(l => groupLocations.includes(l)))}
        />
      );
    },
  }), [availabilityColumn, locationNames, timeslotList, timeslotLocations]);

  const courtNamesColumn: Column = useMemo(() => ({
    key: 'courtNames',
    header: 'Court Names',
    render: (value, onChange, row) => (
      <CourtNamesCell
        value={value}
        onChange={onChange}
        count={Math.max(1, parseInt(row.courts, 10) || 1)}
        required={settings.courtTimeslots}
      />
    ),
    // Pasted as court names separated by commas, in court order.
    parsePaste: (values) => ({
      value: JSON.stringify((values[0] ?? '').split(',').map(n => n.trim())),
      consumed: 1,
    }),
  }), [settings.courtTimeslots]);

  const courtsColumn: Column = useMemo(() => ({
    key: 'courts',
    header: 'Courts',
    render: (value, onChange) => (
      <CourtsCell value={value} onChange={onChange} courtsByLocation={courtsByLocation} />
    ),
    // Pasted as location + court name, separated by commas, e.g. "Club A Show Court, Club A 2".
    parsePaste: (values) => {
      const all = courtsByLocation.flatMap(l => l.courts.map(c => c.courtName));
      const names = (values[0] ?? '').split(',')
        .map(raw => all.find(c => c.toLowerCase() === raw.trim().toLowerCase()) ?? '')
        .filter(Boolean);
      return { value: JSON.stringify(names), consumed: 1 };
    },
  }), [courtsByLocation]);

  const locationColumn: Column = useMemo(() => ({
    key: 'location_bitmask',
    header: 'Locations',
    render: (value, onChange) => (
      <LocationCell value={value} onChange={onChange} locationNames={locationNames} />
    ),
    parsePaste: (values) => {
      const count = locationNames.length || values.length;
      const bits  = values.slice(0, count).map(v => {
        const n = v.trim().toUpperCase();
        return n === 'TRUE' || n === '1' ? 1 : 0;
      });
      while (bits.length < count) bits.push(1);
      return { value: bits.join(','), consumed: Math.min(count, values.length) };
    },
  }), [locationNames]);

  const playerGroupColumn: Column = useMemo(() => ({
    key: 'groupID',
    header: 'Player Group',
    width: '160px',
    render: (value, onChange) => (
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded border-0 bg-transparent px-1.5 py-1.5 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
      >
        <option value="">None</option>
        {groupNames.map(name => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    ),
    parsePaste: (values) => {
      const raw = (values[0] ?? '').trim();
      if (!raw || raw.toLowerCase() === 'none' || raw.toLowerCase() === 'not a player') {
        return { value: '', consumed: 1 };
      }
      const match = groupNames.find(g => g.toLowerCase() === raw.toLowerCase());
      return { value: match ?? '', consumed: 1 };
    },
  }), [groupNames]);

  // Which trainer row coaches each group, so other trainers' dropdowns can leave it out.
  const trainingGroupsColumn: Column = useMemo(() => {
    const coachedBy = new Map<string, Record<string, string>>();
    for (const row of rows.trainers) {
      for (const name of parseList(row.trainingGroups).slice(0, capacityOf(row))) {
        if (name) coachedBy.set(name, row);
      }
    }
    return {
      key: 'trainingGroups',
      header: 'Training Group',
      width: '160px',
      render: (value, onChange, row) => (
        <TrainingGroupsCell
          value={value}
          onChange={onChange}
          capacity={capacityOf(row)}
          groupNames={groupNames}
          playerGroup={row.groupID ?? ''}
          isTakenElsewhere={name => coachedBy.has(name) && coachedBy.get(name) !== row}
        />
      ),
      // Pasted as group names separated by commas.
      parsePaste: (values) => {
        const names = (values[0] ?? '').split(',')
          .map(raw => groupNames.find(g => g.toLowerCase() === raw.trim().toLowerCase()) ?? '')
          .filter(Boolean);
        return { value: JSON.stringify(names), consumed: 1 };
      },
    };
  }, [rows.trainers, groupNames]);

  // Which columns show depends on the Scheduler Settings (hidden values are kept, not deleted).
  const columns: Record<Tab, Column[]> = useMemo(() => {
    const groupColumns = BASE_COLUMNS.groups.filter(c =>
      (c.key !== 'level' || levelsInUse(settings, data)) && (c.key !== 'gender' || settings.genderedTeams));
    const [nameColumn, capacityColumn] = BASE_COLUMNS.trainers;
    const trainerColumns = settings.assignTrainers
      ? [nameColumn, capacityColumn, trainingGroupsColumn]
      : [nameColumn, ...(settings.genderedTeams ? GENDERED_LEVEL_COLUMNS : [SINGLE_LEVEL_COLUMN]), capacityColumn];
    return {
      ...BASE_COLUMNS,
      locations: courtsNamed(settings) ? [...BASE_COLUMNS.locations, courtNamesColumn] : BASE_COLUMNS.locations,
      timeslots: [...BASE_COLUMNS.timeslots, settings.courtTimeslots ? courtsColumn : locationColumn],
      groups:    [...groupColumns, locationColumn, groupAvailabilityColumn],
      trainers:  [...trainerColumns, playerGroupColumn, availabilityColumn],
    };
  }, [settings, data, availabilityColumn, groupAvailabilityColumn, playerGroupColumn, trainingGroupsColumn, locationColumn, courtsColumn, courtNamesColumn]);

  // Renaming a court (or its location) carries its timeslot ticks over to the new name.
  // tickIds.current[i][j] is the name the ticks for location row i, court j are stored
  // under. While a rename passes through a name another court at that location already
  // has (e.g. typing "Show 2" next to "Show"), the ticks wait on their last unique name,
  // so two courts' ticks are never merged.
  const tickIds = useRef<string[][]>(rows.locations.map(courtIdsOf));

  function updateTab(updated: Record<string, string>[]) {
    if (tab !== 'locations') {
      setRows(prev => ({ ...prev, [tab]: updated }));
      return;
    }
    const renamed = new Map<string, string>();
    if (updated.length === tickIds.current.length) {
      tickIds.current = updated.map((row, i) => {
        const ids = courtIdsOf(row);
        if (ids.length === 0) return tickIds.current[i];  // location name cleared mid-edit
        return ids.map((id, j) => {
          const old = tickIds.current[i][j];
          if (old === undefined) return id;                              // a court just added
          if (ids.indexOf(id) !== ids.lastIndexOf(id)) return old;       // duplicate: wait
          if (old !== id) renamed.set(old, id);
          return id;
        });
      });
    } else {
      // Location rows added or removed: start tracking afresh from the current names.
      tickIds.current = updated.map(courtIdsOf);
    }
    setRows(prev => ({
      ...prev,
      locations: updated,
      timeslots: renamed.size === 0 ? prev.timeslots : prev.timeslots.map(r => ({
        ...r,
        courts: JSON.stringify(parseList(r.courts).map(name => renamed.get(name) ?? name)),
      })),
    }));
  }

  const slotClashes = useMemo(() => (data ? timeslotClashes(data, settings) : []), [data, settings]);

  function clearAll() {
    setRows(INIT_ROWS());
    setTravelTimes([]);
    tickIds.current = [[]];
  }

  function clearTab() {
    setRows(prev => ({ ...prev, [tab]: [EMPTY_ROW[tab]()] }));
    if (tab === 'locations') {
      setTravelTimes([]);
      tickIds.current = [[]];
    }
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Input Data</h1>
        <div className="flex items-center gap-2.5">
          <button
            onClick={clearAll}
            className="flex items-center gap-2 rounded-md border border-gray-200 px-5 py-2.5 text-base font-medium text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <Trash2 size={17} />
            Clear all
          </button>
          <button
            onClick={clearTab}
            className="flex items-center gap-2 rounded-md border border-gray-200 px-5 py-2.5 text-base font-medium text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <Trash2 size={17} />
            Clear tab
          </button>
        </div>
      </div>

      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-3 text-base font-medium transition-colors ${
              tab === t.id
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-sm text-gray-500">
              {rows[t.id].filter(r =>
                BASE_COLUMNS[t.id].some(c => !c.type && (r[c.key] ?? '') !== '')
              ).length}
            </span>
          </button>
        ))}
      </div>

      {tab === 'timeslots' && slotClashes.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="mb-1 font-semibold">Timeslots can&apos;t overlap on the same court:</div>
          <ul className="list-disc pl-5">
            {slotClashes.map((clash, i) => <li key={i}>{clash}</li>)}
          </ul>
        </div>
      )}

      <EditableTable
        columns={columns[tab]}
        rows={rows[tab]}
        onChange={updateTab}
        createEmpty={EMPTY_ROW[tab]}
      />

      {tab === 'locations' && (
        <TravelTimesSection
          locationNames={locationNames}
          travelTimes={travelTimes}
          onChange={setTravelTimes}
        />
      )}
    </div>
  );
}
