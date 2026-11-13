'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import EditableTable, { Column } from '@/components/EditableTable';
import { useSchedule } from '@/components/ScheduleProvider';
import { spacesNamed, levelsInUse, timeslotClashes } from '@/lib/settings';
import { Space, Location, ScheduleData, TravelTime, expandLocations, sortDays, toMinutes } from '@/lib/types';

type Tab = 'locations' | 'timeslots' | 'groups' | 'trainers' | 'groupRules';

// The tabs in the order to fill them in, each with a line saying what it is for.
const TABS: { id: Tab; label: string; intro: string }[] = [
  {
    id: 'locations', label: 'Locations',
    intro: 'Where sessions take place, and how many spaces each location has, such as halls, pitches, pools or rooms. A space holds one session at a time.',
  },
  {
    id: 'timeslots', label: 'Timeslots',
    intro: 'The days and times when sessions can take place. Each group gets one session in one of these timeslots.',
  },
  {
    id: 'groups', label: 'Groups',
    intro: "The groups that need a session. Switch off any timeslots or locations a group can't make.",
  },
  {
    id: 'trainers', label: 'Trainers',
    intro: "The people who train your groups. Switch off any timeslots a trainer can't make.",
  },
  {
    id: 'groupRules', label: 'Group Rules', // only with the Group Rules setting
    intro: "Let members of some groups attend other groups' sessions. The scheduler keeps those sessions from overlapping.",
  },
];

const BASE_COLUMNS: Record<Tab, Column[]> = {
  locations: [
    { key: 'name',   header: 'Location Name', placeholder: 'Location' },
    { key: 'spaces', header: 'Spaces', type: 'number', placeholder: '1', width: '110px', hint: 'How many sessions can run here at the same time.' },
  ],
  timeslots: [
    { key: 'day',    header: 'Day',    placeholder: 'Monday' },
    { key: 'start',  header: 'Start',  placeholder: '09:00', hint: 'Use 24-hour time, such as 18:30.' },
    { key: 'finish', header: 'Finish', placeholder: '10:00' },
  ],
  groups: [
    { key: 'name',   header: 'Name',   placeholder: 'Beginners', width: '200px' },
    {
      key: 'level', header: 'Level', type: 'number', placeholder: '1', width: '100px',
      hint: "How advanced the group is. 1 is the most advanced. A trainer can train a group at their own level or a less advanced one.",
    },
    { key: 'gender', header: 'Gender', type: 'select', options: ['female', 'male'], width: '120px' },
  ],
  trainers: [
    { key: 'name',       header: 'Name',         placeholder: 'Sam Taylor', width: '200px' },
    { key: 'capacity',   header: 'Capacity',      type: 'number', placeholder: '1', width: '120px', hint: 'The most groups this trainer can train.' },
  ],
  groupRules: [], // built in the page, from the current groups
};

// Trainer level columns: one per gender, or a single Level (stored as the female
// level) when groups aren't gendered. Hidden when trainers are assigned to groups.
const LEVEL_HINT = 'The most advanced group this trainer can train. With level 2 they can train groups at level 2, 3, 4 and so on, but not level 1.';
const GENDERED_LEVEL_COLUMNS: Column[] = [
  { key: 'femaleLevel', header: 'Female Level', type: 'number', placeholder: '1', width: '150px', hint: `${LEVEL_HINT} Enter 0 if they only train male groups.` },
  { key: 'maleLevel',   header: 'Male Level',   type: 'number', placeholder: '1', width: '140px', hint: `${LEVEL_HINT} Enter 0 if they only train female groups.` },
];
const SINGLE_LEVEL_COLUMN: Column = {
  key: 'femaleLevel', header: 'Level', type: 'number', placeholder: '1', width: '100px',
  hint: `${LEVEL_HINT} Enter 0 to keep them in your list without giving them any groups to train.`,
};

type RowMap = Record<Tab, Record<string, string>[]>;

// Parse a bitmask typed or pasted as "1,0,1", "1 0 1" or "101".
function parseBitmask(s: string): number[] {
  if (!s.trim()) return [];
  if (s.includes(',')) return s.split(',').map(v => (parseInt(v.trim(), 10) || 0));
  if (s.includes(' ')) return s.split(/\s+/).map(v => (parseInt(v, 10) || 0));
  return s.split('').map(v => (parseInt(v, 10) || 0));
}

