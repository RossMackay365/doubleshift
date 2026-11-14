import itertools

REWARD_KEYS = (
    'REWARD_SAME_DAY', 'PENALTY_WAIT_TIME', 'PENALTY_GROUP_RULES', 'REWARD_NO_TRAVEL', 'REWARD_SAME_GENDER_B2B',
    'REWARD_ADJ_GROUP_B2B', 'REWARD_ADJ_GROUP_SAME_DAY', 'PENALTY_ADJ_BLOCKED',
)


def is_penalty(key: str) -> bool:
    return key.startswith('PENALTY_')


def apply_constraints(model, x, data):
    """
    Applies Hard and Soft constraints to the CP-SAT model.

    Returns each reward's terms: {reward key: [var, ...]}. Each term is a BoolVar that is
    1 exactly when the reward is achieved once (or a penalty incurred once), except Wait
    Time and Group Rules, whose terms are minutes. A reward's total is the sum of its terms; the
    solver builds its objective from these (see solver.py).
    """
    num_g = len(data['indices']['g'])
    num_t = len(data['indices']['t'])
    num_c = len(data['indices']['c'])
    num_s = len(data['indices']['s'])

    space_venue    = data.get('space_venue', {})
    travel_minutes = data.get('travel_minutes', {})
    raw_timeslots  = data['raw']['timeslots']
    # Determine Clashing Timeslots
    clashes = clashing_slot_pairs(raw_timeslots)

    ### HARD CONSTRAINTS ###
    # 1. Group Coverage: each group gets exactly one session
    for g in range(num_g):
        group_vars = [x[g, t, c, s] for t in range(num_t) for c in range(num_c) for s in range(num_s) if (g, t, c, s) in x]
        model.AddExactlyOne(group_vars)

    # 2. Space Conflict: at most one group per space at any time
    for c in range(num_c):
        for s in range(num_s):
            model.AddAtMostOne(x[g, t, c, s] for g in range(num_g) for t in range(num_t) if (g, t, c, s) in x)
        for s1, s2 in clashes:
            model.AddAtMostOne(x[g, t, c, s] for g in range(num_g) for t in range(num_t) for s in (s1, s2) if (g, t, c, s) in x)

    # 3. Trainer Conflict: a trainer coaches at most one group at any time
    for t in range(num_t):
        for s in range(num_s):
            model.AddAtMostOne(x[g, t, c, s] for g in range(num_g) for c in range(num_c) if (g, t, c, s) in x)
        for s1, s2 in clashes:
            model.AddAtMostOne(x[g, t, c, s] for g in range(num_g) for c in range(num_c) for s in (s1, s2) if (g, t, c, s) in x)

    # 4. Trainer Capacity: total groups coached ≤ trainer's capacity
    for t in range(num_t):
        model.Add(sum(x[g, t, c, s] for g in range(num_g) for c in range(num_c) for s in range(num_s) if (g, t, c, s) in x) <= data['capacity'][t])

    # 5. Trainer Playing vs Coaching Conflict: never coaching while their own group plays
    for t_id, t_idx in data['indices']['t'].items():
        playing_groups = [g_idx for g_idx, m_ids in data['members'].items() if t_id in m_ids]

        def is_coaching(s):
            return sum(x[g, t_idx, c, s] for g in range(num_g) for c in range(num_c) if (g, t_idx, c, s) in x)

        def is_playing(s):
            return sum(x[gp, ot, oc, s] for gp in playing_groups for ot in range(num_t) for oc in range(num_c) if (gp, ot, oc, s) in x)

        for s in range(num_s):
            model.Add(is_coaching(s) + is_playing(s) <= 1)
        for s1, s2 in clashes:
            model.Add(is_coaching(s1) + is_playing(s2) <= 1)
            model.Add(is_playing(s1) + is_coaching(s2) <= 1)

    # 6. Trainer Travel Time: cannot be at venue V1 at slot S1 and venue V2 at slot S2
    #    if the gap between S1.finish and S2.start is less than travel_time(V1, V2).
    if travel_minutes:
        slots_by_day = group_slots_by_day(raw_timeslots)

        # Deduplicate venue pairs: travel_minutes stores both (A,B) and (B,A)
        seen = set()
        venue_pairs = []
        for (v1, v2) in travel_minutes:
            key = tuple(sorted([v1, v2]))
            if key not in seen:
                seen.add(key)
                venue_pairs.append((v1, v2))

        spaces_by_venue: dict = {}
        for ci, venue in space_venue.items():
            spaces_by_venue.setdefault(venue, []).append(ci)

        for t_id, t_idx in data['indices']['t'].items():
            playing_groups = [g_idx for g_idx, m_ids in data['members'].items() if t_id in m_ids]

            for day, day_slots in slots_by_day.items():
                for i, s1 in enumerate(day_slots):
                    for s2 in day_slots[i + 1:]:
                        ts1  = raw_timeslots[s1]
                        ts2  = raw_timeslots[s2]
                        gap  = parse_hhmm(ts2['start']) - parse_hhmm(ts1['finish'])

                        for v1, v2 in venue_pairs:
                            travel = travel_minutes.get((v1, v2), 0)
                            if travel == 0 or gap >= travel:
                                continue

                            cv1 = spaces_by_venue.get(v1, [])
                            cv2 = spaces_by_venue.get(v2, [])

                            # Trainer at v1 at s1, v2 at s2: both orderings
                            for src_v, src_c, src_s, dst_v, dst_c, dst_s in [
                                (v1, cv1, s1, v2, cv2, s2),
                                (v2, cv2, s1, v1, cv1, s2),
                            ]:
                                at_src = (
                                    [x[g, t_idx, c, src_s] for g in range(num_g) for c in src_c if (g, t_idx, c, src_s) in x] +
                                    [x[gp, ot, c, src_s] for gp in playing_groups for ot in range(num_t) for c in src_c if (gp, ot, c, src_s) in x]
                                )
                                at_dst = (
                                    [x[g, t_idx, c, dst_s] for g in range(num_g) for c in dst_c if (g, t_idx, c, dst_s) in x] +
                                    [x[gp, ot, c, dst_s] for gp in playing_groups for ot in range(num_t) for c in dst_c if (gp, ot, c, dst_s) in x]
                                )
                                if not at_src or not at_dst:
                                    continue
                                has_src = _any_true(model, at_src, f'hc_t{t_idx}_{src_v}_s{src_s}_to_{dst_v}_s{dst_s}')
                                has_dst = _any_true(model, at_dst, f'hc_t{t_idx}_{dst_v}_s{dst_s}_from_{src_v}_s{src_s}')
                                model.Add(has_src + has_dst <= 1)


    ### SOFT CONSTRAINTS (REWARDS & PENALTIES) ###
    rewards = {key: [] for key in REWARD_KEYS}
    slots_by_day = group_slots_by_day(raw_timeslots)
    consecutive  = consecutive_slot_pairs(raw_timeslots)

    # 7. Same Day Reward and Wait Time Penalty: Per trainer, over all their activities (coaching, and playing in their own group).
    #    - Same Day: one per trainer whose activities aren't spread over 2+ days. Trainers
    #      with 0 or 1 activities count too, so the reward never favours giving anyone more
    #      or fewer sessions.
    #    - Wait Time: per trainer per day, the minutes from their first start to their last
    #      finish that aren't spent in a session.
    for t_id, t_idx in data['indices']['t'].items():
        playing_groups = [g_idx for g_idx, m_ids in data['members'].items() if t_id in m_ids]

        # active[s]: the trainer coaches or plays in slot s (never both, see rules 3 and 5).
        active = {}
        for s in range(num_s):
            vars_ = (
                [x[g, t_idx, c, s] for g in range(num_g) for c in range(num_c) if (g, t_idx, c, s) in x] +
                [x[gp, ot, oc, s] for gp in playing_groups for ot in range(num_t) for oc in range(num_c) if (gp, ot, oc, s) in x]
            )
            if vars_:
                active[s] = _any_true(model, vars_, f't{t_idx}_active_s{s}')

        days_active = []
        for day, day_slots in slots_by_day.items():
            day_slots = [s for s in day_slots if s in active]
            if not day_slots:
                continue
            days_active.append(_any_true(model, [active[s] for s in day_slots], f't{t_idx}_on_{day}'))
            if len(day_slots) >= 2:
                rewards['PENALTY_WAIT_TIME'].append(
                    _wait_minutes(model, active, day_slots, raw_timeslots, f't{t_idx}_{day}'))

        if len(days_active) <= 1:
            rewards['REWARD_SAME_DAY'].append(model.NewConstant(1))  # can only ever be on one day
        else:
            single_day = model.NewBoolVar(f't{t_idx}_single_day')
            model.Add(sum(days_active) <= 1).OnlyEnforceIf(single_day)
            model.Add(sum(days_active) >= 2).OnlyEnforceIf(single_day.Not())
            rewards['REWARD_SAME_DAY'].append(single_day)

    # Same Gender Back-to-Back reward: +1 when the same gender has consecutive slots on a space
    raw_groups = data['raw']['groups']
    group_gender = {
        gi: str(g.get('gender', '')).strip().lower()
        for gi, g in enumerate(raw_groups)
        if str(g.get('gender', '')).strip().lower() in ('female', 'male')
    }
    for c in range(num_c):
        for s, next_s in consecutive:
            for gender in ('female', 'male'):
                gender_gi = [gi for gi, gen in group_gender.items() if gen == gender]

                vars_at_s    = [x[g, t, c, s]      for g in gender_gi for t in range(num_t) if (g, t, c, s)      in x]
                vars_at_next = [x[g, t, c, next_s] for g in gender_gi for t in range(num_t) if (g, t, c, next_s) in x]

                if not vars_at_s or not vars_at_next:
                    continue

                has_s    = _any_true(model, vars_at_s,    f'{gender}_c{c}_s{s}_to_{next_s}')
                has_next = _any_true(model, vars_at_next, f'{gender}_c{c}_s{next_s}_from_{s}')

                consec = model.NewBoolVar(f'{gender}_consec_c{c}_s{s}_{next_s}')
                model.AddMultiplicationEquality(consec, [has_s, has_next])
                rewards['REWARD_SAME_GENDER_B2B'].append(consec)

    # No Travel Reward: Per trainer per day where all activities are at the same venue.
    # Only applies when the trainer has possible activities in 2+ distinct slots on that day
    if space_venue and len(set(space_venue.values())) >= 2:
        spaces_by_venue: dict = {}
        for ci, venue in space_venue.items():
            spaces_by_venue.setdefault(venue, []).append(ci)
        all_venues = list(spaces_by_venue.keys())

        for t_id, t_idx in data['indices']['t'].items():
            playing_groups = [g_idx for g_idx, m_ids in data['members'].items() if t_id in m_ids]

            for day, day_slots in slots_by_day.items():
                venue_active: dict = {}
                day_all_activity = []
                possible_slots: set = set()

                for v in all_venues:
                    cv = spaces_by_venue[v]
                    v_slot_vars = []

                    for s in day_slots:
                        coaching_v_s = [x[g, t_idx, c, s] for g in range(num_g) for c in cv if (g, t_idx, c, s) in x]
                        playing_v_s  = [x[gp, ot, c, s] for gp in playing_groups for ot in range(num_t) for c in cv if (gp, ot, c, s) in x]
                        all_v_s = coaching_v_s + playing_v_s
                        if all_v_s:
                            here = _any_true(model, all_v_s, f'sr_t{t_idx}_{v}_s{s}_{day}')
                            v_slot_vars.append(here)
                            day_all_activity.append(here)
                            possible_slots.add(s)

                    if v_slot_vars:
                        venue_active[v] = _any_true(model, v_slot_vars, f'sr_t{t_idx}_venue_{v}_{day}')

                # Need 2+ venues possible AND 2+ distinct slots (1 activity = no travel risk)
                if len(venue_active) < 2 or len(possible_slots) < 2 or not day_all_activity:
                    continue

                # Require 2+ actual activity slots: 1 activity trivially never involves travel.
                total_active = sum(day_all_activity)
                is_2plus_active = model.NewBoolVar(f'sr_t{t_idx}_2plus_{day}')
                model.Add(total_active >= 2).OnlyEnforceIf(is_2plus_active)
                model.Add(total_active <= 1).OnlyEnforceIf(is_2plus_active.Not())

                cross_vars = []
                for (va, var_a), (vb, var_b) in itertools.combinations(venue_active.items(), 2):
                    cross = model.NewBoolVar(f'sr_t{t_idx}_cross_{va}_{vb}_{day}')
                    model.AddMultiplicationEquality(cross, [var_a, var_b])
                    cross_vars.append(cross)

                any_cross = _any_true(model, cross_vars, f'sr_t{t_idx}_any_cross_{day}')
                no_travel = model.NewBoolVar(f'sr_t{t_idx}_no_travel_{day}')
                model.AddMultiplicationEquality(no_travel, [is_2plus_active, any_cross.Not()])
                rewards['REWARD_NO_TRAVEL'].append(no_travel)

    # Adjacent group rewards: B2B + same-day + blocked penalty.
    # Applies to pairs with same gender and adjacent level (±1).
    group_level = {gi: int(g.get('level', 0)) for gi, g in enumerate(raw_groups)}
    adj_pairs = [
        (gi, gj)
        for gi in group_gender
        for gj in group_gender
        if gi < gj
        and group_gender[gi] == group_gender[gj]
        and abs(group_level.get(gi, 0) - group_level.get(gj, 0)) == 1
    ]

    if adj_pairs:
        distinct_venues = {v for v in space_venue.values() if v}
        if len(distinct_venues) >= 2:
            adj_spaces_by_venue: dict = {}
            for ci, venue in space_venue.items():
                if venue:
                    adj_spaces_by_venue.setdefault(venue, []).append(ci)
        else:
            adj_spaces_by_venue = {'': list(range(num_c))}

        gvs_cache: dict = {}
        gvd_cache: dict = {}
        blk_cache: dict = {}

        def _group_at_venue_slot(gi, vi, cv, si):
            key = (gi, vi, si)
            if key not in gvs_cache:
                vars_ = [x[gi, t, c, si] for t in range(num_t) for c in cv if (gi, t, c, si) in x]
                gvs_cache[key] = _any_true(model, vars_, f'gvs_{gi}_{vi}_{si}') if vars_ else None
            return gvs_cache[key]

        def _group_at_venue_day(gi, vi, cv, day, day_slots):
            key = (gi, vi, day)
            if key not in gvd_cache:
                vars_ = [x[gi, t, c, si] for t in range(num_t) for c in cv for si in day_slots if (gi, t, c, si) in x]
                gvd_cache[key] = _any_true(model, vars_, f'gvd_{gi}_{vi}_{day}') if vars_ else None
            return gvd_cache[key]

        def _any_member_coaching_at(gi_b, si):
            key = (gi_b, si)
            if key not in blk_cache:
                coaching_vars = []
                for t_id in data['members'].get(gi_b, []):
                    if t_id in data['indices']['t']:
                        ti_m = data['indices']['t'][t_id]
                        for g2 in range(num_g):
                            for c2 in range(num_c):
                                if (g2, ti_m, c2, si) in x:
                                    coaching_vars.append(x[g2, ti_m, c2, si])
                blk_cache[key] = _any_true(model, coaching_vars, f'blk_{gi_b}_{si}') if coaching_vars else None
            return blk_cache[key]

        # Back-to-back reward + blocked penalty
        for gi, gj in adj_pairs:
            for s1, s2 in consecutive:
                for vi, (venue, cv) in enumerate(adj_spaces_by_venue.items()):
                    for a, b in [(gi, gj), (gj, gi)]:
                        va = _group_at_venue_slot(a, vi, cv, s1)
                        vb = _group_at_venue_slot(b, vi, cv, s2)
                        if va is None or vb is None:
                            continue
                        adj_b2b = model.NewBoolVar(f'adj_{a}_{b}_{vi}_{s1}_{s2}')
                        model.AddMultiplicationEquality(adj_b2b, [va, vb])
                        rewards['REWARD_ADJ_GROUP_B2B'].append(adj_b2b)

        # Same-day adjacent reward (additive with B2B): only when at different slots
        for gi, gj in adj_pairs:
            for day, day_slots in slots_by_day.items():
                for vi, (venue, cv) in enumerate(adj_spaces_by_venue.items()):
                    ga_day = _group_at_venue_day(gi, vi, cv, day, day_slots)
                    gb_day = _group_at_venue_day(gj, vi, cv, day, day_slots)
                    if ga_day is None or gb_day is None:
                        continue
                    same_day = model.NewBoolVar(f'adj_sd_{gi}_{gj}_{vi}_{day}')
                    model.AddMultiplicationEquality(same_day, [ga_day, gb_day])

                    # Detect if both groups land on the exact same slot (no reward then)
                    overlap_vars = []
                    for s in day_slots:
                        gi_s = _group_at_venue_slot(gi, vi, cv, s)
                        gj_s = _group_at_venue_slot(gj, vi, cv, s)
                        if gi_s is not None and gj_s is not None:
                            both_s = model.NewBoolVar(f'sd_both_{gi}_{gj}_{vi}_{s}')
                            model.AddMultiplicationEquality(both_s, [gi_s, gj_s])
                            overlap_vars.append(both_s)

                    if overlap_vars:
                        any_overlap = _any_true(model, overlap_vars, f'sd_ovlp_{gi}_{gj}_{vi}_{day}')
                        sd_var = model.NewBoolVar(f'adj_sd_no_ovlp_{gi}_{gj}_{vi}_{day}')
                        model.AddMultiplicationEquality(sd_var, [same_day, any_overlap.Not()])
                        rewards['REWARD_ADJ_GROUP_SAME_DAY'].append(sd_var)
                    else:
                        rewards['REWARD_ADJ_GROUP_SAME_DAY'].append(same_day)

        # Trainer Cannot Sub Penalty: Penalises each slot where a lower-level group's trainer
        # coaches while the higher-level group is playing (in that slot or an overlapping one),
        # independent of B2B.
        same_time = {s: {s} for s in range(num_s)}
        for s1, s2 in clashes:
            same_time[s1].add(s2)
            same_time[s2].add(s1)
        higher_at_slot_cache: dict = {}
        for gi, gj in adj_pairs:
            if group_level.get(gi, 0) < group_level.get(gj, 0):
                higher_group, lower_group = gi, gj
            else:
                higher_group, lower_group = gj, gi

            for day, day_slots in slots_by_day.items():
                for s in day_slots:
                    blk = _any_member_coaching_at(lower_group, s)
                    if blk is None:
                        continue

                    if (higher_group, s) not in higher_at_slot_cache:
                        higher_vars = [x[higher_group, t, c, s2] for t in range(num_t) for c in range(num_c) for s2 in same_time[s] if (higher_group, t, c, s2) in x]
                        higher_at_slot_cache[(higher_group, s)] = (
                            _any_true(model, higher_vars, f'g_any_{higher_group}_s{s}')
                            if higher_vars else None
                        )

                    higher_at_s = higher_at_slot_cache[(higher_group, s)]
                    if higher_at_s is None:
                        continue

                    pen = model.NewBoolVar(f'trainer_sub_pen_{higher_group}_{lower_group}_s{s}')
                    model.AddMultiplicationEquality(pen, [higher_at_s, blk])
                    rewards['PENALTY_ADJ_BLOCKED'].append(pen)

    # 8. Group Rules: a group should avoid conflicts with another, e.g. so a team's players
    #    can watch other groups train. A conflict is the minutes of the other group's session
    #    they'd miss (see missed_minutes): required rules forbid any, preferred ones are
    #    penalised per minute.
    if data.get('group_rule_pairs'):
        venues = sorted(set(space_venue.values()))
        spaces_at = {v: [c for c in range(num_c) if space_venue.get(c, '') == v] for v in venues}

        # Where each group in a rule could be: (slot, venue, expression that is 1 when the
        # group's session is there). A group has exactly one session, so the sum is 0 or 1.
        placements = {}
        for g in {g for pair in data['group_rule_pairs'] for g in pair[:2]}:
            placements[g] = []
            for s in range(num_s):
                for v in venues:
                    vars_ = [x[g, t, c, s] for t in range(num_t) for c in spaces_at[v] if (g, t, c, s) in x]
                    if vars_:
                        placements[g].append((s, v, sum(vars_)))

        for gi, gj, required in data['group_rule_pairs']:
            for si, vi, at_i in placements[gi]:
                for sj, vj, at_j in placements[gj]:
                    minutes = missed_minutes(raw_timeslots[si], vi, raw_timeslots[sj], vj, travel_minutes)
                    if minutes == 0:
                        continue
                    if required:
                        model.Add(at_i + at_j <= 1)
                    else:
                        # clash = at_i AND at_j, exactly (linear form, as at_i and at_j are sums).
                        clash = model.NewBoolVar(f'rule_g{gi}_s{si}_{vi}_g{gj}_s{sj}_{vj}')
                        model.Add(clash <= at_i)
                        model.Add(clash <= at_j)
                        model.Add(clash >= at_i + at_j - 1)
                        rewards['PENALTY_GROUP_RULES'].append(minutes * clash)

    return rewards


