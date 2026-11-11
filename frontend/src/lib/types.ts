export interface RewardItem {
  key: string;
  label: string;
  value: number;
  enabled: boolean;
  isPenalty?: boolean;
}

export type RewardConfig = RewardItem[];

// User-facing entity shapes (what we save with a schedule and edit in the UI).
// IDs are not part of these — they are generated automatically before sending
// to the backend (see lib/api.ts).

export interface Group {
  name: string;
  level: number;
  gender: 'female' | 'male';
  availability_bitmask: number[];
  location_bitmask?: number[];
}

export interface Trainer {
  name: string;
  groupID: string; // value is the group's name; resolved to a real ID at send-time
  ladiesRank: number;
  gentsRank: number;
  capacity: number; // max groups this trainer can be assigned to coach
  availability_bitmask: number[];
  // Day preference for player-trainers. Both or neither ticked = no preference.
  // Required turns the preference into a hard constraint instead of a reward.
  prefSameDay: boolean;
  prefDifferentDay: boolean;
  prefRequired: boolean;
}

export type DayPref = 'same' | 'different' | 'any';

// Normalise the two checkboxes: exactly one ticked → that one; both or neither → 'any'.
export function getDayPref(t: Pick<Trainer, 'prefSameDay' | 'prefDifferentDay'>): DayPref {
  const same = t.prefSameDay ?? true;
  const diff = t.prefDifferentDay ?? false;
  if (same && !diff) return 'same';
  if (diff && !same) return 'different';
  return 'any';
}

export interface Location {
  name: string;
  courts: number;
}

export interface TravelTime {
  from: string; // location name
  to: string;   // location name
  minutes: number;
}

// Internal type used by ScheduleGrid and derived from Location[].
// Not stored directly — computed via expandLocations().
export interface Court {
  courtName: string;
  location: string;
}

export interface Timeslot {
  day: string;
  start: string;
  finish: string;
  location_bitmask?: number[];
}

export interface ScheduleData {
  groups: Group[];
  trainers: Trainer[];
  locations: Location[];
  timeslots: Timeslot[];
  travelTimes: TravelTime[];
}

export interface ScheduleEntry {
  group: string;
  trainer: string;
  court: string;
  timeslot: number; // matches the auto-generated timeslot id (its position)
}

export interface JobStats {
  solutions_found: number;
  current_score: number | null;
  final_score: number | null;
  best_bound: number | null;
  absolute_gap: number | null;
  gap_percent: number | null;
  optimal: boolean | null;
  elapsed_seconds: number | null;
  error: string | null;
  issues: string[] | null;
  // Why the solver stopped: 'optimal' | 'time_limit' | 'cancelled' | 'infeasible' | 'error'
  stopped_reason?: string | null;
  // The solver's configured max solve time (seconds), sent once solving starts.
  time_limit_seconds?: number | null;
}

export interface JobStatus {
  job_id: string;
  status: 'pending' | 'processing' | 'solving' | 'completed' | 'failed' | 'cancelled';
  stats: JobStats;
  result: ScheduleEntry[] | null;
  rewardConfig?: RewardConfig;
}

// A saved .doubleshift file, as listed by the backend. The file name is the schedule name.
export interface ScheduleSummary {
  path: string;
  name: string;
  modified_at: string;
}

// What a .doubleshift file holds. Each part is null until it has first been saved.
export interface ScheduleContents {
  data: ScheduleData | null;
  reward_config: RewardConfig | null;
  last_run: JobStatus | null;
}

export type SavedSchedule = ScheduleSummary & ScheduleContents;

export interface VerifyResult {
  feasible: boolean;
  score: number | null;
  best_bound: number | null;
  absolute_gap: number | null;
  gap_percent: number | null;
  violations: string[];
}

// Expand Location[] into Court[] for use in ScheduleGrid and API calls.
export function expandLocations(locations: Location[]): Court[] {
  return locations.flatMap(loc =>
    Array.from({ length: loc.courts }, (_, i) => ({
      courtName: `${loc.name} ${i + 1}`,
      location: loc.name,
    }))
  );
}
