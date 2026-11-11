import itertools

# Every reward the solver supports. The points for each come with every request (from
# the schedule's Scheduler Settings); a penalty's points count against the schedule.
REWARD_KEYS = (
    'REWARD_B2B', 'REWARD_NO_TRAVEL', 'REWARD_NET_HEIGHT',
    'REWARD_ADJ_GROUP_B2B', 'REWARD_ADJ_GROUP_SAME_DAY', 'PENALTY_ADJ_BLOCKED',
)


def is_penalty(key: str) -> bool:
    return key.startswith('PENALTY_')


def apply_constraints(model, x, data):
    """
    Applies Hard and Soft constraints to the CP-SAT model.

    Returns each reward's indicator variables: {reward key: [BoolVar, ...]}, where each
    variable is 1 exactly when that reward is achieved once (or, for a penalty, incurred
    once). The solver builds its objective from these (see solver.py).
    """
    num_g = len(data['indices']['g'])
    num_t = len(data['indices']['t'])
    num_c = len(data['indices']['c'])
    num_s = len(data['indices']['s'])

    court_venue    = data.get('court_venue', {})
    travel_minutes = data.get('travel_minutes', {})

    # 1. Group Coverage: each group gets exactly one session
    for g in range(num_g):
        group_vars = [x[g, t, c, s] for t in range(num_t) for c in range(num_c) for s in range(num_s) if (g, t, c, s) in x]
        model.AddExactlyOne(group_vars)

    # 2. Court Conflict: at most one group per court/slot
    for c in range(num_c):
        for s in range(num_s):
            model.AddAtMostOne(x[g, t, c, s] for g in range(num_g) for t in range(num_t) if (g, t, c, s) in x)

    # 3. Trainer Conflict: at most one group per trainer/slot
    for t in range(num_t):
        for s in range(num_s):
            model.AddAtMostOne(x[g, t, c, s] for g in range(num_g) for c in range(num_c) if (g, t, c, s) in x)

    # 4. Trainer Capacity: total groups coached ≤ trainer's capacity
    for t in range(num_t):
        model.Add(sum(x[g, t, c, s] for g in range(num_g) for c in range(num_c) for s in range(num_s) if (g, t, c, s) in x) <= data['capacity'][t])

    # 5. Trainer Playing vs Coaching Conflict
    for t_id, t_idx in data['indices']['t'].items():
        playing_groups = [g_idx for g_idx, m_ids in data['members'].items() if t_id in m_ids]
        for s in range(num_s):
            is_coaching = sum(x[g, t_idx, c, s] for g in range(num_g) for c in range(num_c) if (g, t_idx, c, s) in x)
            is_playing  = sum(x[gp, ot, oc, s] for gp in playing_groups for ot in range(num_t) for oc in range(num_c) if (gp, ot, oc, s) in x)
            model.Add(is_coaching + is_playing <= 1)

    # 6. Trainer Travel Time: cannot be at venue V1 at slot S1 and venue V2 at slot S2
    #    if the gap between S1.finish and S2.start is less than travel_time(V1, V2).
    if travel_minutes:
        raw_timeslots = data['raw']['timeslots']
        slots_by_day  = _group_slots_by_day(data)

        # Deduplicate venue pairs — travel_minutes stores both (A,B) and (B,A)
        seen = set()
        venue_pairs = []
        for (v1, v2) in travel_minutes:
            key = tuple(sorted([v1, v2]))
            if key not in seen:
                seen.add(key)
                venue_pairs.append((v1, v2))

        courts_by_venue: dict = {}
        for ci, venue in court_venue.items():
            courts_by_venue.setdefault(venue, []).append(ci)

        for t_id, t_idx in data['indices']['t'].items():
            playing_groups = [g_idx for g_idx, m_ids in data['members'].items() if t_id in m_ids]

            for day, day_slots in slots_by_day.items():
                for i, s1 in enumerate(day_slots):
                    for s2 in day_slots[i + 1:]:
                        ts1  = raw_timeslots[s1]
                        ts2  = raw_timeslots[s2]
                        gap  = _parse_hhmm(ts2['start']) - _parse_hhmm(ts1['finish'])

                        for v1, v2 in venue_pairs:
                            travel = travel_minutes.get((v1, v2), 0)
                            if travel == 0 or gap >= travel:
                                continue

                            cv1 = courts_by_venue.get(v1, [])
                            cv2 = courts_by_venue.get(v2, [])

                            # Trainer at v1 at s1, v2 at s2 — both orderings
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


    # --- SOFT CONSTRAINTS (REWARDS) ---
    rewards = {key: [] for key in REWARD_KEYS}
    slots_by_day = _group_slots_by_day(data)

    # 7. Back-to-Back reward: a player-trainer coaches right before or after their own
    #    group's session (coach→play and play→coach are both rewarded).
    for t_id, t_idx in data['indices']['t'].items():
        playing_groups = [g_idx for g_idx, m_ids in data['members'].items() if t_id in m_ids]
        if not playing_groups:
            continue

        coaching = {
            s: _any_true(model, [x[g, t_idx, c, s] for g in range(num_g) for c in range(num_c) if (g, t_idx, c, s) in x],
                         f't{t_idx}_coach_s{s}')
            for s in range(num_s)
        }
        playing = {
            s: _any_true(model, [x[gp, ot, oc, s] for gp in playing_groups for ot in range(num_t) for oc in range(num_c) if (gp, ot, oc, s) in x],
                         f't{t_idx}_play_s{s}')
            for s in range(num_s)
        }

        for day_slots in slots_by_day.values():
            for s, next_s in zip(day_slots, day_slots[1:]):
                for name, first, second in (('cp', coaching[s], playing[next_s]), ('pc', playing[s], coaching[next_s])):
                    b2b = model.NewBoolVar(f'b2b_{name}_t{t_idx}_s{s}')
                    model.AddMultiplicationEquality(b2b, [first, second])
                    rewards['REWARD_B2B'].append(b2b)

    # No Net Height Change reward: +1 when same gender plays on same court in adjacent slots
    raw_groups = data['raw']['groups']
    group_gender = {
        gi: str(g.get('gender', '')).strip().lower()
        for gi, g in enumerate(raw_groups)
        if str(g.get('gender', '')).strip().lower() in ('female', 'male')
    }
    for c in range(num_c):
        for day, day_slots in slots_by_day.items():
            for i in range(len(day_slots) - 1):
                s      = day_slots[i]
                next_s = day_slots[i + 1]

                for gender in ('female', 'male'):
                    gender_gi = [gi for gi, gen in group_gender.items() if gen == gender]

                    vars_at_s    = [x[g, t, c, s]      for g in gender_gi for t in range(num_t) if (g, t, c, s)      in x]
                    vars_at_next = [x[g, t, c, next_s] for g in gender_gi for t in range(num_t) if (g, t, c, next_s) in x]

                    if not vars_at_s or not vars_at_next:
                        continue

                    has_s    = _any_true(model, vars_at_s,    f'{gender}_c{c}_s{s}')
                    has_next = _any_true(model, vars_at_next, f'{gender}_c{c}_s{next_s}_from_{s}')

                    consec = model.NewBoolVar(f'{gender}_consec_c{c}_s{s}')
                    model.AddMultiplicationEquality(consec, [has_s, has_next])
                    rewards['REWARD_NET_HEIGHT'].append(consec)

    # No Travel reward: +10000 per trainer per day where all activities are at the same venue.
    # Only applies when the trainer has possible activities in 2+ distinct slots on that day
    # (a single activity can never involve travel, so it shouldn't count).
    if court_venue and len(set(court_venue.values())) >= 2:
        courts_by_venue: dict = {}
        for ci, venue in court_venue.items():
            courts_by_venue.setdefault(venue, []).append(ci)
        all_venues = list(courts_by_venue.keys())

        for t_id, t_idx in data['indices']['t'].items():
            playing_groups = [g_idx for g_idx, m_ids in data['members'].items() if t_id in m_ids]

            for day, day_slots in slots_by_day.items():
                venue_active: dict = {}
                day_all_activity = []
                possible_slots: set = set()

                for v in all_venues:
                    cv = courts_by_venue[v]
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

                # Require 2+ actual activity slots — 1 activity trivially never involves travel.
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
        distinct_venues = {v for v in court_venue.values() if v}
        if len(distinct_venues) >= 2:
            adj_courts_by_venue: dict = {}
            for ci, venue in court_venue.items():
                if venue:
                    adj_courts_by_venue.setdefault(venue, []).append(ci)
        else:
            adj_courts_by_venue = {'': list(range(num_c))}

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
            for day, day_slots in slots_by_day.items():
                for i in range(len(day_slots) - 1):
                    s1, s2 = day_slots[i], day_slots[i + 1]
                    for vi, (venue, cv) in enumerate(adj_courts_by_venue.items()):
                        for a, b in [(gi, gj), (gj, gi)]:
                            va = _group_at_venue_slot(a, vi, cv, s1)
                            vb = _group_at_venue_slot(b, vi, cv, s2)
                            if va is None or vb is None:
                                continue
                            adj_b2b = model.NewBoolVar(f'adj_{a}_{b}_{vi}_{s1}_{s2}')
                            model.AddMultiplicationEquality(adj_b2b, [va, vb])
                            rewards['REWARD_ADJ_GROUP_B2B'].append(adj_b2b)

        # Same-day adjacent reward (additive with B2B) — only when at different slots
        for gi, gj in adj_pairs:
            for day, day_slots in slots_by_day.items():
                for vi, (venue, cv) in enumerate(adj_courts_by_venue.items()):
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

        # Trainer Cannot Sub penalty: fires whenever a lower-level group's trainer coaches
        # at the same slot a higher-level group is playing, independent of B2B.
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
                        higher_vars = [x[higher_group, t, c, s] for t in range(num_t) for c in range(num_c) if (higher_group, t, c, s) in x]
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

    return rewards


def _group_slots_by_day(data):
    """Groups slot indices by their calendar day."""
    slots = {}
    for i, s in enumerate(data['raw']['timeslots']):
        d = s['day']
        if d not in slots:
            slots[d] = []
        slots[d].append(i)
    return slots


def _any_true(model, bool_vars, name):
    """Returns a BoolVar that is true if any of the input vars are true."""
    any_var = model.NewBoolVar(name)
    model.Add(sum(bool_vars) >= 1).OnlyEnforceIf(any_var)
    model.Add(sum(bool_vars) == 0).OnlyEnforceIf(any_var.Not())
    return any_var


def _parse_hhmm(s: str) -> int:
    """Parses 'HH:MM' to total minutes since midnight."""
    try:
        h, m = map(int, s.split(':'))
        return h * 60 + m
    except Exception:
        return 0
