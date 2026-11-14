import { RewardSetting, ScheduleData, ScheduleSettings, expandLocations, slotRunsOn, slotsOverlap } from './types';

export const REWARDS = [
  {
    key: 'REWARD_SAME_DAY',
    label: 'Same Day',
    description: "Gives a reward for each trainer whose sessions are all on one day. This counts the sessions they train and their own group's session.",
    defaultPoints: 10_000,
    onByDefault: true,
  },
  {
    key: 'REWARD_NO_TRAVEL',
    label: 'No Travel',
    description: 'Gives a reward for each day a trainer spends at one location. Only days when the trainer has two or more sessions count.',
    defaultPoints: 100,
    usesLocations: true,
    onByDefault: true,
  },
  {
    key: 'PENALTY_WAIT_TIME',
    label: 'Minimise Wait Time',
    description: "Applies a penalty for each minute a trainer waits between sessions on the same day. This counts the sessions they train and their own group's session.",
    defaultPoints: 100,
    isPenalty: true,
    perMinute: true,
    onByDefault: true,
  },
  {
    key: 'PENALTY_GROUP_RULES',
    label: 'Group Rules',
    description: "Applies a penalty for each minute a group's members would miss of a session they want to attend. This covers your preferred group rules and includes travel time.",
    defaultPoints: 100,
    isPenalty: true,
    perMinute: true,
    usesGroupRules: true,
  },
  {
    key: 'PENALTY_ADJ_BLOCKED',
    label: 'Available to Sub in Higher Group',
    description: "Applies a penalty each time a trainer can't attend the session of a group one level above their own, because they are training another group at that time.",
    defaultPoints: 10_000,
    isPenalty: true,
    usesLevels: true,
  },
  {
    key: 'REWARD_ADJ_GROUP_B2B',
    label: 'Adjacent Groups Back-to-Back',
    description: 'Gives a reward each time two groups one level apart train straight after each other at the same location.',
    defaultPoints: 5_000,
    usesLevels: true,
  },
  {
    key: 'REWARD_ADJ_GROUP_SAME_DAY',
    label: 'Adjacent Groups Same Day',
    description: "Gives a reward each time two groups one level apart train on the same day at the same location. Groups that train at the same time don't count.",
    defaultPoints: 1_000,
    usesLevels: true,
  },
  {
    key: 'REWARD_SAME_GENDER_B2B',
    label: 'Same Gender Back-to-Back',
    description: 'Gives a reward each time two sessions for the same gender follow each other in the same space. This is useful when you want to avoid equipment or setup changes between sessions.',
    defaultPoints: 1,
    usesGender: true,
  },
];

export function rewardLabel(key: string): string {
  return REWARDS.find(r => r.key === key)?.label ?? key;
}

export const SOLVE_TIME_OPTIONS = [
  { seconds: 30, label: '30 seconds' },
  { seconds: 60, label: '1 minute' },
  { seconds: 120, label: '2 minutes' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 600, label: '10 minutes' },
  { seconds: 1800, label: '30 minutes' },
  { seconds: 3600, label: '60 minutes' },
];

export const DEFAULT_SETTINGS: ScheduleSettings = {
  maxSolveSeconds: 120,
  assignTrainers: false,
  genderedTeams: false,
  spaceTimeslots: false,
  nameSpaces: false,
  groupRules: false,
  rewardMode: 'hierarchical',
  rewards: REWARDS.map(r => ({ key: r.key, enabled: !!r.onByDefault, points: r.defaultPoints })),
};

// Complete Any Missing Settings with Defaults
export function withDefaults(saved: Partial<ScheduleSettings> | null | undefined): ScheduleSettings {
  const savedRewards = (saved?.rewards ?? []).filter(r => REWARDS.some(def => def.key === r.key));
  const missing = DEFAULT_SETTINGS.rewards.filter(def => !savedRewards.some(r => r.key === def.key));
  const rewardMode = saved?.rewardMode === 'points' || saved?.rewardMode === 'hierarchical'
    ? saved.rewardMode
    : DEFAULT_SETTINGS.rewardMode;
  return { ...DEFAULT_SETTINGS, ...saved, rewardMode, rewards: [...savedRewards, ...missing] };
}

// Provide Reason for Unavailable Reward
export function unavailableReason(settings: ScheduleSettings, data: ScheduleData | null, reward: RewardSetting): string | null {
  const def = REWARDS.find(r => r.key === reward.key);
  if (def?.usesGender && !settings.genderedTeams) return 'Needs Gendered Groups';
  if (def?.usesLocations && (data?.locations.length ?? 0) < 2) return 'Needs two or more locations';
  if (def?.usesGroupRules && !settings.groupRules) return 'Needs Group Rules';
  return null;
}

