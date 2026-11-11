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
  rewardMode: 'points' | 'hierarchical';
  rewards: RewardSetting[];  // list order is the priority order in hierarchical mode
}

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
  groupID: string; // the group they play in ("Player Group"): its name, resolved to an ID at send-time
  trainingGroups?: string[]; // names of the groups they coach, when trainers are assigned to groups
  ladiesRank: number;
  gentsRank: number;
  capacity: number; // max groups this trainer can be assigned to coach
  availability_bitmask: number[];
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

// Expand Location[] into Court[] for use in ScheduleGrid and API calls.
export function expandLocations(locations: Location[]): Court[] {
  return locations.flatMap(loc =>
    Array.from({ length: loc.courts }, (_, i) => ({
      courtName: `${loc.name} ${i + 1}`,
      location: loc.name,
    }))
  );
}
