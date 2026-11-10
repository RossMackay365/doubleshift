'use client';
import { useState, useEffect, useMemo, useCallback, startTransition } from 'react';
import { Save, CheckCircle, Trash2 } from 'lucide-react';
import EditableTable, { Column } from '@/components/EditableTable';
import { saveData, loadData, parseBitmask } from '@/lib/storage';
import { ScheduleData, TravelTime } from '@/lib/types';

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
    { key: 'name',   header: 'Name',   placeholder: 'Ladies Beginner' },
    { key: 'level',  header: 'Level',  type: 'number', placeholder: '1', width: '70px' },
    { key: 'gender', header: 'Gender', type: 'select', options: ['female', 'male'], width: '90px' },
  ],
  trainers: [
    { key: 'name',       header: 'Name',         placeholder: 'Alice Coach' },
    { key: 'ladiesRank', header: 'Female Level',  type: 'number', placeholder: '0', width: '90px' },
    { key: 'gentsRank',  header: 'Male Level',    type: 'number', placeholder: '0', width: '90px' },
    { key: 'capacity',   header: 'Capacity',      type: 'number', placeholder: '1', width: '70px' },
  ],
};

type RowMap = Record<Tab, Record<string, string>[]>;

function toGender(v: string): 'female' | 'male' {
  return (v ?? '').trim().toLowerCase() === 'male' ? 'male' : 'female';
}

// Row encoding of the two day-preference checkboxes: 'same' | 'different' | 'both' | 'none'.
function toDayPrefRow(same: boolean, different: boolean): string {
  if (same && different) return 'both';
  if (same) return 'same';
  if (different) return 'different';
  return 'none';
}

function fromDayPrefRow(v: string): { prefSameDay: boolean; prefDifferentDay: boolean } {
  const n = (v ?? 'same').trim().toLowerCase();
  return {
    prefSameDay:      n === 'same' || n === 'both',
    prefDifferentDay: n === 'different' || n === 'both',
  };
}

function parseDayPrefText(raw: string): string {
  const n = raw.trim().toLowerCase();
  if (n === 'different' || n === 'diff') return 'different';
  if (n === 'both' || n === 'any' || n === 'either') return 'both';
  if (n === 'none' || n === 'neither') return 'none';
  return 'same';
}

function parseBoolText(raw: string): string {
  const n = raw.trim().toUpperCase();
  return n === 'TRUE' || n === '1' || n === 'YES' || n === 'Y' ? '1' : '0';
}

function dataToRows(data: ScheduleData): RowMap {
  return {
    locations: (data.locations ?? []).map(l => ({
      name: l.name, courts: String(l.courts),
    })),
    timeslots: data.timeslots.map(t => ({
      day: t.day, start: t.start, finish: t.finish,
      location_bitmask: t.location_bitmask?.join(',') ?? '',
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
      // Legacy saved data has no preference fields → same day, not required.
      dayPref: toDayPrefRow(t.prefSameDay ?? true, t.prefDifferentDay ?? false),
      prefRequired: t.prefRequired ? '1' : '0',
      availability_bitmask: t.availability_bitmask.join(','),
    })),
  };
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

  return {
    locations: rows.locations.filter(r => r.name).map(r => ({
      name: r.name,
      courts: Math.max(1, parseInt(r.courts, 10) || 1),
    })),
    timeslots: rows.timeslots.filter(r => r.day).map(r => ({
      day: r.day, start: r.start, finish: r.finish,
      location_bitmask: parseLocBitmask(r.location_bitmask),
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
      capacity: Math.max(1, parseInt(r.capacity, 10) || 1),
      ...fromDayPrefRow(r.dayPref),
      prefRequired: r.prefRequired === '1',
      availability_bitmask: defaultBitmask(r.availability_bitmask, numSlots),
    })),
  };
}

const EMPTY_ROW: Record<Tab, () => Record<string, string>> = {
  locations: () => ({ name: '', courts: '1' }),
  timeslots: () => ({ day: '', start: '', finish: '', location_bitmask: '' }),
  groups:    () => ({ name: '', level: '', gender: 'female', availability_bitmask: '', location_bitmask: '' }),
  trainers:  () => ({ name: '', groupID: '', ladiesRank: '', gentsRank: '', capacity: '1', dayPref: 'same', prefRequired: '0', availability_bitmask: '' }),
};

