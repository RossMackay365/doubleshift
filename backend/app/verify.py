from collections import defaultdict
from typing import Optional
from .transform import transform_data
from .constraints import (
    REWARD_KEYS, is_penalty, clashing_slot_pairs, consecutive_slot_pairs, group_slots_by_day,
    missed_minutes, parse_hhmm, slot_allows_space,
)


def verify_schedule(raw_data: dict, schedule_entries: list, rewards_cfg: dict, best_bound: Optional[float] = None) -> dict:
    """
    Validates a user-edited schedule against all hard constraints, computes the
    soft-constraint objective score, and returns an optimality gap if a best_bound
    is provided (from the original solver run).
    """
    data = transform_data(raw_data)

    raw      = data['raw']
    groups   = raw['groups']
    trainers = raw['trainers']
    spaces   = raw['spaces']
    timeslots = raw['timeslots']

    # Name-based lookups (schedule entries use display names, not internal IDs)
    group_name_to_gi   = {g['name']: i for i, g in enumerate(groups)}
    trainer_name_to_ti = {t['name']: i for i, t in enumerate(trainers)}
    space_name_to_ci   = {c['spaceName']: i for i, c in enumerate(spaces)}
    slot_id_to_si      = {s['id']: i for i, s in enumerate(timeslots)}
    trainer_keys       = list(data['indices']['t'].keys())  # trainer index -> trainer ID

    violations: list[str] = []

    # --- Parse and validate entry references ---
    parsed: list[tuple] = []  # (gi, ti, ci, si)
    for entry in schedule_entries:
        g_name = entry.get('group')
        t_name = entry.get('trainer')
        c_name = entry.get('space')
        s_id   = entry.get('timeslot')

        gi = group_name_to_gi.get(g_name)
        ti = trainer_name_to_ti.get(t_name)
        ci = space_name_to_ci.get(c_name)
        si = slot_id_to_si.get(s_id)

        # The data has changed since this schedule was made.
        if gi is None: violations.append(f'"{g_name}" is in the schedule but no longer in your groups.'); continue
        if ti is None: violations.append(f'"{t_name}" is in the schedule but no longer in your trainers.'); continue
        if ci is None: violations.append(f'"{c_name}" is in the schedule but no longer one of your spaces.'); continue
        if si is None: violations.append(f'"{g_name}" is in a timeslot that no longer exists.'); continue

        parsed.append((gi, ti, ci, si))

    if violations:
        return _result(feasible=False, violations=violations, score=None, best_bound=best_bound)

    quals    = data['quals']
    t_avail  = data['availability']['trainers']
    g_avail  = data['availability']['groups']
    members  = data['members']
    capacity = data['capacity']

    loc_names   = raw.get('location_names', [])
    loc_to_idx  = {name: i for i, name in enumerate(loc_names)}

    # --- Per-entry: availability, qualification, membership, location ---
    for gi, ti, ci, si in parsed:
        g_name     = groups[gi]['name']
        t_name     = trainers[ti]['name']
        slot       = timeslots[si]
        slot_label = f"{slot['day']} {slot['start']}-{slot['finish']}"

        if not t_avail[ti][si]:
            violations.append(f'"{t_name}" isn\'t available on {slot_label}.')
        if not g_avail[gi][si]:
            violations.append(f'"{g_name}" isn\'t available on {slot_label}.')
        if not quals[ti][gi]:
            if data.get('assign_trainers'):
                violations.append(
                    f'"{t_name}" isn\'t assigned to "{g_name}". Choose it as one of their '
                    f"Training Groups on the Data page first."
                )
            else:
                violations.append(f'"{t_name}" doesn\'t have the level to train "{g_name}".')
        t_key = trainer_keys[ti]
        if t_key in set(members.get(gi, [])):
            violations.append(f'"{t_name}" is a member of "{g_name}", so they can\'t train it.')

        # Timeslot and location restrictions
        if not slot_allows_space(slot, spaces[ci], loc_to_idx):
            violations.append(
                f'The {slot_label} timeslot doesn\'t run on "{spaces[ci]["spaceName"]}".'
            )
        venue   = spaces[ci].get('location', '') if spaces else ''
        loc_idx = loc_to_idx.get(venue)
        if loc_idx is not None:
            g_loc = groups[gi].get('location_bitmask', [])
            if g_loc and loc_idx < len(g_loc) and g_loc[loc_idx] == 0:
                violations.append(
                    f'"{g_name}" can\'t train at "{venue}". Its Locations don\'t include it.'
                )

    # --- Hard 1: Each group assigned exactly once ---
    group_sessions: dict = defaultdict(int)
    for gi, _, _, _ in parsed:
        group_sessions[gi] += 1

    for gi, group in enumerate(groups):
        count = group_sessions.get(gi, 0)
        if count == 0:
            violations.append(f'"{group["name"]}" doesn\'t have a session yet.')
        elif count > 1:
            violations.append(f'"{group["name"]}" has {count} sessions. Each group needs exactly one.')

    # --- Hard 2: At most one group per space per slot ---
    space_slot: dict = defaultdict(list)
    for gi, _, ci, si in parsed:
        space_slot[(ci, si)].append(groups[gi]['name'])

    for (ci, si), gnames in space_slot.items():
        if len(gnames) > 1:
            slot = timeslots[si]
            violations.append(
                f'"{spaces[ci]["spaceName"]}" has {len(gnames)} groups on '
                f"{slot['day']} {slot['start']}-{slot['finish']} ({', '.join(gnames)}). "
                f"A space holds one group at a time."
            )

    # Slots whose times overlap (e.g. 16:30-18:00 and 17:00-18:30) clash too.
    clashes = clashing_slot_pairs(timeslots)

    def when(si):
        slot = timeslots[si]
        return f"{slot['day']} {slot['start']}-{slot['finish']}"

    for s1, s2 in clashes:
        for ci in range(len(spaces)):
            for g1 in space_slot.get((ci, s1), []):
                for g2 in space_slot.get((ci, s2), []):
                    violations.append(
                        f'"{spaces[ci]["spaceName"]}" has two sessions that overlap: '
                        f'"{g1}" ({when(s1)}) and "{g2}" ({when(s2)}).'
                    )

    # --- Hard 3+4: Trainer capacity and per-slot conflict ---
    trainer_groups: dict = defaultdict(list)
    trainer_slot_groups: dict = defaultdict(list)
    for gi, ti, _, si in parsed:
        trainer_groups[ti].append(groups[gi]['name'])
        trainer_slot_groups[(ti, si)].append(groups[gi]['name'])

    for ti, gnames in trainer_groups.items():
        cap = capacity[ti]
        if len(gnames) > cap:
            violations.append(
                f'"{trainers[ti]["name"]}" trains {len(gnames)} groups ({", ".join(gnames)}), '
                f"but their capacity is {cap}."
            )

    for (ti, si), gnames in trainer_slot_groups.items():
        if len(gnames) > 1:
            slot = timeslots[si]
            violations.append(
                f'"{trainers[ti]["name"]}" trains more than one group on '
                f"{slot['day']} {slot['start']}-{slot['finish']}: {', '.join(gnames)}."
            )

    for s1, s2 in clashes:
        for ti in range(len(trainers)):
            for g1 in trainer_slot_groups.get((ti, s1), []):
                for g2 in trainer_slot_groups.get((ti, s2), []):
                    violations.append(
                        f'"{trainers[ti]["name"]}" trains two sessions that overlap: '
                        f'"{g1}" ({when(s1)}) and "{g2}" ({when(s2)}).'
                    )

    # --- Hard 5: Trainer can't play and coach at the same slot ---
    playing_slots: dict = defaultdict(set)   # ti -> {si, ...}
    coaching_slots: dict = defaultdict(set)  # ti -> {si, ...}

    for gi, _, _, si in parsed:
        for t_key in members.get(gi, []):
            if t_key in data['indices']['t']:
                ti2 = data['indices']['t'][t_key]
                playing_slots[ti2].add(si)

    for _, ti, _, si in parsed:
        coaching_slots[ti].add(si)

    for ti in range(len(trainers)):
        for si in playing_slots[ti] & coaching_slots[ti]:
            slot = timeslots[si]
            violations.append(
                f'"{trainers[ti]["name"]}" trains a session on '
                f"{slot['day']} {slot['start']}-{slot['finish']}, when their own group has its session."
            )
        for s1, s2 in clashes:
            for play_s, coach_s in ((s1, s2), (s2, s1)):
                if play_s in playing_slots[ti] and coach_s in coaching_slots[ti]:
                    violations.append(
                        f'"{trainers[ti]["name"]}" trains a session ({when(coach_s)}) that overlaps '
                        f"with their own group's session ({when(play_s)})."
                    )

    # --- Hard 6: Trainer travel time ---
    travel_minutes = data.get('travel_minutes', {})
    if travel_minutes:
        slots_by_day = group_slots_by_day(timeslots)

        # Build (trainer_index, slot_index) -> venue for coaching and playing
        trainer_slot_venue: dict = defaultdict(dict)
        for gi, ti, ci, si in parsed:
            venue = spaces[ci].get('location', '') if ci < len(spaces) else ''
            trainer_slot_venue[ti][si] = venue
        for gi, ti, ci, si in parsed:
            venue = spaces[ci].get('location', '') if ci < len(spaces) else ''
            for t_key in members.get(gi, []):
                if t_key in data['indices']['t']:
                    ti2 = data['indices']['t'][t_key]
                    trainer_slot_venue[ti2][si] = venue

        for ti in range(len(trainers)):
            slot_venue = trainer_slot_venue.get(ti, {})
            for day, day_slots in slots_by_day.items():
                active = [(si, slot_venue[si]) for si in day_slots if si in slot_venue]
                for k in range(len(active)):
                    for l in range(k + 1, len(active)):
                        s1, v1 = active[k]
                        s2, v2 = active[l]
                        if not v1 or not v2 or v1 == v2:
                            continue
                        travel = travel_minutes.get((v1, v2), 0)
                        if travel == 0:
                            continue
                        gap = parse_hhmm(timeslots[s2]['start']) - parse_hhmm(timeslots[s1]['finish'])
                        if 0 <= gap < travel:  # a negative gap is an overlap, reported above
                            violations.append(
                                f'"{trainers[ti]["name"]}" has {gap} minutes to get from "{v1}" to "{v2}" '
                                f"on {timeslots[s1]['day']} (between {timeslots[s1]['finish']} and "
                                f"{timeslots[s2]['start']}), but the trip takes {travel} minutes."
                            )

    # --- Hard 7: Required group rules ---
    placed = _group_placements(parsed)
    for gi, gj, required in data.get('group_rule_pairs', []):
        if not required:
            continue
        missed = _rule_missed_minutes(data, placed, gi, gj)
        if missed:
            violations.append(
                f'A required group rule isn\'t met: members of "{groups[gi]["name"]}" '
                f"({when(placed[gi][0])}) would miss {missed} minutes of "
                f'"{groups[gj]["name"]}" ({when(placed[gj][0])}).'
            )

    feasible = len(violations) == 0
    counts = _count_rewards(data, parsed) if feasible else None
    # Points-mode score: each reward's count times its points, with penalties subtracted.
    score = (
        sum((-1 if is_penalty(key) else 1) * rewards_cfg[key] * n for key, n in counts.items())
        if feasible else None
    )

    return _result(feasible=feasible, violations=violations, score=score, best_bound=best_bound,
                   reward_counts=counts)


