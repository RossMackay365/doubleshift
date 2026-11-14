from collections import defaultdict
from .constraints import slot_allows_space


def _count(n: int, word: str) -> str:
    """'1 group', '2 groups'."""
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def diagnose_infeasibility(data: dict) -> list[str]:
    """
    Common reasons CP-SAT returns INFEASIBLE for this scheduling problem.
    Each check is independent so the user sees every failing group, not just
    the first. Empty list = no obvious cause found (the conflict is more
    subtle, e.g. trainers competing for the same slot across groups).

    Checks: unqualified/unavailable groups, location filtering, sole-trainer
    bottlenecks, space and timeslot capacity, per-day
    over-demand, and trainer capacity coverage.
    """
    issues: list[str] = []
    raw = data["raw"]
    groups    = raw["groups"]
    trainers  = raw["trainers"]
    spaces    = raw["spaces"]
    timeslots = raw["timeslots"]

    quals    = data["quals"]
    t_avail  = data["availability"]["trainers"]
    g_avail  = data["availability"]["groups"]
    members  = data["members"]
    trainer_keys    = list(data["indices"]["t"].keys())
    capacity        = data.get("capacity", [1] * len(trainers))
    space_venue     = data.get("space_venue", {})
    location_to_idx = data.get("location_to_idx", {})
    gendered = len({str(g.get("gender", "")).strip().lower() for g in groups}) > 1
    assigned = bool(data.get("assign_trainers"))

    num_g = len(groups)
    num_t = len(trainers)
    num_s = len(timeslots)
    num_c = len(spaces)

    ### Per-group checks ###
    for gi, group in enumerate(groups):
        g_name = group.get("name") or f"group {gi}"
        level  = group.get("level")
        gender = group.get("gender")
        member_set = set(members.get(gi, []))

        qualified = [ti for ti in range(num_t) if quals[ti][gi]]
        non_self  = [ti for ti in qualified if trainer_keys[ti] not in member_set]

        if not qualified:
            levels = "1" if level == 1 else f"between 1 and {level}"
            if assigned:
                issues.append(
                    f'"{g_name}" doesn\'t have a trainer yet. Choose it as a Training Group '
                    f"for one of your trainers on the Data page."
                )
            elif gendered:
                issues.append(
                    f'"{g_name}" ({gender}, level {level}) doesn\'t have a trainer who can '
                    f"train it. Add a trainer whose {gender} level is {levels}."
                )
            else:
                issues.append(
                    f'"{g_name}" (level {level}) doesn\'t have a trainer who can train it. '
                    f"Add a trainer whose level is {levels}."
                )
            continue

        if not non_self:
            issues.append(
                f'Every trainer who can train "{g_name}" is also a member of it, and a '
                f"trainer can't train their own group. Add another trainer for this group."
            )
            continue

        g_slots = [si for si in range(num_s) if g_avail[gi][si]]
        if not g_slots:
            issues.append(
                f'"{g_name}" isn\'t available in any timeslot. Select at least one '
                f"timeslot in its Availability."
            )
            continue

        if not any(t_avail[ti][si] for ti in non_self for si in g_slots):
            issues.append(
                f'No trainer who can train "{g_name}" is available when the group is. '
                f"Give the group and its trainers at least one timeslot in common."
            )
            continue

        # Check if location filtering removes all valid (trainer, space, slot) combos.
        if location_to_idx:
            g_loc = group.get("location_bitmask", [])
            valid_combo = False
            for ti in non_self:
                if valid_combo:
                    break
                for ci in range(num_c):
                    if valid_combo:
                        break
                    venue   = space_venue.get(ci, "")
                    loc_idx = location_to_idx.get(venue)
                    if loc_idx is not None and g_loc:
                        if loc_idx < len(g_loc) and g_loc[loc_idx] == 0:
                            continue
                    for si in g_slots:
                        if not t_avail[ti][si]:
                            continue
                        if not slot_allows_space(timeslots[si], spaces[ci], location_to_idx):
                            continue
                        valid_combo = True
                        break
            if not valid_combo:
                issues.append(
                    f'No timeslot at the locations chosen for "{g_name}" suits both the group '
                    f"and a trainer. Check the Locations chosen for the group and for its timeslots."
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

    ### Trainer bottleneck check ###
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
                f'"{trainers[ti]["name"]}" is the only trainer who can train '
                f"{_count(len(g_list), 'group')} ({', '.join(g_names)}), but their capacity is {cap}. "
                f"Raise their capacity or add another trainer for these groups."
            )

    # Build slots_by_day once: reused in per-day and travel checks below.
    slots_by_day: dict = defaultdict(list)
    for i, s in enumerate(timeslots):
        slots_by_day[s['day']].append(i)

    ### Total space and timeslot capacity check ###
    total_capacity = num_c * num_s
    if num_g > total_capacity:
        issues.append(
            f"You have {_count(num_g, 'group')}, but {_count(num_c, 'space')} and "
            f"{_count(num_s, 'timeslot')} only leave room for {_count(total_capacity, 'session')}. "
            f"Add spaces or timeslots."
        )

    ### Per-day demand vs capacity check ###
    # Detects when too many groups are locked to one day (their valid assignments only
    # exist on that day), so there aren't enough space-slots to fit them all.

    def _slot_space_ok(si, ci):
        return slot_allows_space(timeslots[si], spaces[ci], location_to_idx)

    def _group_valid_on_slot(gi, si):
        member_set = set(members.get(gi, []))
        g_loc = groups[gi].get('location_bitmask', [])
        for ti in range(num_t):
            if not quals[ti][gi] or not t_avail[ti][si]:
                continue
            if trainer_keys[ti] in member_set:
                continue
            for ci in range(num_c):
                if not _slot_space_ok(si, ci):
                    continue
                venue   = space_venue.get(ci, '')
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

    # Count valid (space, slot) pairs per day: upper bound on groups schedulable that day.
    day_capacity: dict = defaultdict(int)
    for ci in range(num_c):
        for si in range(num_s):
            if _slot_space_ok(si, ci):
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
                f"{_count(len(locked), 'group')} can only train on {day} "
                f"({', '.join(locked[:5])}{' and others' if len(locked) > 5 else ''}), "
                f"but {day} only has room for {_count(cap, 'session')}. "
                f"Add spaces or timeslots on {day}, or make these groups available on other days."
            )

    ### Trainer qualification coverage checks ###

    # 1. Global capacity: total trainer capacity must be >= number of groups.
    total_trainer_capacity = sum(capacity[ti] for ti in range(num_t))
    if total_trainer_capacity < num_g:
        issues.append(
            f"Your trainers can train {_count(total_trainer_capacity, 'group')} between them, "
            f"but you have {_count(num_g, 'group')}. Raise some trainers' capacity or add trainers."
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
        # Without genders this is the same shortfall as the total capacity check above.
        already_reported = not gendered and total_trainer_capacity < num_g
        if gender_capacity < len(gender_groups) and not already_reported:
            label = f"{gender} " if gendered else ""
            issues.append(
                f"You have {_count(len(gender_groups), label + 'group')}, but the trainers who can "
                f"train them can only take {_count(gender_capacity, 'group')} between them. "
                f"Add trainers for these groups or raise their capacity."
            )

    # 3. Groups with very few qualified trainer options: bottleneck candidates even when no single trainer is the sole option.
    thin_groups: list = []
    for gi in range(num_g):
        g_name  = groups[gi].get('name', f'group {gi}')
        capable = capable_by_group[gi]
        if 1 <= len(capable) <= 2:
            thin_groups.append((g_name, [trainers[ti]['name'] for ti in capable]))

    if thin_groups and not assigned:
        # One message per group (the first few), so each reads as a plain sentence.
        for name, t_names in thin_groups[:6]:
            issues.append(
                f'Only {" and ".join(t_names)} can train "{name}". If they are needed elsewhere, '
                f"this group has no trainer. Consider adding another trainer for it."
            )
        if len(thin_groups) > 6:
            issues.append(
                f"{_count(len(thin_groups) - 6, 'more group')} also depend on only one or two trainers."
            )

    ### Required group rules ###
    # They forbid certain groups from clashing; enough of them can leave no valid
    # arrangement even when everything else fits, so mention them as a possible cause.
    required_rules = [pair for pair in data.get("group_rule_pairs", []) if pair[2]]
    if required_rules:
        issues.append(
            f"{_count(len(required_rules), 'pair')} of groups must follow a required group rule. "
            f"Together these rules may leave no possible schedule. Try making some of them preferred."
        )

    return issues
