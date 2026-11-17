import { RewardSetting, ScheduleData, ScheduleSettings, TrainerMode, expandLocations, slotRunsOn, slotsOverlap } from './types';

// Every reward counts something you'd rather avoid (a penalty), and the scheduler minimises it.
// A reward's label says what it aims for. Every reward starts switched on; one that needs a setting or data the schedule doesn't have is unavailable
// (see unavailableReasons) and isn't used, but keeps its switch for when it becomes available.
export const REWARDS = [
  {
    key: 'PENALTY_EXTRA_DAYS',
    label: 'Minimise Days',
    description: "Counts each extra day a trainer has sessions on, after their first. This includes the sessions they train and their own group's sessions.",
    defaultPoints: 10_000,
    usesTrainers: true,
  },
  {
    key: 'PENALTY_TRAVEL_DAYS',
    label: 'Minimise Travel',
    description: "Counts each day a trainer has sessions at more than one location. This includes the sessions they train and their own group's sessions.",
    defaultPoints: 100,
    usesTrainers: true,
    usesLocations: true,
  },
  {
    key: 'PENALTY_WAIT_TIME',
    label: 'Minimise Wait Time',
    description: "Counts each minute a trainer waits between sessions on the same day. This includes the sessions they train and their own group's sessions.",
    defaultPoints: 100,
    perMinute: true,
    usesTrainers: true,
  },
  {
    key: 'PENALTY_GROUP_RULES',
    label: 'Group Rules',
    description: "Counts each minute a group's members would miss of a session they want to attend. This covers your preferred group rules and includes travel time.",
    defaultPoints: 100,
    perMinute: true,
    usesGroupRules: true,
  },
  {
    key: 'PENALTY_ADJ_BLOCKED',
    label: 'Trainer Available to Sub in Higher Group',
    description: "Counts each time a trainer can't attend the session of the group one level above their own, because they are training another group at that time.",
    defaultPoints: 10_000,
    usesTrainers: true,
    usesSubstitutions: true,
  },
  {
    key: 'PENALTY_ADJ_NOT_B2B',
    label: 'Adjacent Groups Back-to-Back',
    description: 'Counts each pair of groups one level apart that never train straight after each other at the same location.',
    defaultPoints: 5_000,
    usesSubstitutions: true,
  },
  {
    key: 'PENALTY_ADJ_NOT_SAME_DAY',
    label: 'Adjacent Groups Same Day',
    description: "Counts each pair of groups one level apart that never train on the same day at the same location. Sessions at the same time don't count.",
    defaultPoints: 1_000,
    usesSubstitutions: true,
  },
  {
    key: 'PENALTY_GENDER_CHANGES',
    label: 'Same Gender Back-to-Back',
    description: 'Counts each time a session follows one for the other gender in the same space. This is useful when you want to avoid equipment or setup changes between sessions.',
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
  trainers: true,
  substitutions: false,
  trainerMode: 'chosen',
  multipleSessions: false,
  sessionsSameDay: false,
  sessionsSameTrainer: true,
  genderedTeams: false,
  spaceTimeslots: false,
  nameSpaces: false,
  groupRules: false,
  rewardMode: 'hierarchical',
  rewards: REWARDS.map(r => ({ key: r.key, enabled: true, points: r.defaultPoints })),
};

export const TRAINER_MODES: { value: TrainerMode; label: string }[] = [
  { value: 'assigned', label: 'Manual' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'chosen', label: 'Automatic (Level-Based)' },
];

// Complete Any Missing Settings with Defaults
// Rewards that were replaced by a penalty. A saved one keeps its switch, points and place.
const REPLACED_REWARDS: Record<string, string> = {
  REWARD_SAME_DAY: 'PENALTY_EXTRA_DAYS',                // Same Day -> Minimise Days
  REWARD_NO_TRAVEL: 'PENALTY_TRAVEL_DAYS',              // No Travel -> Minimise Travel
  REWARD_SAME_GENDER_B2B: 'PENALTY_GENDER_CHANGES',     // counted gender repeats, now changes
  REWARD_ADJ_GROUP_B2B: 'PENALTY_ADJ_NOT_B2B',          // counted times met, now pairs that never meet
  REWARD_ADJ_GROUP_SAME_DAY: 'PENALTY_ADJ_NOT_SAME_DAY',
};

type SavedSettings = Partial<ScheduleSettings> & { assignTrainers?: boolean };

export function withDefaults(savedSettings: SavedSettings | null | undefined): ScheduleSettings {
  // Schedules saved before trainer modes had an Assign Trainers to Groups switch instead.
  const { assignTrainers, ...saved } = savedSettings ?? {};
  const oldTrainerMode = assignTrainers ? { trainerMode: 'assigned' as const } : {};
  const savedRewards = (saved.rewards ?? [])
    .map(r => ({ ...r, key: REPLACED_REWARDS[r.key] ?? r.key }))
    .filter(r => REWARDS.some(def => def.key === r.key));
  const missing = DEFAULT_SETTINGS.rewards.filter(def => !savedRewards.some(r => r.key === def.key));
  const rewardMode = saved.rewardMode === 'points' || saved.rewardMode === 'hierarchical'
    ? saved.rewardMode
    : DEFAULT_SETTINGS.rewardMode;
  // Schedules saved before the Substitutions setting keep any substitution reward they had on.
  const oldSubstitutions = savedSettings && saved.substitutions === undefined
    ? { substitutions: savedRewards.some(r => r.enabled && rewardDef(r.key)?.usesSubstitutions) }
    : {};
  return { ...DEFAULT_SETTINGS, ...oldTrainerMode, ...oldSubstitutions, ...saved, rewardMode, rewards: [...savedRewards, ...missing] };
}

export function rewardDef(key: string) {
  return REWARDS.find(r => r.key === key);
}

// What a reward needs that the schedule doesn't have (empty when it's available).
export function unavailableReasons(settings: ScheduleSettings, data: ScheduleData | null, reward: RewardSetting): string[] {
  const def = rewardDef(reward.key);
  return [
    def?.usesTrainers && !settings.trainers && 'Needs Trainers',
    def?.usesSubstitutions && !settings.substitutions && 'Needs Substitutions',
    def?.usesGender && !settings.genderedTeams && 'Needs Gendered Groups',
    def?.usesLocations && (data?.locations.length ?? 0) < 2 && 'Needs two or more locations',
    def?.usesGroupRules && !settings.groupRules && 'Needs Group Rules',
  ].filter((reason): reason is string => !!reason);
}

export function isRewardActive(settings: ScheduleSettings, data: ScheduleData | null, reward: RewardSetting): boolean {
  return reward.enabled && unavailableReasons(settings, data, reward).length === 0;
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

export function solverTrainerMode(settings: ScheduleSettings): TrainerMode {
  return settings.trainers ? settings.trainerMode : 'assigned';
}

export function levelsInUse(settings: ScheduleSettings, data: ScheduleData | null): boolean {
  return solverTrainerMode(settings) !== 'assigned' || settings.rewards.some(
    r => rewardDef(r.key)?.usesSubstitutions && isRewardActive(settings, data, r),
  );
}

// The data as the solver sees it under these settings. The saved data is never changed,
// so switching a setting back restores the values the user entered.
// - Groups not gendered: every group is treated as female and trainers use only their
//   female level (the single "Level" column).
// - Levels not in use: every group is level 1.
// - No trainers: each group gets a placeholder trainer of its own, named after it, who is
//   always available. One shared placeholder wouldn't do, as a trainer is only ever in one
//   place at a time. The pages hide these trainers.
// - Multiple sessions off: every group has one session.
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
      level: useLevels ? g.level ?? 1 : 1,
      sessions: settings.multipleSessions ? Math.max(1, g.sessions ?? 1) : 1,
    })),
    trainers: !settings.trainers ? data.groups.map(g => ({
      name: g.name,
      groupID: '',
      trainingGroups: [g.name],
      femaleLevel: 1,
      maleLevel: 1,
      capacity: 1,
      availability_bitmask: data.timeslots.map(() => 1),
    })) : data.trainers.map(t => ({
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

// What's wrong with the groups' levels, while levels are in use: any that are missing,
// and rewards that need two groups one level apart when there are none.
export function levelProblems(data: ScheduleData, settings: ScheduleSettings): string[] {
  if (!levelsInUse(settings, data)) return [];
  const missing = data.groups.filter(g => g.level === undefined).map(g => g.name);
  if (missing.length > 0) return [`Enter a level for ${missing.join(', ')} on the Groups tab.`];

  const levelRewards = rankedRewards(settings, data)
    .filter(r => rewardDef(r.key)?.usesSubstitutions)
    .map(r => rewardLabel(r.key));
  if (levelRewards.length === 0) return [];
  const { groups } = applySettings(data, settings);
  const anyOneApart = groups.some(a => groups.some(b => a.gender === b.gender && (a.level ?? 1) - (b.level ?? 1) === 1));
  if (anyOneApart) return [];
  const one = levelRewards.length === 1;
  return [
    `${new Intl.ListFormat('en-GB').format(levelRewards)} ${one ? 'needs' : 'need'} two groups one level apart${settings.genderedTeams ? ' with the same gender' : ''}. `
    + `Change your groups' levels on the Groups tab, or switch off ${one ? 'this reward' : 'these rewards'} or Substitutions in Scheduler Settings.`,
  ];
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
