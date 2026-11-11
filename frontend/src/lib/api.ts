import {
  ScheduleData, JobStatus, ScheduleEntry, VerifyResult, ScheduleSettings, expandLocations,
  ScheduleSummary, ScheduleContents, SavedSchedule,
} from './types';
import { applySettings, rankedRewards, rewardsPayload } from './settings';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_API_URL ?? 'http://localhost:8000';

// Prepare data for the solver: apply the settings (see applySettings), auto-generate
// IDs, expand locations → courts, and resolve group names (Player Group, Training
// Groups) → IDs.
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
  const courts    = expandLocations(data.locations ?? []);

  const travel_times = (data.travelTimes ?? []).map(tt => ({
    from_venue: tt.from,
    to_venue:   tt.to,
    minutes:    tt.minutes,
  }));

  const location_names = (data.locations ?? []).map(l => l.name);

  return { groups, trainers, timeslots, courts, travel_times, location_names, assign_trainers: settings.assignTrainers };
}

export async function startOptimization(data: ScheduleData, settings: ScheduleSettings): Promise<{ job_id: string }> {
  const payload = {
    ...withIDs(data, settings),
    reward_config: rewardsPayload(settings, data),
    max_solve_seconds: settings.maxSolveSeconds,
    reward_mode: settings.rewardMode,
    reward_order: rankedRewards(settings, data).map(r => r.key),
  };
  const res = await fetch(`${API_BASE}/api/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${API_BASE}/api/status/${jobId}`);
  if (!res.ok) throw new Error(`Status ${res.status}`);
  return res.json();
}

export async function cancelOptimization(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/cancel/${jobId}`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
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
  const res = await fetch(`${API_BASE}/api/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// --- Saved schedules (.doubleshift files, identified by their path) ---

// Throw the backend's error message (its `detail`) rather than raw JSON.
async function throwError(res: Response): Promise<never> {
  const body = await res.json().catch(() => null);
  throw new Error(body?.detail ?? res.statusText);
}

export async function listSchedules(): Promise<{ folder: string; schedules: ScheduleSummary[] }> {
  const res = await fetch(`${API_BASE}/api/schedules`);
  if (!res.ok) await throwError(res);
  return res.json();
}

export async function listRecentSchedules(): Promise<ScheduleSummary[]> {
  const res = await fetch(`${API_BASE}/api/recent`);
  if (!res.ok) await throwError(res);
  return res.json();
}

export async function createSchedule(name: string): Promise<ScheduleSummary> {
  const res = await fetch(`${API_BASE}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) await throwError(res);
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
  const res = await fetch(`${API_BASE}/api/schedules/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name.replace(/\.doubleshift$/i, ''), file: parsed }),
  });
  if (!res.ok) await throwError(res);
  return res.json();
}

// Returns null if the file doesn't exist. Also marks it as recently opened.
export async function getSchedule(path: string): Promise<SavedSchedule | null> {
  const res = await fetch(`${API_BASE}/api/schedule?path=${encodeURIComponent(path)}`);
  if (res.status === 404) return null;
  if (!res.ok) await throwError(res);
  return res.json();
}

export async function saveSchedule(path: string, contents: ScheduleContents): Promise<void> {
  const res = await fetch(`${API_BASE}/api/schedule?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contents),
  });
  if (!res.ok) await throwError(res);
}
