import { RewardSetting, ScheduleData, ScheduleSettings, expandLocations, slotRunsOn, slotsOverlap } from './types';

// Every reward the solver supports (the keys must match REWARD_KEYS in the backend's
// constraints.py), in default priority order; onByDefault marks those a new schedule starts
// with. These are the only default points: the backend has none and requires all of them.
// The penalty's points are subtracted.
export const REWARDS = [
  {
    key: 'REWARD_SAME_DAY',
    label: 'Same Day',
    description: "Puts all of a trainer's sessions on one day, so they only need to come in once. This counts the sessions they train and their own group's session.",
    defaultPoints: 10_000,
    onByDefault: true,
  },
  {
    key: 'REWARD_NO_TRAVEL',
    label: 'No Travel',
    description: 'Keeps a trainer at one location for the whole day.',
    defaultPoints: 100,
    usesLocations: true,
    onByDefault: true,
  },
  {
    key: 'PENALTY_WAIT_TIME',
    label: 'Minimise Wait Time',
    description: "Keeps a trainer's sessions close together. Counts every minute a trainer waits between sessions on the same day.",
    defaultPoints: 100,
    isPenalty: true,
    perMinute: true,
    onByDefault: true,
  },
  {
    key: 'PENALTY_GROUP_RULES',
    label: 'Group Rules',
    description: "Follows your preferred group rules. Counts every minute a group's members would miss of a session they want to attend, including travel time.",
    defaultPoints: 100,
    isPenalty: true,
    perMinute: true,
    usesGroupRules: true,
  },
  {
    key: 'PENALTY_ADJ_BLOCKED',
    label: 'Free to Fill In',
    description: 'Keeps a trainer free while the group one level above their own trains, so they can fill in if needed.',
    defaultPoints: 10_000,
    isPenalty: true,
    usesLevels: true,
  },
  {
    key: 'REWARD_ADJ_GROUP_B2B',
    label: 'Adjacent Groups Back-to-Back',
    description: 'Puts groups one level apart in sessions straight after each other.',
    defaultPoints: 5_000,
    usesLevels: true,
  },
  {
    key: 'REWARD_ADJ_GROUP_SAME_DAY',
    label: 'Adjacent Groups Same Day',
    description: 'Puts groups one level apart on the same day.',
    defaultPoints: 1_000,
    usesLevels: true,
  },
  {
    key: 'REWARD_SAME_GENDER_B2B',
    label: 'Same Gender Back-to-Back',
    description: 'Keeps sessions for the same gender together in a space, so equipment and setup stay the same between sessions.',
    defaultPoints: 1,
    usesGender: true,
  },
];

// A reward's name as shown to the user.
export function rewardLabel(key: string): string {
  return REWARDS.find(r => r.key === key)?.label ?? key;
}

// The choices for Max Solve Time (the backend accepts 10 seconds to 1 hour).
export const SOLVE_TIME_OPTIONS = [
  { seconds: 30, label: '30 seconds' },
  { seconds: 60, label: '1 minute' },
  { seconds: 120, label: '2 minutes' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 600, label: '10 minutes' },
  { seconds: 1800, label: '30 minutes' },
  { seconds: 3600, label: '60 minutes' },
];

// The Max Solve Time choice closest to `seconds` (files saved before the choices existed
// can hold any value).
function nearestSolveTime(seconds: number): number {
  return SOLVE_TIME_OPTIONS.reduce((best, o) =>
    Math.abs(o.seconds - seconds) < Math.abs(best - seconds) ? o.seconds : best, SOLVE_TIME_OPTIONS[0].seconds);
}

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

// Fill in anything missing from saved settings (e.g. a reward added since it was saved),
// keeping the saved order of the rewards it does have.
export function withDefaults(saved: Partial<ScheduleSettings> | null | undefined): ScheduleSettings {
  const savedRewards = (saved?.rewards ?? []).filter(r => REWARDS.some(def => def.key === r.key));
  const missing = DEFAULT_SETTINGS.rewards.filter(def => !savedRewards.some(r => r.key === def.key));
  const rewardMode = saved?.rewardMode === 'points' || saved?.rewardMode === 'hierarchical'
    ? saved.rewardMode
    : DEFAULT_SETTINGS.rewardMode;
  const maxSolveSeconds = nearestSolveTime(saved?.maxSolveSeconds ?? DEFAULT_SETTINGS.maxSolveSeconds);
  return { ...DEFAULT_SETTINGS, ...saved, maxSolveSeconds, rewardMode, rewards: [...savedRewards, ...missing] };
}

// Why a reward can't apply to this schedule, or null if it can. Gender-based rewards
// need gendered groups, and No Travel needs more than one location to travel between.
export function unavailableReason(settings: ScheduleSettings, data: ScheduleData | null, reward: RewardSetting): string | null {
  const def = REWARDS.find(r => r.key === reward.key);
  if (def?.usesGender && !settings.genderedTeams) return 'Needs Gendered Groups';
  if (def?.usesLocations && (data?.locations.length ?? 0) < 2) return 'Needs two or more locations';
  if (def?.usesGroupRules && !settings.groupRules) return 'Needs Group Rules';
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
      // A trainer with no level saved (e.g. in an older file) counts as level 1.
      femaleLevel: t.femaleLevel ?? 1,
      maleLevel: settings.genderedTeams ? t.maleLevel ?? 1 : 0,
    })),
  };
}

// Space names are in use when Name Spaces is on, and always with space-specific timeslots
// (where they're required, so the spaces are easy to tell apart).
export function spacesNamed(settings: ScheduleSettings): boolean {
  return settings.nameSpaces || settings.spaceTimeslots;
}

// Problems with space names that block a run: with space-specific timeslots every space
// needs a name, and names must be unique within a location.
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

// Timeslots whose times overlap on the same space. A space can't run two sessions at once,
// so overlapping timeslots must be on different spaces; these block a run.
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