// Training Groups and timeslot Spaces are stored in a row as a JSON list of names
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

// A trainer's level as typed. Left empty, it is 1, so a new trainer can train any group;
// 0 has to be entered on purpose.
function trainerLevel(value: string): number {
  const level = parseInt(value, 10);
  return Number.isNaN(level) ? 1 : level;
}

function toGender(v: string): 'female' | 'male' {
  return (v ?? '').trim().toLowerCase() === 'male' ? 'male' : 'female';
}

function dataToRows(data: ScheduleData): RowMap {
  return {
    locations: (data.locations ?? []).map(l => ({
      name: l.name, spaces: String(l.spaces),
      spaceNames: JSON.stringify(l.spaceNames ?? []),
    })),
    timeslots: data.timeslots.map(t => ({
      day: t.day, start: t.start, finish: t.finish,
      location_bitmask: t.location_bitmask?.join(',') ?? '',
      spaces: JSON.stringify(t.spaces ?? []),
    })),
    groups: data.groups.map(g => ({
      name: g.name, level: String(g.level),
      gender: toGender(g.gender),
      availability_bitmask: g.availability_bitmask.join(','),
      location_bitmask: g.location_bitmask?.join(',') ?? '',
    })),
    trainers: data.trainers.map(t => ({
      name: t.name, groupID: t.groupID,
      femaleLevel: String(t.femaleLevel ?? 1), maleLevel: String(t.maleLevel ?? 1),
      capacity: String(t.capacity ?? 1),
      trainingGroups: JSON.stringify(t.trainingGroups ?? []),
      availability_bitmask: t.availability_bitmask.join(','),
    })),
    groupRules: (data.groupRules ?? []).map(r => ({
      groups: JSON.stringify(r.groups), against: JSON.stringify(r.against), required: r.required ? '1' : '0',
    })),
  };
}

// Locations from the Locations tab rows. Space names are kept by position (blank = unnamed).
function rowsToLocations(locationRows: Record<string, string>[]): Location[] {
  return locationRows.filter(r => r.name).map(r => {
    const spaces = Math.max(1, parseInt(r.spaces, 10) || 1);
    const spaceNames = parseList(r.spaceNames).slice(0, spaces);
    return { name: r.name, spaces, spaceNames: spaceNames.some(n => n.trim()) ? spaceNames : undefined };
  });
}

// The space identities ("<location> <name or number>") of one Locations tab row.
function spaceIdsOf(locationRow: Record<string, string>): string[] {
  return expandLocations(rowsToLocations([locationRow])).map(c => c.spaceName);
}

// Group names pasted as a comma-separated list: matched to existing groups (ignoring case),
// without repeats or any of `exclude`.
function pastedGroupNames(raw: string, groupNames: string[], exclude: string[] = []): string[] {
  const names = (raw ?? '').split(',')
    .map(text => groupNames.find(g => g.toLowerCase() === text.trim().toLowerCase()))
    .filter((name): name is string => !!name && !exclude.includes(name));
  return [...new Set(names)];
}