### TIMESLOT HELPERS ###
# Slots are compared by their actual times, so timeslots can overlap (e.g. an extra
# space from 17:00-18:30 alongside 16:30-18:00) and can be entered in any order.

def slot_allows_space(slot: dict, space: dict, location_to_idx: dict) -> bool:
    """Whether a timeslot runs on a space. A slot can be limited to certain locations
    (location_bitmask) or, with space-specific timeslots, to certain spaces by name
    (spaces). Empty means no limit."""
    allowed_spaces = slot.get('spaces') or []
    if allowed_spaces and space.get('spaceName') not in allowed_spaces:
        return False
    loc_idx = location_to_idx.get(space.get('location', ''))
    ts_loc = slot.get('location_bitmask') or []
    return not (loc_idx is not None and loc_idx < len(ts_loc) and ts_loc[loc_idx] == 0)


def missed_minutes(own: dict, own_venue: str, other: dict, other_venue: str, travel_minutes: dict) -> int:
    """Minutes of the `other` session someone attending all of their `own` session would
    miss: they can't get there until their own session ends plus travel, and must leave in
    time to travel back for its start. 0 on different days."""
    if own['day'] != other['day']:
        return 0
    travel = travel_minutes.get((own_venue, other_venue), 0) if own_venue != other_venue else 0
    busy_from  = parse_hhmm(own['start']) - travel
    busy_until = parse_hhmm(own['finish']) + travel
    return max(0, min(parse_hhmm(other['finish']), busy_until) - max(parse_hhmm(other['start']), busy_from))


