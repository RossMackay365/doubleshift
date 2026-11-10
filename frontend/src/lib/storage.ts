import { ScheduleData, JobStatus, RewardConfig } from './types';
import { DEFAULT_REWARD_CONFIG, mergeWithDefaults } from './rewardConfig';

const KEY = 'schedule_optimiser';

export function saveData(data: ScheduleData): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function loadData(): ScheduleData | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const JOB_KEY = 'schedule_optimiser_job';

export function saveJobStatus(status: JobStatus | null): void {
  if (typeof window === 'undefined') return;
  if (status === null) {
    localStorage.removeItem(JOB_KEY);
  } else {
    localStorage.setItem(JOB_KEY, JSON.stringify(status));
  }
}

export function loadJobStatus(): JobStatus | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(JOB_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const REWARD_CONFIG_KEY = 'schedule_optimiser_rewards';

export function saveRewardConfig(config: RewardConfig): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(REWARD_CONFIG_KEY, JSON.stringify(config));
}

export function loadRewardConfig(): RewardConfig {
  if (typeof window === 'undefined') return DEFAULT_REWARD_CONFIG;
  const raw = localStorage.getItem(REWARD_CONFIG_KEY);
  if (!raw) return DEFAULT_REWARD_CONFIG;
  try {
    return mergeWithDefaults(JSON.parse(raw));
  } catch {
    return DEFAULT_REWARD_CONFIG;
  }
}

export function parseBitmask(s: string): number[] {
  if (!s.trim()) return [];
  if (s.includes(',')) return s.split(',').map(v => (parseInt(v.trim(), 10) || 0));
  if (s.includes(' ')) return s.split(/\s+/).map(v => (parseInt(v, 10) || 0));
  return s.split('').map(v => (parseInt(v, 10) || 0));
}