// Carries renames over to references. refs[i] is the name references to item i currently
// use and names[i] its new name; renamed collects old -> new. An item whose new name is
// blank or shared with another item keeps its old reference until its name is unique
// again (e.g. typing "Men 10" next to "Men 1"), so two items' references never merge.
function carryRenames(refs: string[], names: string[], renamed: Map<string, string>): string[] {
  return names.map((name, i) => {
    const old = refs[i];
    if (old === undefined) return name;                                            // just added
    if (!name.trim() || names.indexOf(name) !== names.lastIndexOf(name)) return old;
    if (old !== name) renamed.set(old, name);
    return name;
  });
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
  // Space names that no longer exist (e.g. after renaming a location) are dropped, so a
  // timeslot never silently runs on no space at all.
  const spaceNames = new Set(expandLocations(locations).map(c => c.spaceName));
  const groupNames = new Set(rows.groups.map(r => r.name).filter(Boolean));

  return {
    locations,
    timeslots: rows.timeslots.filter(r => r.day).map(r => ({
      day: r.day, start: r.start, finish: r.finish,
      location_bitmask: parseLocBitmask(r.location_bitmask),
      spaces: parseList(r.spaces).filter(name => spaceNames.has(name)),
    })),
    groups: rows.groups.filter(r => r.name).map(r => ({
      name: r.name, level: parseInt(r.level, 10) || 1,
      gender: toGender(r.gender),
      availability_bitmask: defaultBitmask(r.availability_bitmask, numSlots),
      location_bitmask: parseLocBitmask(r.location_bitmask),
    })),
    trainers: rows.trainers.filter(r => r.name).map(r => ({
      name: r.name, groupID: r.groupID ?? '',
      femaleLevel: trainerLevel(r.femaleLevel),
      maleLevel: trainerLevel(r.maleLevel),
      capacity: capacityOf(r),
      // Only the slots shown (one per unit of capacity) count.
      trainingGroups: parseList(r.trainingGroups).slice(0, capacityOf(r)).filter(Boolean),
      availability_bitmask: defaultBitmask(r.availability_bitmask, numSlots),
    })),
    // Rules keep only groups that still exist; rules with nothing picked are dropped.
    groupRules: rows.groupRules
      .map(r => ({
        type: 'notAtSameTime' as const,
        groups:  parseList(r.groups).filter(name => groupNames.has(name)),
        against: parseList(r.against).filter(name => groupNames.has(name)),
        required: r.required === '1',
      }))
      .filter(r => r.groups.length > 0 || r.against.length > 0),
  };
}

const EMPTY_ROW: Record<Tab, () => Record<string, string>> = {
  locations: () => ({ name: '', spaces: '1', spaceNames: '[]' }),
  timeslots: () => ({ day: '', start: '', finish: '', location_bitmask: '', spaces: '[]' }),
  groups:    () => ({ name: '', level: '', gender: 'female', availability_bitmask: '', location_bitmask: '' }),
  trainers:  () => ({ name: '', groupID: '', femaleLevel: '1', maleLevel: '1', capacity: '1', trainingGroups: '[]', availability_bitmask: '' }),
  groupRules: () => ({ groups: '[]', against: '[]', required: '0' }), // preferred by default
};

// One dropdown per unit of the trainer's capacity. Each lists only groups no other
// trainer trains, that this trainer hasn't already picked in another slot, and that
// isn't the group they are a member of (nobody trains their own group).
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
    return <span className="text-sm italic text-gray-400">Add timeslots first</span>;
  }
  const visible = timeslots.map((_, i) => i).filter(i => shown?.[i] ?? true);
  if (visible.length === 0) {
    return <span className="text-sm italic text-gray-400">No timeslots at these locations yet</span>;
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
                {timeslots[i].start}-{timeslots[i].finish}
              </Chip>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// One side of a group rule: the picked groups as removable chips, plus an "Add group"
// dropdown listing groups not already in the rule (on either side).
function GroupPickerCell({
  value, onChange, groupNames, otherSide,
}: {
  value: string;
  onChange: (v: string) => void;
  groupNames: string[];
  otherSide: string[];
}) {
  const picked = parseList(value);
  const available = groupNames.filter(name => !picked.includes(name) && !otherSide.includes(name));
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1.5">
      {picked.map(name => (
        <span key={name} className="flex items-center gap-0.5 rounded-full bg-blue-600 py-0.5 pl-2 pr-0.5 text-xs text-white">
          {name}
          <button
            type="button"
            onClick={() => onChange(JSON.stringify(picked.filter(n => n !== name)))}
            aria-label={`Remove ${name}`}
            className="rounded-full px-1.5 hover:bg-blue-700"
          >
            ×
          </button>
        </span>
      ))}
      {available.length > 0 && (
        <select
          value=""
          onChange={e => onChange(JSON.stringify([...picked, e.target.value]))}
          className="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="" disabled>+ Add Group</option>
          {available.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      )}
    </div>
  );
}

// One name box per space (Name Spaces). Names must be unique within the location, and
// with space-specific timeslots every space needs one; problems are highlighted.
function SpaceNamesCell({
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
          placeholder={`Space ${i + 1}`}
          onChange={e => setName(i, e.target.value)}
          className={`w-32 rounded border px-1.5 py-1 text-base text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            isProblem(name) ? 'border-red-300 bg-red-50' : 'border-gray-200'
          }`}
        />
      ))}
    </div>
  );
}