def group_slots_by_day(timeslots: list) -> dict:
    """Slot indices grouped by day, each day's slots ordered by start time."""
    days: dict = {}
    for i, slot in enumerate(timeslots):
        days.setdefault(slot['day'], []).append(i)
    for day_slots in days.values():
        day_slots.sort(key=lambda i: parse_hhmm(timeslots[i]['start']))
    return days


def _overlap(a: dict, b: dict) -> bool:
    return (a['day'] == b['day']
            and parse_hhmm(a['start']) < parse_hhmm(b['finish'])
            and parse_hhmm(b['start']) < parse_hhmm(a['finish']))


def clashing_slot_pairs(timeslots: list) -> list:
    """Pairs of different slots (s1 < s2) whose times overlap on the same day.
    No trainer or space can be in both."""
    return [(s1, s2) for s1, s2 in itertools.combinations(range(len(timeslots)), 2)
            if _overlap(timeslots[s1], timeslots[s2])]


def consecutive_slot_pairs(timeslots: list) -> list:
    """(slot, next slot) pairs: next by start time on the same day, and not overlapping."""
    return [(s, nxt)
            for day_slots in group_slots_by_day(timeslots).values()
            for s, nxt in zip(day_slots, day_slots[1:])
            if not _overlap(timeslots[s], timeslots[nxt])]


