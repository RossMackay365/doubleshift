import { ScheduleData, ScheduleEntry, ScheduleSettings } from './types';
import { rewardPoints } from './settings';

export interface TrainerBreakdownItem {
  name: string;
  coachingGroups: string[];
  coachingSlots: string[];
  playingGroup: string;
  playingSlots: string[];
  b2bCount: number;
  total: number;
}

export interface ScoreBreakdown {
  trainerItems: TrainerBreakdownItem[];
  genderConsecCount: number;
  genderPossibleCount: number;
  noTravelDays: number;
  noTravelPossibleDays: number;
  noTravelMissed: string[];
  adjGroupB2bCount: number;
  adjGroupB2bPossible: number;
  adjGroupSameDayCount: number;
  adjGroupB2bPenaltyCount: number;
  adjGroupB2bPenaltyTrainers: string[];
}

export function computeScoreBreakdown(
  schedule: ScheduleEntry[],
  data: ScheduleData,
  settings: ScheduleSettings,
): ScoreBreakdown {
  const { timeslots, trainers, groups, locations } = data;
  const rB2b = rewardPoints(settings, data, 'REWARD_B2B');
  const slotsByDay = new Map<string, number[]>();
  timeslots.forEach((ts, i) => {
    if (!slotsByDay.has(ts.day)) slotsByDay.set(ts.day, []);
    slotsByDay.get(ts.day)!.push(i);
  });

  const label = (i: number) =>
    timeslots[i] ? `${timeslots[i].day} ${timeslots[i].start}` : `slot ${i}`;

  const groupGender = new Map(groups.map(g => [g.name, g.gender]));

  const trainerItems = trainers
    .map((trainer): TrainerBreakdownItem | null => {
      const coachingEntries = schedule.filter(e => e.trainer === trainer.name);
      if (coachingEntries.length === 0) return null;

      const coachingGroups = coachingEntries.map(e => e.group);
      const cIndices = coachingEntries.map(e => e.timeslot);

      const playingEntries = trainer.groupID
        ? schedule.filter(e => e.group === trainer.groupID)
        : [];
      const pIndices = playingEntries.map(e => e.timeslot);

      const cSet = new Set(cIndices);
      const pSet = new Set(pIndices);

      // Back-to-Back: coaching right before or after their own session (mirrors backend).
      let b2bCount = 0;
      for (const [, daySlots] of slotsByDay) {
        for (let i = 0; i < daySlots.length - 1; i++) {
          if (cSet.has(daySlots[i]) && pSet.has(daySlots[i + 1])) b2bCount++;
          if (pSet.has(daySlots[i]) && cSet.has(daySlots[i + 1])) b2bCount++;
        }
      }

      return {
        name: trainer.name,
        coachingGroups,
        coachingSlots: cIndices.map(label),
        playingGroup: trainer.groupID ?? '',
        playingSlots: pIndices.map(label),
        b2bCount,
        total: b2bCount * rB2b,
      };
    })
    .filter((x): x is TrainerBreakdownItem => x !== null);

  // Schedule-level: count per-court consecutive slot pairs where the same gender plays,
  // and total transitions where both slots have a group (the denominator).
  let genderConsecCount = 0;
  let genderPossibleCount = 0;
  for (const [, daySlots] of slotsByDay) {
    for (let i = 0; i < daySlots.length - 1; i++) {
      const s     = daySlots[i];
      const nextS = daySlots[i + 1];
      const entriesAt = schedule.filter(e => e.timeslot === s);
      for (const entry of entriesAt) {
        const gender = groupGender.get(entry.group);
        if (!gender) continue;
        const nextEntry = schedule.find(e => e.timeslot === nextS && e.court === entry.court);
        if (!nextEntry || !groupGender.get(nextEntry.group)) continue;
        genderPossibleCount++;
        if (groupGender.get(nextEntry.group) === gender) genderConsecCount++;
      }
    }
  }

  // No Travel reward: count (trainer, day) pairs where trainer is active
  // and all activities are at the same venue.
  let noTravelDays = 0;
  let noTravelPossibleDays = 0;
  const noTravelMissedSet = new Set<string>();

  const distinctVenues = new Set((locations ?? []).map(l => l.name));
  if (distinctVenues.size >= 2) {
    // court name → venue name
    const courtVenue = new Map<string, string>();
    for (const loc of locations ?? []) {
      for (let i = 1; i <= loc.courts; i++) {
        courtVenue.set(`${loc.name} ${i}`, loc.name);
      }
    }

    for (const trainer of trainers) {
      const coachEntries  = schedule.filter(e => e.trainer === trainer.name);
      const playingEntries = trainer.groupID
        ? schedule.filter(e => e.group === trainer.groupID)
        : [];
      const allEntries = [...coachEntries, ...playingEntries];
      if (allEntries.length === 0) continue;

      for (const [, daySlots] of slotsByDay) {
        const active = allEntries.filter(e => daySlots.includes(e.timeslot));
        if (active.length < 2) continue;  // 1 activity = no travel possible
        noTravelPossibleDays++;
        const venues = new Set(active.map(e => courtVenue.get(e.court) ?? '').filter(Boolean));
        if (venues.size <= 1) {
          noTravelDays++;
        } else {
          noTravelMissedSet.add(trainer.name);
        }
      }
    }
  }

  // Adjacent group back-to-back reward: same gender, adjacent level (±1),
  // consecutive slots on the same day, same venue.
  const multiLocation = distinctVenues.size >= 2;

  // court name → venue (reuse courtVenue if already built, otherwise build it)
  const courtVenueForAdj = distinctVenues.size >= 2
    ? (() => {
        const m = new Map<string, string>();
        for (const loc of locations ?? []) {
          for (let i = 1; i <= loc.courts; i++) m.set(`${loc.name} ${i}`, loc.name);
        }
        return m;
      })()
    : new Map<string, string>();

  // group name → { slotIdx, venue }
  const groupSchedule = new Map<string, { slotIdx: number; venue: string }>();
  for (const entry of schedule) {
    groupSchedule.set(entry.group, {
      slotIdx: entry.timeslot,
      venue: courtVenueForAdj.get(entry.court) ?? '',
    });
  }

  // coaching slot lookup: timeslot index -> trainer names
  const coachingAtSlot = new Map<number, string[]>();
  for (const entry of schedule) {
    if (!coachingAtSlot.has(entry.timeslot)) coachingAtSlot.set(entry.timeslot, []);
    coachingAtSlot.get(entry.timeslot)!.push(entry.trainer);
  }

  let adjGroupB2bCount = 0;
  let adjGroupB2bPossible = 0;
  let adjGroupSameDayCount = 0;
  let adjGroupB2bPenaltyCount = 0;
  const penaltyTrainersSet = new Set<string>();

  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const ga = groups[i], gb = groups[j];
      if (ga.gender !== gb.gender) continue;
      if (Math.abs(ga.level - gb.level) !== 1) continue;
      adjGroupB2bPossible++;
      const sa = groupSchedule.get(ga.name);
      const sb = groupSchedule.get(gb.name);
      if (!sa || !sb) continue;
      if (multiLocation && sa.venue !== sb.venue) continue;
      const dayA = timeslots[sa.slotIdx]?.day;
      const dayB = timeslots[sb.slotIdx]?.day;
      if (!dayA || dayA !== dayB) continue;
      if (sa.slotIdx === sb.slotIdx) continue;
      // Same day + same venue (different slots)
      adjGroupSameDayCount++;
      const daySlots = slotsByDay.get(dayA) ?? [];
      const idxA = daySlots.indexOf(sa.slotIdx);
      const idxB = daySlots.indexOf(sb.slotIdx);
      if (Math.abs(idxA - idxB) === 1) {
        adjGroupB2bCount++;
      }
      // Penalty: lower-level group's trainer coaching when higher-level group plays,
      // independent of B2B.
      if (ga.level < gb.level) {
        // ga is higher tier; check if gb's trainer coaches when ga plays
        const blockedNames = trainers
          .filter(t => t.groupID === gb.name)
          .map(t => t.name)
          .filter(name => (coachingAtSlot.get(sa.slotIdx) ?? []).includes(name));
        if (blockedNames.length > 0) {
          adjGroupB2bPenaltyCount++;
          blockedNames.forEach(name => penaltyTrainersSet.add(name));
        }
      } else {
        // gb is higher tier; check if ga's trainer coaches when gb plays
        const blockedNames = trainers
          .filter(t => t.groupID === ga.name)
          .map(t => t.name)
          .filter(name => (coachingAtSlot.get(sb.slotIdx) ?? []).includes(name));
        if (blockedNames.length > 0) {
          adjGroupB2bPenaltyCount++;
          blockedNames.forEach(name => penaltyTrainersSet.add(name));
        }
      }
    }
  }

  return {
    trainerItems,
    genderConsecCount,
    genderPossibleCount,
    noTravelDays,
    noTravelPossibleDays,
    noTravelMissed: [...noTravelMissedSet],
    adjGroupB2bCount,
    adjGroupB2bPossible,
    adjGroupSameDayCount,
    adjGroupB2bPenaltyCount,
    adjGroupB2bPenaltyTrainers: [...penaltyTrainersSet],
  };
}
