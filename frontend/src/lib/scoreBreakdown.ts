import { ScheduleData, ScheduleEntry, ScheduleSettings, slotsOverlap, toMinutes } from './types';
import { rewardPoints } from './settings';

export interface TrainerBreakdownItem {
  name: string;
  coachingGroups: string[];
  coachingSlots: string[];
  playingGroup: string;
  playingSlots: string[];
  days: string[];       // days with any activity (Same Day is met with 0 or 1)
  waitMinutes: number;  // minutes waited between sessions, summed over their days
  total: number;
}

export interface ScoreBreakdown {
  trainerItems: TrainerBreakdownItem[];
  trainerCount: number;
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

// Slots are compared by their actual times (toMinutes / slotsOverlap in types.ts, mirroring
// the backend's constraints.py), so timeslots can be entered in any order and can overlap
// on different courts.
export function computeScoreBreakdown(
  schedule: ScheduleEntry[],
  data: ScheduleData,
  settings: ScheduleSettings,
): ScoreBreakdown {
  const { timeslots, trainers, groups, locations } = data;
  const rSameDay = rewardPoints(settings, data, 'REWARD_SAME_DAY');
  const rWait    = rewardPoints(settings, data, 'PENALTY_WAIT_TIME');
  // Each day's slots, ordered by start time.
  const slotsByDay = new Map<string, number[]>();
  timeslots.forEach((ts, i) => {
    if (!slotsByDay.has(ts.day)) slotsByDay.set(ts.day, []);
    slotsByDay.get(ts.day)!.push(i);
  });
  for (const daySlots of slotsByDay.values()) {
    daySlots.sort((a, b) => toMinutes(timeslots[a].start) - toMinutes(timeslots[b].start));
  }
  // Consecutive = next by start time on the same day, and not overlapping.
  const consecutive: [number, number][] = [...slotsByDay.values()].flatMap(daySlots =>
    daySlots.slice(1)
      .map((next, i): [number, number] => [daySlots[i], next])
      .filter(([s, next]) => !slotsOverlap(timeslots[s], timeslots[next])),
  );
  // Each slot plus every slot overlapping it.
  const sameTime = timeslots.map((ts, i) =>
    timeslots.map((_, j) => j).filter(j => j === i || slotsOverlap(ts, timeslots[j])),
  );

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

      // Same Day and Wait Time, over all their activities (mirrors the backend).
      const active = [...new Set([...cIndices, ...pIndices])];
      const days = [...new Set(active.map(i => timeslots[i].day))];
      let waitMinutes = 0;
      for (const day of days) {
        const daySlots = active.filter(i => timeslots[i].day === day);
        if (daySlots.length < 2) continue;
        const first = Math.min(...daySlots.map(i => toMinutes(timeslots[i].start)));
        const last  = Math.max(...daySlots.map(i => toMinutes(timeslots[i].finish)));
        const busy  = daySlots.reduce((sum, i) => sum + toMinutes(timeslots[i].finish) - toMinutes(timeslots[i].start), 0);
        waitMinutes += Math.max(0, last - first - busy);
      }

      return {
        name: trainer.name,
        coachingGroups,
        coachingSlots: cIndices.map(label),
        playingGroup: trainer.groupID ?? '',
        playingSlots: pIndices.map(label),
        days,
        waitMinutes,
        total: (days.length <= 1 ? rSameDay : 0) - waitMinutes * rWait,
      };
    })
    .filter((x): x is TrainerBreakdownItem => x !== null);

  // Schedule-level: count per-court consecutive slot pairs where the same gender plays,
  // and total transitions where both slots have a group (the denominator).
  let genderConsecCount = 0;
  let genderPossibleCount = 0;
  for (const [s, nextS] of consecutive) {
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

      // Penalty: one per slot where a player-trainer from the lower-level group coaches
      // while the higher-level group plays (in that slot or an overlapping one), on any
      // day or venue (mirrors the backend). Level 1 is the highest.
      const [higher, lowerName] = ga.level < gb.level ? [sa, gb.name] : [sb, ga.name];
      const lowerMembers = trainers.filter(t => t.groupID === lowerName).map(t => t.name);
      for (const slot of sameTime[higher.slotIdx] ?? []) {
        const blocked = (coachingAtSlot.get(slot) ?? []).filter(name => lowerMembers.includes(name));
        if (blocked.length > 0) {
          adjGroupB2bPenaltyCount++;
          blocked.forEach(name => penaltyTrainersSet.add(name));
        }
      }

      // Same day (and same venue, when there are several), in different slots.
      if (multiLocation && sa.venue !== sb.venue) continue;
      const dayA = timeslots[sa.slotIdx]?.day;
      const dayB = timeslots[sb.slotIdx]?.day;
      if (!dayA || dayA !== dayB) continue;
      if (sa.slotIdx === sb.slotIdx) continue;
      adjGroupSameDayCount++;
      if (consecutive.some(([s, next]) =>
        (s === sa.slotIdx && next === sb.slotIdx) || (s === sb.slotIdx && next === sa.slotIdx))) {
        adjGroupB2bCount++;
      }
    }
  }

  return {
    trainerItems,
    trainerCount: trainers.length,
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
