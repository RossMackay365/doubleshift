import { ScheduleData, JobStatus, ScheduleEntry, VerifyResult, RewardConfig, expandLocations } from './types';
import { rewardConfigToPayload } from './rewardConfig';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_API_URL ?? 'http://localhost:8000';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('auth_token');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers as Record<string, string>, ...authHeaders() },
  });
  if (res.status === 401) {
    sessionStorage.removeItem('auth_token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  return res;
}

// Auto-generate IDs, expand locations → courts, resolve trainer.groupID name → ID.
function withIDs(data: ScheduleData) {
  const groups = data.groups.map((g, i) => ({ ...g, groupID: `g${i}` }));
  const nameToGroupID = new Map(groups.map(g => [g.name, g.groupID]));

  const trainers = data.trainers.map((t, i) => ({
    ...t,
    trainerID: `t${i}`,
    groupID: nameToGroupID.get(t.groupID) ?? '',
  }));

  const timeslots = data.timeslots.map((s, i) => ({ ...s, id: i }));
  const courts    = expandLocations(data.locations ?? []);

  const travel_times = (data.travelTimes ?? []).map(tt => ({
    from_venue: tt.from,
    to_venue:   tt.to,
    minutes:    tt.minutes,
  }));

  const location_names = (data.locations ?? []).map(l => l.name);

  return { groups, trainers, timeslots, courts, travel_times, location_names };
}

export async function login(password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error('Invalid password');
  const data = await res.json();
  return data.token;
}

export async function startOptimization(data: ScheduleData, rewardConfig?: RewardConfig): Promise<{ job_id: string }> {
  const payload = {
    ...withIDs(data),
    ...(rewardConfig ? { reward_config: rewardConfigToPayload(rewardConfig) } : {}),
  };
  const res = await fetchWithAuth(`${API_BASE}/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const res = await fetchWithAuth(`${API_BASE}/status/${jobId}`);
  if (!res.ok) throw new Error(`Status ${res.status}`);
  return res.json();
}

export async function cancelOptimization(jobId: string): Promise<void> {
  const res = await fetchWithAuth(`${API_BASE}/cancel/${jobId}`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
}

export async function verifySchedule(
  data: ScheduleData,
  schedule: ScheduleEntry[],
  rewardConfig?: RewardConfig,
): Promise<VerifyResult> {
  const prepared = withIDs(data);
  const payload = {
    ...prepared,
    schedule,
    ...(rewardConfig ? { reward_config: rewardConfigToPayload(rewardConfig) } : {}),
  };
  const res = await fetchWithAuth(`${API_BASE}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