function DayPrefCell({
  value, onChange, isPlayer,
}: {
  value: string;
  onChange: (v: string) => void;
  isPlayer: boolean;
}) {
  if (!isPlayer) {
    return <span className="text-sm italic text-gray-400">Not a player</span>;
  }
  const { prefSameDay, prefDifferentDay } = fromDayPrefRow(value);
  const boxes: { label: string; checked: boolean; next: (c: boolean) => string }[] = [
    { label: 'Same day',      checked: prefSameDay,      next: c => toDayPrefRow(c, prefDifferentDay) },
    { label: 'Different day', checked: prefDifferentDay, next: c => toDayPrefRow(prefSameDay, c) },
  ];
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2.5 py-1.5">
      {boxes.map(b => (
        <label key={b.label} className="flex cursor-pointer flex-col items-center gap-1 select-none min-w-[44px]">
          <input
            type="checkbox"
            checked={b.checked}
            onChange={e => onChange(b.next(e.target.checked))}
            className="h-4 w-4 accent-blue-600"
          />
          <span className="text-xs leading-none text-gray-500">{b.label}</span>
        </label>
      ))}
    </div>
  );
}

function RequiredCell({
  value, onChange, isPlayer,
}: {
  value: string;
  onChange: (v: string) => void;
  isPlayer: boolean;
}) {
  if (!isPlayer) {
    return <span className="text-sm italic text-gray-400">—</span>;
  }
  return (
    <div className="flex justify-center py-1.5">
      <input
        type="checkbox"
        checked={value === '1'}
        onChange={e => onChange(e.target.checked ? '1' : '0')}
        className="h-4 w-4 accent-blue-600"
        title="Required: the schedule is infeasible unless this preference is met"
      />
    </div>
  );
}