def _count_rewards(data: dict, parsed: list) -> dict:
    """
    Counts how often each reward is achieved (or penalty incurred), mirroring the
    rewards in constraints.py: {reward key: count}.
    """
    raw = data['raw']
    timeslots = raw['timeslots']
    trainers  = raw['trainers']
    spaces    = raw['spaces']
    members   = data['members']

    slots_by_day = group_slots_by_day(timeslots)
    consecutive  = consecutive_slot_pairs(timeslots)

    coaching_slots: dict = defaultdict(set)
    playing_slots: dict  = defaultdict(set)

    for gi, ti, _, si in parsed:
        coaching_slots[ti].add(si)
        for t_key in members.get(gi, []):
            if t_key in data['indices']['t']:
                ti2 = data['indices']['t'][t_key]
                playing_slots[ti2].add(si)

    # Same Day reward and Wait Time penalty, per trainer over all their activities
    # (mirrors constraints.py).
    counts = {key: 0 for key in REWARD_KEYS}
    for ti in range(len(trainers)):
        active = coaching_slots[ti] | playing_slots[ti]
        days = {timeslots[si]['day'] for si in active}
        if len(days) <= 1:
            counts['REWARD_SAME_DAY'] += 1
        for day in days:
            day_slots = [si for si in active if timeslots[si]['day'] == day]
            if len(day_slots) < 2:
                continue
            starts   = [parse_hhmm(timeslots[si]['start'])  for si in day_slots]
            finishes = [parse_hhmm(timeslots[si]['finish']) for si in day_slots]
            busy = sum(f - st for st, f in zip(starts, finishes))
            counts['PENALTY_WAIT_TIME'] += max(0, max(finishes) - min(starts) - busy)

    # Same Gender Back-to-Back reward: per-space consecutive same-gender slots
    groups = raw['groups']
    groups_at_space_slot: dict = defaultdict(list)
    for gi, _, ci, si in parsed:
        groups_at_space_slot[(ci, si)].append(gi)

    num_c = len(spaces)
    for c in range(num_c):
        for s1, s2 in consecutive:
            gi_s1 = groups_at_space_slot.get((c, s1), [])
            gi_s2 = groups_at_space_slot.get((c, s2), [])
            if not gi_s1 or not gi_s2:
                continue
            for gender in ('female', 'male'):
                if (any(str(groups[gi].get('gender', '')).strip().lower() == gender for gi in gi_s1) and
                        any(str(groups[gi].get('gender', '')).strip().lower() == gender for gi in gi_s2)):
                    counts['REWARD_SAME_GENDER_B2B'] += 1

    # No Travel reward: +100 per trainer per day where all activities are at the same venue.
    # Mirrors constraints.py: fires only when trainer has structural access to 2+ venues that
    # day (venue_active >= 2 check) AND actually has 2+ active slots (1 activity = no travel).
    space_venue = data.get('space_venue', {})
    distinct_venues = {v for v in space_venue.values() if v}
    if len(distinct_venues) >= 2:
        quals        = data['quals']
        t_avail      = data['availability']['trainers']
        g_avail      = data['availability']['groups']
        trainer_keys = list(data['indices']['t'].keys())
        loc_to_idx   = data.get('location_to_idx', {})

        # Group spaces by venue for iteration.
        spaces_by_venue: dict = defaultdict(list)
        for ci, space in enumerate(spaces):
            v = space.get('location', '')
            if v:
                spaces_by_venue[v].append(ci)

        # Pre-compute per-(trainer, day) structural venue access: mirrors constraints.py's
        # venue_active dict. Trainers structurally limited to one venue never earn the reward.
        trainer_day_venues: dict = defaultdict(lambda: defaultdict(set))

        # Coaching paths: trainer qualifies for group, not a member, both available at slot.
        for gi in range(len(groups)):
            g_loc = groups[gi].get('location_bitmask', [])
            for ti in range(len(trainers)):
                if not quals[ti][gi]:
                    continue
                if trainer_keys[ti] in set(members.get(gi, [])):
                    continue
                for si, slot in enumerate(timeslots):
                    if not t_avail[ti][si] or not g_avail[gi][si]:
                        continue
                    day = slot['day']
                    for venue in spaces_by_venue:
                        if venue in trainer_day_venues[ti][day]:
                            continue
                        loc_idx = loc_to_idx.get(venue)
                        if loc_idx is not None and g_loc and loc_idx < len(g_loc) and g_loc[loc_idx] == 0:
                            continue
                        if not any(slot_allows_space(slot, spaces[ci], loc_to_idx) for ci in spaces_by_venue[venue]):
                            continue
                        trainer_day_venues[ti][day].add(venue)

        # Playing paths: trainer's group can be coached at a venue when the group is available
        # and the venue's location bitmask allows it.
        for gi, member_ids in members.items():
            if gi >= len(groups):
                continue
            g_loc = groups[gi].get('location_bitmask', [])
            for t_key in member_ids:
                if t_key not in data['indices']['t']:
                    continue
                ti2 = data['indices']['t'][t_key]
                for si, slot in enumerate(timeslots):
                    if not g_avail[gi][si]:
                        continue
                    day = slot['day']
                    for venue in spaces_by_venue:
                        if venue in trainer_day_venues[ti2][day]:
                            continue
                        loc_idx = loc_to_idx.get(venue)
                        if loc_idx is not None and g_loc and loc_idx < len(g_loc) and g_loc[loc_idx] == 0:
                            continue
                        if not any(slot_allows_space(slot, spaces[ci], loc_to_idx) for ci in spaces_by_venue[venue]):
                            continue
                        trainer_day_venues[ti2][day].add(venue)

        # Build actual venue assignments from the schedule.
        trainer_slot_venue: dict = defaultdict(dict)
        for gi, ti, ci, si in parsed:
            venue = spaces[ci].get('location', '') if ci < len(spaces) else ''
            trainer_slot_venue[ti][si] = venue
        for gi, ti, ci, si in parsed:
            venue = spaces[ci].get('location', '') if ci < len(spaces) else ''
            for t_key in members.get(gi, []):
                if t_key in data['indices']['t']:
                    ti2 = data['indices']['t'][t_key]
                    trainer_slot_venue[ti2][si] = venue

        for ti in range(len(trainers)):
            slot_venue = trainer_slot_venue.get(ti, {})
            for day, day_slots in slots_by_day.items():
                # Skip if trainer can't structurally access 2+ venues this day.
                if len(trainer_day_venues[ti].get(day, set())) < 2:
                    continue
                active_slots = [
                    si for si in day_slots if si in slot_venue and slot_venue[si]
                ]
                if len(active_slots) < 2:
                    continue
                active_venues = {slot_venue[si] for si in active_slots}
                if len(active_venues) == 1:
                    counts['REWARD_NO_TRAVEL'] += 1

    # Adjacent group rewards (B2B + same day) and the Available to Sub in Higher Group penalty, for pairs
    # of groups with the same gender and adjacent levels (+/-1). Mirrors constraints.py.
    multi_location = len({v for v in space_venue.values() if v}) >= 2
    group_slot: dict = {}   # gi -> si
    group_venue: dict = {}  # gi -> venue name
    for gi, _, ci, si in parsed:
        group_slot[gi] = si
        group_venue[gi] = spaces[ci].get('location', '') if ci < len(spaces) else ''

    consecutive_set = set(consecutive)
    same_time = {si: {si} for si in range(len(timeslots))}  # each slot plus those overlapping it
    for s1, s2 in clashing_slot_pairs(timeslots):
        same_time[s1].add(s2)
        same_time[s2].add(s1)

    for gi in range(len(groups)):
        gender_i = str(groups[gi].get('gender', '')).strip().lower()
        level_i  = int(groups[gi].get('level', 0))
        if gender_i not in ('female', 'male') or gi not in group_slot:
            continue
        for gj in range(gi + 1, len(groups)):
            gender_j = str(groups[gj].get('gender', '')).strip().lower()
            level_j  = int(groups[gj].get('level', 0))
            if gender_i != gender_j or abs(level_i - level_j) != 1 or gj not in group_slot:
                continue
            si_i, si_j = group_slot[gi], group_slot[gj]

            # Penalty: one per slot where a player-trainer from the lower-level group coaches
            # while the higher-level group plays (in that slot or an overlapping one).
            # Level 1 is the highest.
            higher_slot, lower_group = (si_i, gj) if level_i < level_j else (si_j, gi)
            member_coaching: set = set()
            for t_id in members.get(lower_group, []):
                if t_id in data['indices']['t']:
                    member_coaching |= coaching_slots[data['indices']['t'][t_id]]
            counts['PENALTY_ADJ_BLOCKED'] += len(member_coaching & same_time[higher_slot])

            # Same day (and same venue, when there are several), in different slots.
            if timeslots[si_i]['day'] != timeslots[si_j]['day'] or si_i == si_j:
                continue
            if multi_location and group_venue[gi] != group_venue[gj]:
                continue
            counts['REWARD_ADJ_GROUP_SAME_DAY'] += 1
            if (si_i, si_j) in consecutive_set or (si_j, si_i) in consecutive_set:
                counts['REWARD_ADJ_GROUP_B2B'] += 1

    # Group Rules penalty: minutes missed for preferred rules (mirrors constraints.py).
    placed = _group_placements(parsed)
    for gi, gj, required in data.get('group_rule_pairs', []):
        if not required:
            counts['PENALTY_GROUP_RULES'] += _rule_missed_minutes(data, placed, gi, gj)

    return counts


