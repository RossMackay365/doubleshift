// A schedule's Scheduler Settings (see lib/settings.ts for defaults and reward details).
export interface RewardSetting {
  key: string;
  enabled: boolean;
  points: number;
}

export interface ScheduleSettings {
  maxSolveSeconds: number;
  assignTrainers: boolean;   // trainers are assigned to their groups rather than allocated by the solver
  genderedTeams: boolean;
  spaceTimeslots: boolean;   // timeslots are chosen per space rather than per location
  nameSpaces: boolean;       // spaces have names (always on with space-specific timeslots)
  groupRules: boolean;       // the Group Rules tab and reward
  rewardMode: 'points' | 'hierarchical';
  rewards: RewardSetting[];  // list order is the priority order in hierarchical mode
}

// User-facing entity shapes (what we save with a schedule and edit in the UI).
// IDs are not part of these: they are generated automatically before sending
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
  groupID: string; // the group they are a member of ("Member Of"): its name, resolved to an ID at send-time
  trainingGroups?: string[]; // names of the groups they train, when trainers are assigned to groups
  femaleLevel: number;
  maleLevel: number;
  capacity: number; // max groups this trainer can train
  availability_bitmask: number[];
}

export interface Location {
  name: string;
  spaces: number;
  spaceNames?: string[]; // optional name per space (Name Spaces setting); blank = its number
}

export interface TravelTime {
  from: string; // location name
  to: string;   // location name
  minutes: number;
}

// Internal type used by ScheduleGrid and derived from Location[].
// Not stored directly: computed via expandLocations().
export interface Space {
  spaceName: string; // identity used everywhere: "<location> <name or number>", e.g. "Club A Show Space"
  label: string;     // for display: the space's name, or "Space 3" when unnamed
  location: string;
}

export interface Timeslot {
  day: string;
  start: string;
  finish: string;
  location_bitmask?: number[];
  spaces?: string[]; // space-specific timeslots: names of the spaces it runs on (empty = all)
}

// A rule from the Group Rules tab. 'notAtSameTime': each group in `groups` shouldn't clash
// with each group in `against` (e.g. so one group's members can attend another group's session).
// Groups are referenced by name. `type` leaves room for other kinds of rule later.
export interface GroupRule {
  type: 'notAtSameTime';
  groups: string[];
  against: string[];
  required: boolean; // must hold; otherwise penalised per minute (Group Rules reward)
}

export interface ScheduleData {
  groups: Group[];
  trainers: Trainer[];
  locations: Location[];
  timeslots: Timeslot[];
  travelTimes: TravelTime[];
  groupRules?: GroupRule[];
}

export interface ScheduleEntry {
  group: string;
  trainer: string;
  space: string;
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
  // Hierarchical mode, while running: which reward is being optimised (stage of stage_count).
  stage?: number | null;
  stage_count?: number | null;
  stage_name?: string | null;
  // How often each reward was achieved (or penalty incurred): { REWARD_KEY: count }.
  reward_counts?: Record<string, number> | null;
}

export interface JobStatus {
  job_id: string;
  status: 'pending' | 'processing' | 'solving' | 'completed' | 'failed' | 'cancelled';
  stats: JobStats;
  result: ScheduleEntry[] | null;
  settings?: ScheduleSettings; // the settings the run used, for scoring and verifying it later
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
  settings: ScheduleSettings | null;
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
  reward_counts?: Record<string, number> | null;
}

// Expand Location[] into Space[] for use in ScheduleGrid and API calls.
// A space's name only needs to be unique within its location, because its identity
// includes the location. Unnamed spaces keep their number ("Club A 3").
export function expandLocations(locations: Location[]): Space[] {
  return locations.flatMap(loc =>
    Array.from({ length: loc.spaces }, (_, i) => {
      const name = loc.spaceNames?.[i]?.trim();
      return {
        spaceName: `${loc.name} ${name || i + 1}`,
        label: name || `Space ${i + 1}`,
        location: loc.name,
      };
    })
  );
}

// --- Timeslot helpers (mirroring the backend's constraints.py) ---

// "HH:MM" -> minutes since midnight (0 if not a valid time).
export function toMinutes(hhmm: string): number {
  const [h, m] = (hhmm ?? '').split(':').map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? 0 : h * 60 + m;
}

// Two timeslots overlap when they're on the same day and their times overlap.
export function slotsOverlap(a: Timeslot, b: Timeslot): boolean {
  return a.day === b.day && toMinutes(a.start) < toMinutes(b.finish) && toMinutes(b.start) < toMinutes(a.finish);
}

// Whether a timeslot runs on a space: limited by space name (space-specific timeslots) or
// by location (location_bitmask, indexed like locationNames). Unlimited runs everywhere.
export function slotRunsOn(slot: Timeslot, space: Space, locationNames: string[]): boolean {
  if (slot.spaces?.length) return slot.spaces.includes(space.spaceName);
  const bit = slot.location_bitmask?.[locationNames.indexOf(space.location)];
  return bit === undefined || bit === 1;
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// Day names in weekday order, Monday first ("Tue", "Tuesday" and "tuesday" all count).
// Names that aren't weekdays come after, in the order given.
export function sortDays(days: string[]): string[] {
  const rank = (day: string) => {
    const i = WEEKDAYS.indexOf(day.trim().slice(0, 3).toLowerCase());
    return i === -1 ? WEEKDAYS.length : i;
  };
  return [...days].sort((a, b) => rank(a) - rank(b));
}

// Minutes of the `other` session someone attending all of their `own` session would miss:
// they can't get there until their own session ends plus travel, and must leave in time to
// travel back for its start; 0 on different days. Mirrors missed_minutes in constraints.py.
export function missedMinutes(own: Timeslot, ownVenue: string, other: Timeslot, otherVenue: string, travelTimes: TravelTime[]): number {
  if (own.day !== other.day) return 0;
  const travel = ownVenue === otherVenue ? 0 : travelTimes.find(t =>
    (t.from === ownVenue && t.to === otherVenue) || (t.from === otherVenue && t.to === ownVenue))?.minutes ?? 0;
  const busyFrom  = toMinutes(own.start) - travel;
  const busyUntil = toMinutes(own.finish) + travel;
  return Math.max(0, Math.min(toMinutes(other.finish), busyUntil) - Math.max(toMinutes(other.start), busyFrom));
}