function AvailabilityCell({
  value, onChange, timeslots,
}: {
  value: string;
  onChange: (v: string) => void;
  timeslots: { day: string; start: string }[];
}) {
  if (timeslots.length === 0) {
    return <span className="text-sm italic text-gray-400">Define timeslots first</span>;
  }
  const arr  = parseBitmask(value);
  const bits = timeslots.map((_, i) => (arr[i] ?? 1) === 1);

  function toggle(i: number, checked: boolean) {
    const next = [...bits.map(b => (b ? 1 : 0))];
    next[i] = checked ? 1 : 0;
    onChange(next.join(','));
  }

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2.5 py-1.5">
      {timeslots.map((slot, i) => (
        <label key={i} className="flex cursor-pointer flex-col items-center gap-1 select-none min-w-[44px]">
          <input
            type="checkbox"
            checked={bits[i]}
            onChange={e => toggle(i, e.target.checked)}
            className="h-4 w-4 accent-blue-600"
          />
          <span className="text-xs leading-none text-gray-500">{(slot.day ?? '').slice(0, 3)}</span>
          <span className="text-xs leading-none text-gray-400">{slot.start}</span>
        </label>
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

  function toggle(i: number, checked: boolean) {
    const next = [...bits.map(b => (b ? 1 : 0))];
    next[i] = checked ? 1 : 0;
    onChange(next.join(','));
  }

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2.5 py-1.5">
      {locationNames.map((name, i) => (
        <label key={i} className="flex cursor-pointer flex-col items-center gap-1 select-none min-w-[44px]">
          <input
            type="checkbox"
            checked={bits[i]}
            onChange={e => toggle(i, e.target.checked)}
            className="h-4 w-4 accent-blue-600"
          />
          <span className="text-xs leading-none text-gray-500">{name}</span>
        </label>
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

export default function DataPage() {
  const [tab, setTab]                       = useState<Tab>('locations');
  const [rows, setRows]                     = useState<RowMap>(INIT_ROWS);
  const [travelTimes, setTravelTimes]       = useState<TravelTime[]>([]);
  const [savedSnapshot, setSavedSnapshot]   = useState<RowMap>(INIT_ROWS);
  const [savedTravelTimes, setSavedTravelTimes] = useState<TravelTime[]>([]);

  useEffect(() => {
    const stored = loadData();
    if (!stored) return;
    const loaded = dataToRows(stored);
    const merge = (r: RowMap): RowMap => ({
      locations: loaded.locations.length ? loaded.locations : r.locations,
      timeslots: loaded.timeslots.length ? loaded.timeslots : r.timeslots,
      groups:    loaded.groups.length    ? loaded.groups    : r.groups,
      trainers:  loaded.trainers.length  ? loaded.trainers  : r.trainers,
    });
    const tt = stored.travelTimes ?? [];
    startTransition(() => {
      setRows(merge);
      setSavedSnapshot(merge);
      setTravelTimes(tt);
      setSavedTravelTimes(tt);
    });
  }, []);

  const isModified = useMemo(
    () =>
      JSON.stringify(rows) !== JSON.stringify(savedSnapshot) ||
      JSON.stringify(travelTimes) !== JSON.stringify(savedTravelTimes),
    [rows, savedSnapshot, travelTimes, savedTravelTimes],
  );

  const timeslotList = useMemo(
    () => rows.timeslots.filter(r => r.day).map(r => ({ day: r.day, start: r.start })),
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

  const trainerGroupColumn: Column = useMemo(() => ({
    key: 'groupID',
    header: 'Group',
    width: '100px',
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

  // Day preference cells depend on the row's group (only players have a preference),
  // so they read `row` rather than living in BASE_COLUMNS.
  const dayPrefColumn: Column = useMemo(() => ({
    key: 'dayPref',
    header: 'Day Pref',
    width: '180px',
    render: (value, onChange, row) => (
      <DayPrefCell value={value} onChange={onChange} isPlayer={(row.groupID ?? '') !== ''} />
    ),
    parsePaste: (values) => ({ value: parseDayPrefText(values[0] ?? ''), consumed: 1 }),
  }), []);

  const requiredColumn: Column = useMemo(() => ({
    key: 'prefRequired',
    header: 'Req',
    width: '60px',
    render: (value, onChange, row) => (
      <RequiredCell value={value} onChange={onChange} isPlayer={(row.groupID ?? '') !== ''} />
    ),
    parsePaste: (values) => ({ value: parseBoolText(values[0] ?? ''), consumed: 1 }),
  }), []);

  const columns: Record<Tab, Column[]> = useMemo(() => ({
    ...BASE_COLUMNS,
    timeslots: [...BASE_COLUMNS.timeslots, locationColumn],
    groups:    [...BASE_COLUMNS.groups,   locationColumn, availabilityColumn],
    trainers:  [...BASE_COLUMNS.trainers, trainerGroupColumn, dayPrefColumn, requiredColumn, availabilityColumn],
  }), [availabilityColumn, trainerGroupColumn, locationColumn, dayPrefColumn, requiredColumn]);

  const handleSave = useCallback(() => {
    saveData({ ...rowsToData(rows), travelTimes });
    setSavedSnapshot(rows);
    setSavedTravelTimes(travelTimes);
  }, [rows, travelTimes]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave]);

  function clearAll() {
    setRows(INIT_ROWS());
    setTravelTimes([]);
  }

  function clearTab() {
    setRows(prev => ({ ...prev, [tab]: [EMPTY_ROW[tab]()] }));
    if (tab === 'locations') setTravelTimes([]);
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Input Data</h1>
        <div className="flex items-center gap-2.5">
          {isModified && (
            <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-amber-600 mr-1">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
              Unsaved changes
            </span>
          )}
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
          <button
            onClick={handleSave}
            className={`flex items-center gap-2 rounded-md px-5 py-2.5 text-base font-medium transition-colors ${
              isModified ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-green-50 text-green-700'
            }`}
          >
            {isModified ? <Save size={17} /> : <CheckCircle size={17} />}
            {isModified ? 'Save' : 'Saved'}
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

      <EditableTable
        columns={columns[tab]}
        rows={rows[tab]}
        onChange={updated => setRows(prev => ({ ...prev, [tab]: updated }))}
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