def _group_placements(parsed: list) -> dict:
    """Each scheduled group's (slot, space)."""
    return {gi: (si, ci) for gi, _, ci, si in parsed}


def _rule_missed_minutes(data: dict, placed: dict, gi: int, gj: int) -> int:
    """Minutes of group gj's session that group gi would miss (0 if either isn't scheduled)."""
    if gi not in placed or gj not in placed:
        return 0
    (si, ci), (sj, cj) = placed[gi], placed[gj]
    timeslots, space_venue = data['raw']['timeslots'], data['space_venue']
    return missed_minutes(timeslots[si], space_venue.get(ci, ''), timeslots[sj], space_venue.get(cj, ''),
                          data.get('travel_minutes', {}))


def _result(
    feasible: bool,
    violations: list,
    score: Optional[float],
    best_bound: Optional[float],
    reward_counts: Optional[dict] = None,
) -> dict:
    absolute_gap: Optional[float] = None
    gap_percent: Optional[float]  = None

    if score is not None and best_bound is not None:
        absolute_gap = round(best_bound - score, 4)
        gap_percent  = round((absolute_gap / best_bound) * 100, 2) if best_bound != 0 else 0.0

    return {
        'feasible':     feasible,
        'score':        score,
        'best_bound':   best_bound,
        'absolute_gap': absolute_gap,
        'gap_percent':  gap_percent,
        'violations':   violations,
        'reward_counts': reward_counts,
    }