def _wait_minutes(model, active, day_slots, timeslots, name):
    """Minutes a trainer waits on one day: from their first start to their last finish,
    minus the time spent in sessions (0 with fewer than two sessions)."""
    day_end = 24 * 60
    start  = {s: parse_hhmm(timeslots[s]['start'])  for s in day_slots}
    finish = {s: parse_hhmm(timeslots[s]['finish']) for s in day_slots}

    # Earliest start and latest finish among the slots the trainer is active in.
    first = model.NewIntVar(0, day_end, f'{name}_first')
    model.AddMinEquality(first, [start[s] * active[s] + day_end * (1 - active[s]) for s in day_slots])
    last = model.NewIntVar(0, day_end, f'{name}_last')
    model.AddMaxEquality(last, [finish[s] * active[s] for s in day_slots])

    span_minus_busy = model.NewIntVar(-day_end, day_end, f'{name}_gap')
    model.Add(span_minus_busy == last - first - sum((finish[s] - start[s]) * active[s] for s in day_slots))
    wait = model.NewIntVar(0, day_end, f'{name}_wait')
    model.AddMaxEquality(wait, [span_minus_busy, 0])
    return wait


def _any_true(model, bool_vars, name):
    """Returns a BoolVar that is true if any of the input vars are true."""
    any_var = model.NewBoolVar(name)
    model.Add(sum(bool_vars) >= 1).OnlyEnforceIf(any_var)
    model.Add(sum(bool_vars) == 0).OnlyEnforceIf(any_var.Not())
    return any_var


def parse_hhmm(s: str) -> int:
    """Parses 'HH:MM' to total minutes since midnight."""
    try:
        h, m = map(int, s.split(':'))
        return h * 60 + m
    except Exception:
        return 0
