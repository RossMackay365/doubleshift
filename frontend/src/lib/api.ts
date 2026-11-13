import {
  ScheduleData, JobStatus, ScheduleEntry, VerifyResult, ScheduleSettings, expandLocations,
  ScheduleSummary, ScheduleContents, SavedSchedule,
} from './types';
import { applySettings, rankedRewards, rewardsPayload } from './settings';

// The backend serves the app, so API calls go to the same origin. Only `npm run dev`
// (a separate server) needs NEXT_PUBLIC_BACKEND_API_URL to point at the backend.
const API_BASE = process.env.NEXT_PUBLIC_BACKEND_API_URL ?? '';

// Prepare data for the solver: apply the settings (see applySettings), auto-generate
// IDs, expand locations into spaces, and resolve group names (Member Of, Training
// Groups) into IDs.
function withIDs(rawData: ScheduleData, settings: ScheduleSettings) {
  const data = applySettings(rawData, settings);
  const groups = data.groups.map((g, i) => ({ ...g, groupID: `g${i}` }));
  const nameToGroupID = new Map(groups.map(g => [g.name, g.groupID]));

  const trainers = data.trainers.map((t, i) => ({
    ...t,
    trainerID: `t${i}`,
    groupID: nameToGroupID.get(t.groupID) ?? '',
    assigned_groups: settings.assignTrainers
      ? (t.trainingGroups ?? []).flatMap(name => nameToGroupID.get(name) ?? [])
      : [],
  }));

  const timeslots = data.timeslots.map((s, i) => ({ ...s, id: i }));
  const spaces    = expandLocations(data.locations ?? []);

  const travel_times = (data.travelTimes ?? []).map(tt => ({
    from_venue: tt.from,
    to_venue:   tt.to,
    minutes:    tt.minutes,
  }));

  const location_names = (data.locations ?? []).map(l => l.name);

  // Group rules with groups on both sides (rules being filled in may not have yet).
  const group_rules = (data.groupRules ?? [])
    .map(r => ({
      ...r,
      groups:  r.groups.flatMap(name => nameToGroupID.get(name) ?? []),
      against: r.against.flatMap(name => nameToGroupID.get(name) ?? []),
    }))
    .filter(r => r.groups.length > 0 && r.against.length > 0);

  return {
    groups, trainers, timeslots, spaces, travel_times, location_names, group_rules,
    assign_trainers: settings.assignTrainers,
  };
}

// Sends a request to the backend. Failures throw an Error whose message is written for the
// user: the backend's own message (its `detail`) when it has one.
async function request(path: string, init?: RequestInit, allow404 = false): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new Error("DoubleShift can't reach its scheduler right now. Please close the app, open it again and retry.");
  }
  if (!res.ok && !(allow404 && res.status === 404)) await throwError(res);
  return res;
}

async function throwError(res: Response): Promise<never> {
  const body = await res.json().catch(() => null);
  if (typeof body?.detail === 'string') throw new Error(body.detail);
  // The backend rejected the data's shape (it lists the fields, which wouldn't help here).
  if (res.status === 422) throw new Error("Some of your data isn't filled in the way the scheduler expects. Please check the Data page and try again.");
  throw new Error('Something went wrong. Please try again.');
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export async function startSolve(data: ScheduleData, settings: ScheduleSettings): Promise<{ job_id: string }> {
  const payload = {
    ...withIDs(data, settings),
    reward_config: rewardsPayload(settings, data),
    max_solve_seconds: settings.maxSolveSeconds,
    reward_mode: settings.rewardMode,
    reward_order: rankedRewards(settings, data).map(r => r.key),
  };
  const res = await request('/api/solve', json('POST', payload));
  return res.json();
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const res = await request(`/api/status/${jobId}`);
  return res.json();
}

export async function cancelSolve(jobId: string): Promise<void> {
  await request(`/api/cancel/${jobId}`, { method: 'POST' });
}

export async function verifySchedule(
  data: ScheduleData,
  schedule: ScheduleEntry[],
  settings: ScheduleSettings,
): Promise<VerifyResult> {
  const payload = {
    ...withIDs(data, settings),
    schedule,
    reward_config: rewardsPayload(settings, data),
  };
  const res = await request('/api/verify', json('POST', payload));
  return res.json();
}

// --- Saved schedules (.doubleshift files, identified by their path) ---

export async function listSchedules(): Promise<{ folder: string; schedules: ScheduleSummary[] }> {
  const res = await request('/api/schedules');
  return res.json();
}

export async function listRecentSchedules(): Promise<ScheduleSummary[]> {
  const res = await request('/api/recent');
  return res.json();
}

export async function createSchedule(name: string): Promise<ScheduleSummary> {
  const res = await request('/api/schedules', json('POST', { name }));
  return res.json();
}

// Copies a .doubleshift file chosen in the browser into the schedules folder.
export async function importSchedule(file: File): Promise<ScheduleSummary> {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('This file is not a DoubleShift schedule.');
  }
  const res = await request('/api/schedules/import', json('POST', { name: file.name.replace(/\.doubleshift$/i, ''), file: parsed }));
  return res.json();
}

// Returns null if the file doesn't exist. Also marks it as recently opened.
export async function getSchedule(path: string): Promise<SavedSchedule | null> {
  const res = await request(`/api/schedule?path=${encodeURIComponent(path)}`, undefined, true);
  if (res.status === 404) return null;
  return res.json();
}

export async function saveSchedule(path: string, contents: ScheduleContents): Promise<void> {
  await request(`/api/schedule?path=${encodeURIComponent(path)}`, json('PUT', contents));
}