// Space-specific timeslots: which spaces a timeslot runs on, grouped by location.
// An empty list means every space; at least one space always stays ticked.
function SpacesCell({
  value, onChange, spacesByLocation,
}: {
  value: string;
  onChange: (v: string) => void;
  spacesByLocation: { location: string; spaces: Space[] }[];
}) {
  const allSpaces = spacesByLocation.flatMap(l => l.spaces.map(c => c.spaceName));
  if (allSpaces.length === 0) {
    return <span className="text-sm italic text-gray-400">Add locations first</span>;
  }
  const stored = parseList(value).filter(name => allSpaces.includes(name));
  const ticked = new Set(stored.length > 0 ? stored : allSpaces);

  function toggle(name: string, checked: boolean) {
    const next = allSpaces.filter(c => (c === name ? checked : ticked.has(c)));
    onChange(JSON.stringify(next.length === allSpaces.length ? [] : next));
  }

  return (
    <div className="flex flex-col gap-1.5 py-1.5">
      {spacesByLocation.map(({ location, spaces }) => (
        <div key={location} className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 shrink-0 truncate text-xs font-semibold text-gray-600" title={location}>{location}</span>
          {spaces.map(({ spaceName, label }) => {
            const isLast = ticked.has(spaceName) && ticked.size === 1;
            return (
              <Chip
                key={spaceName}
                selected={ticked.has(spaceName)}
                disabled={isLast}
                title={isLast ? 'A timeslot needs at least one space' : undefined}
                onClick={() => toggle(spaceName, !ticked.has(spaceName))}
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
    return <span className="text-sm italic text-gray-400">Add locations first</span>;
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
        How many minutes it takes to get from one location to another. The scheduler gives trainers enough time to travel between their sessions.
      </p>
      <div className="space-y-3">
        {pairs.map(([from, to]) => (
          <div key={`${from}__${to}`} className="flex items-center gap-4">
            <span className="text-sm text-gray-700 w-52">
              {from} <span className="mx-1 text-gray-400">and</span> {to}
            </span>
            <input
              type="number"
              min="1"
              value={getMinutes(from, to)}
              onChange={e => setMinutes(from, to, e.target.value)}
              placeholder="0"
              className="w-20 rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-400">minutes</span>
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
  groupRules: [EMPTY_ROW.groupRules()],
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
    groupRules: loaded.groupRules.length ? loaded.groupRules : empty.groupRules,
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
    hint: 'The timeslots they can make. Click a time to switch it on or off, or click a day to switch the whole day.',
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

  const spacesByLocation = useMemo(
    () => rowsToLocations(rows.locations).map(loc => ({ location: loc.name, spaces: expandLocations([loc]) })),
    [rows.locations],
  );

  // The locations each timeslot runs at: those ticked for it (by location, or with
  // space-specific timeslots, by having one of its spaces ticked); all when none are.
  const timeslotLocations = useMemo(
    () => rows.timeslots.filter(r => r.day).map(r => {
      if (settings.spaceTimeslots) {
        const spaces = new Set(parseList(r.spaces));
        const at = spacesByLocation.filter(l => l.spaces.some(c => spaces.has(c.spaceName))).map(l => l.location);
        return at.length > 0 ? at : locationNames;
      }
      const bits = parseBitmask(r.location_bitmask ?? '');
      return locationNames.filter((_, i) => (bits[i] ?? 1) === 1);
    }),
    [rows.timeslots, settings.spaceTimeslots, spacesByLocation, locationNames],
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

  const spaceNamesColumn: Column = useMemo(() => ({
    key: 'spaceNames',
    header: 'Space Names',
    hint: 'A name for each space, such as Hall A or Pool 2. Two spaces at one location need different names.',
    render: (value, onChange, row) => (
      <SpaceNamesCell
        value={value}
        onChange={onChange}
        count={Math.max(1, parseInt(row.spaces, 10) || 1)}
        required={settings.spaceTimeslots}
      />
    ),
    // Pasted as space names separated by commas, in space order.
    parsePaste: (values) => ({
      value: JSON.stringify((values[0] ?? '').split(',').map(n => n.trim())),
      consumed: 1,
    }),
  }), [settings.spaceTimeslots]);

  const spacesColumn: Column = useMemo(() => ({
    key: 'spaces',
    header: 'Spaces',
    hint: 'The spaces this timeslot runs in. Click a space to switch it on or off.',
    render: (value, onChange) => (
      <SpacesCell value={value} onChange={onChange} spacesByLocation={spacesByLocation} />
    ),
    // Pasted as location + space name, separated by commas, e.g. "Club A Show Space, Club A 2".
    parsePaste: (values) => {
      const all = spacesByLocation.flatMap(l => l.spaces.map(c => c.spaceName));
      const names = (values[0] ?? '').split(',')
        .map(raw => all.find(c => c.toLowerCase() === raw.trim().toLowerCase()) ?? '')
        .filter(Boolean);
      return { value: JSON.stringify(names), consumed: 1 };
    },
  }), [spacesByLocation]);

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
    header: 'Member Of',
    hint: "The group this trainer belongs to, if any. They never train their own group, and the scheduler keeps them free to attend its session.",
    width: '170px',
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
      if (!raw || raw.toLowerCase() === 'none') {
        return { value: '', consumed: 1 };
      }
      const match = groupNames.find(g => g.toLowerCase() === raw.toLowerCase());
      return { value: match ?? '', consumed: 1 };
    },
  }), [groupNames]);

  // Which trainer row trains each group, so other trainers' dropdowns can leave it out.
  const trainingGroupsColumn: Column = useMemo(() => {
    const coachedBy = new Map<string, Record<string, string>>();
    for (const row of rows.trainers) {
      for (const name of parseList(row.trainingGroups).slice(0, capacityOf(row))) {
        if (name) coachedBy.set(name, row);
      }
    }
    return {
      key: 'trainingGroups',
      header: 'Training Groups',
      hint: 'The groups this trainer trains. You get one box for each group their capacity allows.',
      width: '190px',
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
      parsePaste: (values) => ({ value: JSON.stringify(pastedGroupNames(values[0], groupNames)), consumed: 1 }),
    };
  }, [rows.trainers, groupNames]);

  // Group Rules tab: two sides of picked groups, and whether the rule is required.
  const groupRuleColumns: Column[] = useMemo(() => {
    const side = (key: 'groups' | 'against', header: string, hint: string, other: 'groups' | 'against'): Column => ({
      key,
      header,
      hint,
      render: (value, onChange, row) => (
        <GroupPickerCell value={value} onChange={onChange} groupNames={groupNames} otherSide={parseList(row[other])} />
      ),
      // Pasted as group names separated by commas (pasted into one side at a time).
      parsePaste: (values) => ({ value: JSON.stringify(pastedGroupNames(values[0], groupNames)), consumed: 1 }),
    });
    return [
      // Read as a sentence: members of these groups can attend those groups' sessions.
      side('groups', 'Members Of', 'The groups whose members want to attend other sessions.', 'against'),
      side('against', 'Can Attend', 'The groups whose sessions they want to attend.', 'groups'),
      {
        key: 'required',
        header: 'Required',
        hint: 'On: The scheduler never lets these sessions overlap.\nOff: The scheduler avoids overlaps where it can, when the Group Rules reward is switched on.',
        width: '140px',
        render: (value, onChange) => (
          <Chip selected={value === '1'} onClick={() => onChange(value === '1' ? '0' : '1')}>Required</Chip>
        ),
        // Pasted as yes/no (also true/false, 1/0, "required").
        parsePaste: (values) => ({
          value: ['yes', 'y', 'true', '1', 'required'].includes((values[0] ?? '').trim().toLowerCase()) ? '1' : '0',
          consumed: 1,
        }),
      },
    ];
  }, [groupNames]);

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
      locations: spacesNamed(settings) ? [...BASE_COLUMNS.locations, spaceNamesColumn] : BASE_COLUMNS.locations,
      timeslots: [...BASE_COLUMNS.timeslots, settings.spaceTimeslots
        ? spacesColumn
        : { ...locationColumn, hint: 'The locations this timeslot runs at. Click a location to switch it on or off.' }],
      groups:    [
        ...groupColumns,
        { ...locationColumn, hint: 'Where this group can train. Click a location to switch it on or off.' },
        groupAvailabilityColumn,
      ],
      trainers:  [...trainerColumns, playerGroupColumn, availabilityColumn],
      groupRules: groupRuleColumns,
    };
  }, [settings, data, availabilityColumn, groupAvailabilityColumn, playerGroupColumn, trainingGroupsColumn, locationColumn, spacesColumn, spaceNamesColumn, groupRuleColumns]);

  // Renames carry over to everything that refers to the renamed item (see carryRenames):
  // a space or location's timeslot ticks, and a group's Member Of, Training Groups and
  // group rule references. spaceRefs[i][j] and groupRefs[i] are the names those references
  // currently use, by row position; adding or removing rows starts tracking afresh.
  const spaceRefs = useRef<string[][]>(rows.locations.map(spaceIdsOf));
  const groupRefs = useRef<string[]>(rows.groups.map(r => r.name ?? ''));

  function updateTab(updated: Record<string, string>[]) {
    const renamed = new Map<string, string>();
    if (tab === 'locations') {
      spaceRefs.current = updated.length === spaceRefs.current.length
        ? updated.map((row, i) => {
            const ids = spaceIdsOf(row);
            // A location whose name is cleared mid-edit keeps its references.
            return ids.length === 0 ? spaceRefs.current[i] : carryRenames(spaceRefs.current[i], ids, renamed);
          })
        : updated.map(spaceIdsOf);
    } else if (tab === 'groups') {
      const names = updated.map(r => r.name ?? '');
      groupRefs.current = updated.length === groupRefs.current.length
        ? carryRenames(groupRefs.current, names, renamed)
        : names;
    }

    const rename = (list: string) => JSON.stringify(parseList(list).map(name => renamed.get(name) ?? name));
    setRows(prev => {
      const next = { ...prev, [tab]: updated };
      if (renamed.size === 0) return next;
      if (tab === 'locations') {
        return { ...next, timeslots: next.timeslots.map(r => ({ ...r, spaces: rename(r.spaces) })) };
      }
      return {
        ...next,
        trainers: next.trainers.map(r => ({
          ...r, groupID: renamed.get(r.groupID) ?? r.groupID, trainingGroups: rename(r.trainingGroups),
        })),
        groupRules: next.groupRules.map(r => ({ ...r, groups: rename(r.groups), against: rename(r.against) })),
      };
    });
  }

  const slotClashes = useMemo(() => (data ? timeslotClashes(data, settings) : []), [data, settings]);

  function clearAll() {
    setRows(INIT_ROWS());
    setTravelTimes([]);
    spaceRefs.current = [[]];
    groupRefs.current = [''];
  }

  function clearTab() {
    setRows(prev => ({ ...prev, [tab]: [EMPTY_ROW[tab]()] }));
    if (tab === 'locations') {
      setTravelTimes([]);
      spaceRefs.current = [[]];
    }
    if (tab === 'groups') groupRefs.current = [''];
  }

  // Rows with something entered, for the tab badges.
  const filledRows = (t: Tab) => rows[t].filter(r => (t === 'groupRules'
    ? parseList(r.groups).length + parseList(r.against).length > 0
    : BASE_COLUMNS[t].some(c => !c.type && (r[c.key] ?? '') !== ''))).length;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Data</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <button
            onClick={clearAll}
            className="flex items-center gap-2 rounded-md border border-gray-200 px-5 py-2.5 text-base font-medium text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <Trash2 size={17} />
            Clear All
          </button>
          <button
            onClick={clearTab}
            className="flex items-center gap-2 rounded-md border border-gray-200 px-5 py-2.5 text-base font-medium text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <Trash2 size={17} />
            Clear Tab
          </button>
        </div>
      </div>

      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {TABS.filter(t => t.id !== 'groupRules' || settings.groupRules).map(t => (
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
              {filledRows(t.id)}
            </span>
          </button>
        ))}
      </div>

      <p className="mb-4 text-base text-gray-500">{TABS.find(t => t.id === tab)!.intro}</p>

      {tab === 'timeslots' && slotClashes.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="mb-1 font-semibold">A space can only hold one session at a time. Please change these timeslots so they no longer overlap:</div>
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