// Ensures Rewards That Become Available Default to Off
export function withUnavailableOff(settings: ScheduleSettings, data: ScheduleData | null): ScheduleSettings {
  const switchOff = (r: RewardSetting) => r.enabled && unavailableReason(settings, data, r) !== null;
  if (!settings.rewards.some(switchOff)) return settings;
  return { ...settings, rewards: settings.rewards.map(r => (switchOff(r) ? { ...r, enabled: false } : r)) };
}

export function isRewardActive(settings: ScheduleSettings, data: ScheduleData | null, reward: RewardSetting): boolean {
  return reward.enabled && unavailableReason(settings, data, reward) === null;
}

export function rewardPoints(settings: ScheduleSettings, data: ScheduleData | null, key: string): number {
  const reward = settings.rewards.find(r => r.key === key);
  return reward && isRewardActive(settings, data, reward) ? reward.points : 0;
}

export function rankedRewards(settings: ScheduleSettings, data: ScheduleData | null): RewardSetting[] {
  return settings.rewards.filter(r => isRewardActive(settings, data, r));
}

export function rewardsPayload(settings: ScheduleSettings, data: ScheduleData): Record<string, number> {
  return Object.fromEntries(settings.rewards.map(r => [r.key, rewardPoints(settings, data, r.key)]));
}

export function levelsInUse(settings: ScheduleSettings, data: ScheduleData | null): boolean {
  return !settings.assignTrainers || settings.rewards.some(
    r => REWARDS.find(def => def.key === r.key)?.usesLevels && isRewardActive(settings, data, r),
  );
}

// The data as the solver sees it under these settings. The saved data is never changed,
// so switching a setting back restores the values the user entered.
// - Groups not gendered: every group is treated as female and trainers use only their
//   female level (the single "Level" column).
// - Levels not in use: every group is level 1.
// - Timeslots are limited by space (space-specific timeslots) or by location, not both.
// - Spaces not named: space names are ignored, so spaces are numbered.
export function applySettings(data: ScheduleData, settings: ScheduleSettings): ScheduleData {
  const useLevels = levelsInUse(settings, data);
  return {
    ...data,
    locations: data.locations.map(l => (spacesNamed(settings) ? l : { ...l, spaceNames: undefined })),
    groupRules: settings.groupRules ? data.groupRules : undefined,
    timeslots: data.timeslots.map(t => (settings.spaceTimeslots
      ? { ...t, location_bitmask: undefined }
      : { ...t, spaces: undefined })),
    groups: data.groups.map(g => ({
      ...g,
      gender: settings.genderedTeams ? g.gender : 'female',
      level: useLevels ? g.level : 1,
    })),
    trainers: data.trainers.map(t => ({
      ...t,
      // A trainer with no level saved counts as level 1.
      femaleLevel: t.femaleLevel ?? 1,
      maleLevel: settings.genderedTeams ? t.maleLevel ?? 1 : 0,
    })),
  };
}

export function spacesNamed(settings: ScheduleSettings): boolean {
  return settings.nameSpaces || settings.spaceTimeslots;
}

export function spaceNameProblems(data: ScheduleData, settings: ScheduleSettings): string[] {
  if (!spacesNamed(settings)) return [];
  const problems: string[] = [];
  for (const loc of data.locations) {
    const names = Array.from({ length: loc.spaces }, (_, i) => loc.spaceNames?.[i]?.trim() ?? '');
    const unnamed = names.filter(n => !n).length;
    if (settings.spaceTimeslots && unnamed > 0) {
      problems.push(`Name ${unnamed === 1 ? 'the space' : `the ${unnamed} spaces`} at ${loc.name} that ${unnamed === 1 ? "doesn't" : "don't"} have a name yet.`);
    }
    const duplicates = [...new Set(names.filter((n, i) => n && names.indexOf(n) !== i))];
    if (duplicates.length > 0) problems.push(`Give each space at ${loc.name} its own name. More than one is called ${duplicates.join(', ')}.`);
  }
  return problems;
}

export function timeslotClashes(data: ScheduleData, settings: ScheduleSettings): string[] {
  const { timeslots, locations } = applySettings(data, settings);
  const spaces = expandLocations(locations);
  const locationNames = locations.map(l => l.name);
  const clashes: string[] = [];
  timeslots.forEach((a, i) => {
    for (const b of timeslots.slice(i + 1)) {
      if (!slotsOverlap(a, b)) continue;
      const shared = spaces.filter(c => slotRunsOn(a, c, locationNames) && slotRunsOn(b, c, locationNames));
      if (shared.length > 0) {
        clashes.push(`${a.day} ${a.start}-${a.finish} and ${b.start}-${b.finish} overlap on ${shared.map(c => c.spaceName).join(', ')}`);
      }
    }
  });
  return clashes;
}
