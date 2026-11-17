import { ScheduleData, ScheduleEntry, ScheduleSettings, expandLocations, missedMinutes, slotsOverlap, toMinutes } from './types';
import { rewardPoints } from './settings';

export interface TrainerBreakdownItem {
  name: string;
  coachingGroups: string[];
  coachingSlots: string[];
  playingGroup: string;
  playingSlots: string[];
  days: string[];       // days with any activity (each one after the first is an extra day)
  waitMinutes: number;  // minutes waited between sessions, summed over their days
  total: number;        // penalty points from Minimise Days and Minimise Wait Time
}

export interface ScoreBreakdown {
  trainerItems: TrainerBreakdownItem[];
  genderChanges: number;       // a session following one for the other gender in a space
  genderPossibleCount: number; // sessions that follow another in a space
  travelDays: number;       // days a trainer has sessions at more than one location, over all trainers
  travelTrainers: string[]; // who has such a day
  adjPairCount: number;       // pairs of groups one level apart (with the same gender)
  adjNotB2b: string[];        // the pairs that never train back-to-back ("A and B")
  adjNotSameDay: string[];    // the pairs that never train on the same day
  adjBlockedCount: number;    // times a trainer can't sub in the group above their own
  adjBlockedTrainers: string[];
  // Preferred group rules broken: [own group, group it avoids conflicts with] and the
  // minutes of the latter's session the former would miss.
  groupRuleClashes: { groups: [string, string]; minutes: number }[];
}

// Slots are compared by their actual times (toMinutes / slotsOverlap in types.ts, mirroring
// the backend's constraints.py), so timeslots can be entered in any order and can overlap
// on different spaces.
export function computeScoreBreakdown(
  schedule: ScheduleEntry[],
  data: ScheduleData,
  settings: ScheduleSettings,
): ScoreBreakdown {
  const { timeslots, trainers, groups, locations } = data;
  const rDays    = rewardPoints(settings, data, 'PENALTY_EXTRA_DAYS');
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
  const levelOf = (g: ScheduleData['groups'][number]) => g.level ?? 1; // always set once the settings are applied

  const trainerItems = trainers
    .map((trainer): TrainerBreakdownItem | null => {
      const coachingEntries = schedule.filter(e => e.trainer === trainer.name);
      const playingEntries = trainer.groupID
        ? schedule.filter(e => e.group === trainer.groupID)
        : [];
      // A trainer who trains nobody still counts if their own group has sessions (which
      // can be on several days, with multiple sessions).
      if (coachingEntries.length === 0 && playingEntries.length === 0) return null;

      const coachingGroups = coachingEntries.map(e => e.group);
      const cIndices = coachingEntries.map(e => e.timeslot);
      const pIndices = playingEntries.map(e => e.timeslot);

      // Extra Days and Wait Time, over all their activities (mirrors the backend).
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
        total: Math.max(0, days.length - 1) * rDays + waitMinutes * rWait,
      };
    })
    .filter((x): x is TrainerBreakdownItem => x !== null);

  // Schedule-level: count per-space consecutive slot pairs where the gender changes, and
  // total transitions where both slots have a group (the denominator).
  let genderChanges = 0;
  let genderPossibleCount = 0;
  for (const [s, nextS] of consecutive) {
    const entriesAt = schedule.filter(e => e.timeslot === s);
    for (const entry of entriesAt) {
      const gender = groupGender.get(entry.group);
      if (!gender) continue;
      const nextEntry = schedule.find(e => e.timeslot === nextS && e.space === entry.space);
      if (!nextEntry || !groupGender.get(nextEntry.group)) continue;
      genderPossibleCount++;
      if (groupGender.get(nextEntry.group) !== gender) genderChanges++;
    }
  }

  // Travel penalty: each day a trainer's activities are at more than one venue.
  let travelDays = 0;
  const travelTrainers = new Set<string>();

  // Each space's location, keyed by the space's name as the schedule uses it (named or
  // numbered, see expandLocations).
  const spaceVenue = new Map(expandLocations(locations ?? []).map(c => [c.spaceName, c.location]));
  const distinctVenues = new Set((locations ?? []).map(l => l.name));
  if (distinctVenues.size >= 2) {
    for (const trainer of trainers) {
      const entries = [
        ...schedule.filter(e => e.trainer === trainer.name),
        ...(trainer.groupID ? schedule.filter(e => e.group === trainer.groupID) : []),
      ];
      for (const [, daySlots] of slotsByDay) {
        const venues = new Set(entries.filter(e => daySlots.includes(e.timeslot)).map(e => spaceVenue.get(e.space) ?? ''));
        if (venues.size >= 2) {
          travelDays++;
          travelTrainers.add(trainer.name);
        }
      }
    }
  }

  // Adjacent group back-to-back reward: same gender, adjacent level (+/-1),
  // consecutive slots on the same day, same venue.
  const multiLocation = distinctVenues.size >= 2;

  // group name -> its sessions' { slotIdx, venue }. Venues only matter when there are several.
  const groupSchedule = new Map<string, { slotIdx: number; venue: string }[]>();
  for (const entry of schedule) {
    if (!groupSchedule.has(entry.group)) groupSchedule.set(entry.group, []);
    groupSchedule.get(entry.group)!.push({
      slotIdx: entry.timeslot,
      venue: multiLocation ? spaceVenue.get(entry.space) ?? '' : '',
    });
  }

  // coaching slot lookup: timeslot index -> trainer names
  const coachingAtSlot = new Map<number, string[]>();
  for (const entry of schedule) {
    if (!coachingAtSlot.has(entry.timeslot)) coachingAtSlot.set(entry.timeslot, []);
    coachingAtSlot.get(entry.timeslot)!.push(entry.trainer);
  }

  let adjPairCount = 0;
  const adjNotB2b: string[] = [];
  const adjNotSameDay: string[] = [];
  let adjBlockedCount = 0;
  const blockedTrainers = new Set<string>();

  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const ga = groups[i], gb = groups[j];
      if (ga.gender !== gb.gender) continue;
      if (Math.abs(levelOf(ga) - levelOf(gb)) !== 1) continue;
      adjPairCount++;
      const sa = groupSchedule.get(ga.name);
      const sb = groupSchedule.get(gb.name);
      if (!sa || !sb) continue;

      // Penalty: one per slot where a trainer who is a member of the lower-level group trains
      // while the higher-level group has a session (in that slot or an overlapping one), on any
      // day or venue (mirrors the backend). Level 1 is the highest.
      const [higher, lowerName] = levelOf(ga) < levelOf(gb) ? [sa, gb.name] : [sb, ga.name];
      const lowerMembers = trainers.filter(t => t.groupID === lowerName).map(t => t.name);
      const higherTimes = new Set(higher.flatMap(session => sameTime[session.slotIdx] ?? []));
      for (const slot of higherTimes) {
        const blocked = (coachingAtSlot.get(slot) ?? []).filter(name => lowerMembers.includes(name));
        if (blocked.length > 0) {
          adjBlockedCount++;
          blocked.forEach(name => blockedTrainers.add(name));
        }
      }

      // Back-to-back: met when one group's session follows the other's at the same venue.
      const pair = `${ga.name} and ${gb.name}`;
      const b2b = sa.some(a => sb.some(b => a.venue === b.venue && consecutive.some(([s, next]) =>
        (s === a.slotIdx && next === b.slotIdx) || (s === b.slotIdx && next === a.slotIdx))));
      if (!b2b) adjNotB2b.push(pair);

      // Same day: met on a day and venue both groups train at, unless they share a slot there.
      const slotsA = slotsByDayAndVenue(sa, timeslots);
      const slotsB = slotsByDayAndVenue(sb, timeslots);
      const sameDay = [...slotsA].some(([dayVenue, slots]) => {
        const others = slotsB.get(dayVenue);
        return others && !slots.some(s => others.includes(s));
      });
      if (!sameDay) adjNotSameDay.push(pair);
    }
  }

  return {
    trainerItems,
    genderChanges,
    genderPossibleCount,
    travelDays,
    travelTrainers: [...travelTrainers],
    adjPairCount,
    adjNotB2b,
    adjNotSameDay,
    adjBlockedCount,
    adjBlockedTrainers: [...blockedTrainers],
    groupRuleClashes: groupRuleClashes(schedule, data),
  };
}

