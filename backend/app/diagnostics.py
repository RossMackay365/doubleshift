from collections import defaultdict


def diagnose_infeasibility(data: dict) -> list[str]:
    """
    Common reasons CP-SAT returns INFEASIBLE for this scheduling problem.
    Each check is independent so the user sees every failing group, not just
    the first. Empty list = no obvious cause found (the conflict is more
    subtle, e.g. trainers competing for the same slot across groups).

    Checks: unqualified/unavailable groups, location filtering, sole-trainer
    bottlenecks, court×slot capacity, per-day
    over-demand, and trainer capacity coverage.
    """
    issues: list[str] = []
    raw = data["raw"]
    groups    = raw["groups"]
    trainers  = raw["trainers"]
    courts    = raw["courts"]
    timeslots = raw["timeslots"]

    quals    = data["quals"]
    t_avail  = data["availability"]["trainers"]
    g_avail  = data["availability"]["groups"]
    members  = data["members"]
    trainer_keys    = list(data["indices"]["t"].keys())
    capacity        = data.get("capacity", [1] * len(trainers))
    court_venue     = data.get("court_venue", {})
    location_to_idx = data.get("location_to_idx", {})
    # Mention genders in messages only when the groups actually have more than one.
    gendered = len({str(g.get("gender", "")).strip().lower() for g in groups}) > 1
    # With trainers assigned to groups, each group's trainer is chosen directly: a group
    # without one is reported as unassigned, and the qualification-coverage checks
    # (which look for groups with too few qualified trainers) don't apply.
    assigned = bool(data.get("assign_trainers"))

    num_g = len(groups)
    num_t = len(trainers)
    num_s = len(timeslots)
    num_c = len(courts)

    # --- Per-group checks ---
    for gi, group in enumerate(groups):
        g_name = group.get("name") or f"group {gi}"
        level  = group.get("level")
        gender = group.get("gender")
        member_set = set(members.get(gi, []))

        qualified = [ti for ti in range(num_t) if quals[ti][gi]]
        non_self  = [ti for ti in qualified if trainer_keys[ti] not in member_set]

        if not qualified:
            if assigned:
                issues.append(
                    f"Group '{g_name}' has no trainer assigned. Choose it as a trainer's Training Group."
                )
            elif gendered:
                issues.append(
                    f"Group '{g_name}' ({gender}, level {level}) has no qualified "
                    f"trainer. Add a trainer whose {gender} level is between 1 and {level}."
                )
            else:
                issues.append(
                    f"Group '{g_name}' (level {level}) has no qualified trainer. "
                    f"Add a trainer whose level is between 1 and {level}."
                )
            continue

        if not non_self:
            issues.append(
                f"Group '{g_name}' has qualified trainers, but every one of them "
                f"plays in this group, so none can coach it."
            )
            continue

        g_slots = [si for si in range(num_s) if g_avail[gi][si]]
        if not g_slots:
            issues.append(
                f"Group '{g_name}' has no available timeslots — its availability "
                f"is empty."
            )
            continue

        if not any(t_avail[ti][si] for ti in non_self for si in g_slots):
            issues.append(
                f"Group '{g_name}' has qualified trainers and available slots, "
                f"but none of those trainers are free during the group's slots."
            )
            continue

        # Check if location filtering removes all valid (trainer, court, slot) combos.
        if location_to_idx:
            g_loc = group.get("location_bitmask", [])
            valid_combo = False
            for ti in non_self:
                if valid_combo:
                    break
                for ci in range(num_c):
                    if valid_combo:
                        break
                    venue   = court_venue.get(ci, "")
                    loc_idx = location_to_idx.get(venue)
                    if loc_idx is not None and g_loc:
                        if loc_idx < len(g_loc) and g_loc[loc_idx] == 0:
                            continue
                    for si in g_slots:
                        if not t_avail[ti][si]:
                            continue
                        if loc_idx is not None:
                            ts_loc = timeslots[si].get("location_bitmask", [])
                            if ts_loc and loc_idx < len(ts_loc) and ts_loc[loc_idx] == 0:
                                continue
                        valid_combo = True
                        break
            if not valid_combo:
                issues.append(
                    f"Group '{g_name}' has no valid assignment after location "
                    f"filtering — check the group's and timeslots' location settings."
                )

    # Trainers who could coach each group: qualified, not a member, and free during
    # at least one of the group's available slots. Shared by several checks below.
    def _capable_trainers(gi):
        member_set = set(members.get(gi, []))
        g_slots    = [si for si in range(num_s) if g_avail[gi][si]]
        return [
            ti for ti in range(num_t)
            if quals[ti][gi]
            and trainer_keys[ti] not in member_set
            and any(t_avail[ti][si] for si in g_slots)
        ]

    capable_by_group = {gi: _capable_trainers(gi) for gi in range(num_g)}

    # --- Trainer bottleneck check ---
    # If a trainer is the ONLY qualified option for more groups than their capacity,
    # the problem is trivially infeasible regardless of slot arrangements.
    sole_groups: dict = defaultdict(list)
    for gi in range(num_g):
        capable = capable_by_group[gi]
        if len(capable) == 1:
            sole_groups[capable[0]].append(gi)

    for ti, g_list in sole_groups.items():
        cap = capacity[ti] if ti < len(capacity) else 1
        if len(g_list) > cap:
            g_names = [groups[gi].get("name", f"group {gi}") for gi in g_list]
            issues.append(
                f"Trainer '{trainers[ti]['name']}' is the only qualified option for "
                f"{len(g_list)} groups ({', '.join(g_names)}) but has capacity {cap}. "
                f"Increase their capacity or add another qualified trainer."
            )

    # Build slots_by_day once — reused in per-day and travel checks below.
    slots_by_day: dict = defaultdict(list)
    for i, s in enumerate(timeslots):
        slots_by_day[s['day']].append(i)

    # --- Total court×slot capacity check ---
    total_capacity = num_c * num_s
    if num_g > total_capacity:
        issues.append(
            f"You have {num_g} groups but only {num_c} court(s) × {num_s} slot(s) "
            f"= {total_capacity} session slots. Demand exceeds capacity."
        )

    # --- Per-day demand vs capacity check ---
    # Detects when too many groups are locked to one day (their valid assignments only
    # exist on that day), so there aren't enough court-slots to fit them all.

    def _slot_court_ok(si, ci):
        venue   = court_venue.get(ci, '')
        loc_idx = location_to_idx.get(venue)
        if loc_idx is None:
            return True
        ts_loc = timeslots[si].get('location_bitmask', [])
        return not (ts_loc and loc_idx < len(ts_loc) and ts_loc[loc_idx] == 0)

    def _group_valid_on_slot(gi, si):
        member_set = set(members.get(gi, []))
        g_loc = groups[gi].get('location_bitmask', [])
        for ti in range(num_t):
            if not quals[ti][gi] or not t_avail[ti][si]:
                continue
            if trainer_keys[ti] in member_set:
                continue
            for ci in range(num_c):
                if not _slot_court_ok(si, ci):
                    continue
                venue   = court_venue.get(ci, '')
                loc_idx = location_to_idx.get(venue)
                if loc_idx is not None and g_loc and loc_idx < len(g_loc) and g_loc[loc_idx] == 0:
                    continue
                return True
        return False

    group_valid_days: dict = {}
    for gi in range(num_g):
        valid_days: set = set()
        for si in range(num_s):
            if not g_avail[gi][si]:
                continue
            day = timeslots[si]['day']
            if day not in valid_days and _group_valid_on_slot(gi, si):
                valid_days.add(day)
        group_valid_days[gi] = valid_days

    # Count valid (court, slot) pairs per day — upper bound on groups schedulable that day.
    day_capacity: dict = defaultdict(int)
    for ci in range(num_c):
        for si in range(num_s):
            if _slot_court_ok(si, ci):
                day_capacity[timeslots[si]['day']] += 1

    day_locked: dict = defaultdict(list)
    for gi in range(num_g):
        g_name     = groups[gi].get('name', f'group {gi}')
        valid_days = group_valid_days[gi]
        if len(valid_days) == 1:
            day_locked[next(iter(valid_days))].append(g_name)

    for day in sorted(slots_by_day):
        cap    = day_capacity.get(day, 0)
        locked = day_locked.get(day, [])
        if locked and len(locked) > cap:
            issues.append(
                f"Day '{day}': {len(locked)} group(s) can only be scheduled on this day "
                f"({', '.join(locked[:5])}{'...' if len(locked) > 5 else ''}) "
                f"but only {cap} session slot(s) are available. "
                f"Add more courts/slots on this day or spread group availability to other days."
            )

    # --- Trainer qualification coverage checks ---

    # 1. Global capacity: total trainer capacity must be >= number of groups.
    total_trainer_capacity = sum(capacity[ti] for ti in range(num_t))
    if total_trainer_capacity < num_g:
        issues.append(
            f"Total trainer capacity ({total_trainer_capacity}) is less than the number of "
            f"groups ({num_g}). Increase trainer capacities or reduce group count."
        )

    # 2. Gender-stratified capacity: enough qualified trainer capacity per gender.
    for gender in (() if assigned else ('female', 'male')):
        gender_groups = [
            gi for gi, g in enumerate(groups)
            if str(g.get('gender', '')).strip().lower() == gender
        ]
        if not gender_groups:
            continue
        gender_qualified: set = set()
        for gi in gender_groups:
            member_set = set(members.get(gi, []))
            g_slots = [si for si in range(num_s) if g_avail[gi][si]]
            for ti in range(num_t):
                if (quals[ti][gi]
                        and trainer_keys[ti] not in member_set
                        and any(t_avail[ti][si] for si in g_slots)):
                    gender_qualified.add(ti)
        gender_capacity = sum(capacity[ti] if ti < len(capacity) else 1 for ti in gender_qualified)
        if gender_capacity < len(gender_groups):
            label = f"{gender} " if gendered else ""
            issues.append(
                f"Not enough trainer capacity for {label}groups: "
                f"{len(gender_groups)} {label}group(s) but all qualified trainers "
                f"combined have capacity {gender_capacity}. "
                f"Add more {label}qualified trainers or increase their capacity."
            )

    # 3. Groups with very few qualified trainer options — bottleneck candidates even
    #    when no single trainer is the sole option.
    thin_groups: list = []
    for gi in range(num_g):
        g_name  = groups[gi].get('name', f'group {gi}')
        capable = capable_by_group[gi]
        if 1 <= len(capable) <= 2:
            cap_total = sum(capacity[ti] if ti < len(capacity) else 1 for ti in capable)
            thin_groups.append((
                g_name,
                [trainers[ti]['name'] for ti in capable],
                cap_total,
            ))

    if thin_groups and not assigned:
        lines = [
            f"'{name}' — only {', '.join(t_names)} (combined capacity {cap})"
            for name, t_names, cap in thin_groups[:6]
        ]
        issues.append(
            f"{len(thin_groups)} group(s) have very few qualified trainer options "
            f"and are vulnerable to conflicts:\n" +
            "\n".join(f"  • {l}" for l in lines) +
            (f"\n  (and {len(thin_groups) - 6} more)" if len(thin_groups) > 6 else "")
        )

    return issues
