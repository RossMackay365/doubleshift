import { RewardSetting, ScheduleData, ScheduleSettings } from './types';

// Every reward the solver supports (the keys must match REWARD_KEYS in the backend's
// constraints.py), in default priority order. These are the only default points: the
// backend has none and requires all of them. The penalty's points are subtracted.
export const REWARDS = [
  {
    key: 'REWARD_B2B',
    label: 'Back-to-Back',
    description: 'A player-trainer coaches right before or after their own session.',
    defaultPoints: 10_000,
  },
  {
    key: 'PENALTY_ADJ_BLOCKED',
    label: 'Trainer Cannot Sub Up',
    description: 'Penalises a player-trainer coaching while the group one level above theirs is training, since they then can\'t fill in for it.',
    defaultPoints: 10_000,
    isPenalty: true,
    usesLevels: true,
  },
  {
    key: 'REWARD_ADJ_GROUP_B2B',
    label: 'Adjacent Groups Back-to-Back',
    description: 'Groups one level apart train in consecutive sessions.',
    defaultPoints: 5_000,
    usesLevels: true,
  },
  {
    key: 'REWARD_ADJ_GROUP_SAME_DAY',
    label: 'Adjacent Groups Same Day',
    description: 'Groups one level apart train on the same day.',
    defaultPoints: 1_000,
    usesLevels: true,
  },
  {
    key: 'REWARD_NO_TRAVEL',
    label: 'No Travel',
    description: 'A trainer stays at one location for the whole day.',
    defaultPoints: 100,
    usesLocations: true,
  },
  {
    key: 'REWARD_NET_HEIGHT',
    label: 'No Net Height Changes',
    description: 'Consecutive sessions on the same court are for groups of the same gender, so the net needs no adjusting.',
    defaultPoints: 1,
    usesGender: true,
  },
];

export const MIN_SOLVE_SECONDS = 10;
export const MAX_SOLVE_SECONDS = 60 * 60;

export const DEFAULT_SETTINGS: ScheduleSettings = {
  maxSolveSeconds: 120,
  assignTrainers: false,
  genderedTeams: true,
  rewardMode: 'points',
  rewards: REWARDS.map(r => ({ key: r.key, enabled: true, points: r.defaultPoints })),
};

// Fill in anything missing from saved settings (e.g. a reward added since it was saved),
// keeping the saved order of the rewards it does have.
export function withDefaults(saved: Partial<ScheduleSettings> | null | undefined): ScheduleSettings {
  const savedRewards = (saved?.rewards ?? []).filter(r => REWARDS.some(def => def.key === r.key));
  const missing = DEFAULT_SETTINGS.rewards.filter(def => !savedRewards.some(r => r.key === def.key));
  const rewardMode = saved?.rewardMode === 'hierarchical' ? 'hierarchical' : 'points';
  return { ...DEFAULT_SETTINGS, ...saved, rewardMode, rewards: [...savedRewards, ...missing] };
}

// Why a reward can't apply to this schedule, or null if it can. Gender-based rewards
// need gendered teams, and No Travel needs more than one location to travel between.
export function unavailableReason(settings: ScheduleSettings, data: ScheduleData | null, reward: RewardSetting): string | null {
  const def = REWARDS.find(r => r.key === reward.key);
  if (def?.usesGender && !settings.genderedTeams) return 'Needs Gendered Teams';
  if (def?.usesLocations && (data?.locations.length ?? 0) < 2) return 'Needs 2+ locations';
  return null;
}

// Rewards that can't apply are always stored as switched off, so one that becomes
// available again (e.g. a second location is added) starts in Off, never In Use.
// Returns the same object when nothing needs changing.
export function withUnavailableOff(settings: ScheduleSettings, data: ScheduleData | null): ScheduleSettings {
  const switchOff = (r: RewardSetting) => r.enabled && unavailableReason(settings, data, r) !== null;
  if (!settings.rewards.some(switchOff)) return settings;
  return { ...settings, rewards: settings.rewards.map(r => (switchOff(r) ? { ...r, enabled: false } : r)) };
}

// A reward counts only if it's switched on and can apply to this schedule.
export function isRewardActive(settings: ScheduleSettings, data: ScheduleData | null, reward: RewardSetting): boolean {
  return reward.enabled && unavailableReason(settings, data, reward) === null;
}

// Points the solver should use for a reward: 0 if it doesn't count.
export function rewardPoints(settings: ScheduleSettings, data: ScheduleData | null, key: string): number {
  const reward = settings.rewards.find(r => r.key === key);
  return reward && isRewardActive(settings, data, reward) ? reward.points : 0;
}

// The rewards that count, in priority order (the order the hierarchical solver uses).
export function rankedRewards(settings: ScheduleSettings, data: ScheduleData | null): RewardSetting[] {
  return settings.rewards.filter(r => isRewardActive(settings, data, r));
}

// The reward points as sent to the backend: { REWARD_KEY: points }.
export function rewardsPayload(settings: ScheduleSettings, data: ScheduleData): Record<string, number> {
  return Object.fromEntries(settings.rewards.map(r => [r.key, rewardPoints(settings, data, r.key)]));
}

// Group levels decide which trainers qualify for which groups, and are used by the
// level-based rewards. When trainers are assigned to groups and none of those rewards
// count, levels aren't needed at all (and the Level column is hidden).
export function levelsInUse(settings: ScheduleSettings, data: ScheduleData | null): boolean {
  return !settings.assignTrainers || settings.rewards.some(
    r => REWARDS.find(def => def.key === r.key)?.usesLevels && isRewardActive(settings, data, r),
  );
}

// The data as the solver sees it under these settings. The saved data is never changed,
// so switching a setting back restores the values the user entered.
// - Teams not gendered: every group is treated as female and trainers use only their
//   female level (the single "Level" column).
// - Levels not in use: every group is level 1.
export function applySettings(data: ScheduleData, settings: ScheduleSettings): ScheduleData {
  const useLevels = levelsInUse(settings, data);
  return {
    ...data,
    groups: data.groups.map(g => ({
      ...g,
      gender: settings.genderedTeams ? g.gender : 'female',
      level: useLevels ? g.level : 1,
    })),
    trainers: data.trainers.map(t => ({
      ...t,
      gentsRank: settings.genderedTeams ? t.gentsRank : 0,
    })),
  };
}