// A group's sessions as "day, venue" -> slots.
function slotsByDayAndVenue(sessions: { slotIdx: number; venue: string }[], timeslots: ScheduleData['timeslots']): Map<string, number[]> {
  const slots = new Map<string, number[]>();
  for (const { slotIdx, venue } of sessions) {
    const key = `${timeslots[slotIdx]?.day}
${venue}`;
    slots.set(key, [...(slots.get(key) ?? []), slotIdx]);
  }
  return slots;
}

// Preferred group rules broken by the schedule, each direction once (mirrors the backend:
// a direction counts as required if any rule requires it, and required ones aren't
// penalised, Verify reports them instead).
function groupRuleClashes(schedule: ScheduleEntry[], data: ScheduleData): ScoreBreakdown['groupRuleClashes'] {
  // Each (own group, group to avoid) direction once.
  const pairs = new Map<string, { groups: [string, string]; required: boolean }>();
  for (const rule of data.groupRules ?? []) {
    for (const a of rule.groups) {
      for (const b of rule.against) {
        if (a === b) continue;
        const groups: [string, string] = [a, b];
        const key = groups.join('\n');
        pairs.set(key, { groups, required: (pairs.get(key)?.required ?? false) || rule.required });
      }
    }
  }
  const spaceLocation = new Map(expandLocations(data.locations).map(c => [c.spaceName, c.location]));
  const clashes: ScoreBreakdown['groupRuleClashes'] = [];
  for (const { groups: [a, b], required } of pairs.values()) {
    if (required) continue;
    // Every session of one group against every session of the other.
    let minutes = 0;
    for (const ea of schedule.filter(e => e.group === a)) {
      for (const eb of schedule.filter(e => e.group === b)) {
        minutes += missedMinutes(
          data.timeslots[ea.timeslot], spaceLocation.get(ea.space) ?? '',
          data.timeslots[eb.timeslot], spaceLocation.get(eb.space) ?? '', data.travelTimes,
        );
      }
    }
    if (minutes > 0) clashes.push({ groups: [a, b], minutes });
  }
  return clashes;
}
