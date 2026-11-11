import logging

logger = logging.getLogger(__name__)


def _calculate_qualifications(trainers: list[dict], groups: list[dict], assign_trainers: bool) -> list[list[int]]:
    """
    Returns a 2-D matrix [trainer_idx][group_idx] -> 1 (qualified) or 0.

    When trainers are assigned to groups, a trainer qualifies only for their assigned groups.

    Otherwise, rank scale: 1 = highest, 5 = lowest.
    A trainer qualifies for a group when their rank is <= the group's level
    (i.e. their skill is at least as high as the group requires).
    """
    if assign_trainers:
        return [
            [1 if g["groupID"] in t.get("assigned_groups", []) else 0 for g in groups]
            for t in trainers
        ]

    matrix = []
    for t in trainers:
        row = []
        for g in groups:
            group_level = int(g.get("level", 99))
            gender = str(g.get("gender", "")).strip().lower()

            if gender == "female":
                qualified = t["ladiesRank"] != 0 and t["ladiesRank"] <= group_level
            elif gender == "male":
                qualified = t["gentsRank"] != 0 and t["gentsRank"] <= group_level
            else:
                qualified = False

            row.append(1 if qualified else 0)
        matrix.append(row)
    return matrix


def _validate_availability_lengths(
    entities: list[dict],
    num_timeslots: int,
    entity_name: str,
) -> None:
    """
    Ensures every entity's availability_bitmask has exactly `num_timeslots`
    entries. Pads with 0s or truncates in-place with a warning if not.
    """
    for i, e in enumerate(entities):
        bitmask = e.get("availability_bitmask", [])
        actual = len(bitmask)
        if actual != num_timeslots:
            name = e.get("name", f"index {i}")
            logger.warning(
                "%s '%s': expected %d availability slots, got %d. "
                "Padding with 0s or truncating.",
                entity_name, name, num_timeslots, actual,
            )
            if actual < num_timeslots:
                e["availability_bitmask"] = bitmask + [0] * (num_timeslots - actual)
            else:
                e["availability_bitmask"] = bitmask[:num_timeslots]


def transform_data(raw_data: dict) -> dict:
    """
    Converts the raw entity lists sent from the frontend into the structure
    expected by build_and_solve in solver.py.

    All IDs are normalised to strings to prevent type mismatches between
    integer and string representations of the same value.

    Input shape:
    {
        "groups":    [{"groupID", "name", "level", "gender", "availability_bitmask"}, ...],
        "trainers":  [{"trainerID", "groupID", "name", "ladiesRank", "gentsRank", "capacity",
                       "availability_bitmask", "assigned_groups"}, ...],
        "courts":    [{"courtName", "location"}, ...],
        "timeslots": [{"id", "day", "start", "finish"}, ...],
    }

    Output shape:
    {
        "indices": {
            "t": {str(trainerID): trainer_index, ...},
            "g": {str(groupID):   group_index, ...},
            "s": {str(id):        slot_index, ...},
            "c": {str(courtName): court_index, ...},
        },
        "members":  {group_index: [str(trainerID), ...], ...},
        "quals":    [[1/0, ...], ...],          # [trainer_i][group_i]
        "capacity":          [int, ...],        # [trainer_i]
        "availability": {
            "trainers": [[1/0, ...], ...],      # [trainer_i][slot_i]
            "groups":   [[1/0, ...], ...],      # [group_i][slot_i]
        },
        "raw": raw_data,
    }
    """
    trainers  = raw_data["trainers"]
    groups    = raw_data["groups"]
    timeslots = raw_data["timeslots"]
    courts    = raw_data["courts"]

    num_slots = len(timeslots)

    if num_slots == 0:
        raise ValueError("Timeslots list is empty.")
    if not groups:
        raise ValueError("Groups list is empty.")
    if not trainers:
        raise ValueError("Trainers list is empty.")
    if not courts:
        raise ValueError("Courts list is empty.")

    _validate_availability_lengths(trainers, num_slots, "Trainer")
    _validate_availability_lengths(groups,   num_slots, "Group")

    # All IDs normalised to strings to prevent int/str type mismatches
    t_idx = {str(t["trainerID"]): i for i, t in enumerate(trainers)}
    g_idx = {str(g["groupID"]):   i for i, g in enumerate(groups)}
    s_idx = {str(s["id"]):        i for i, s in enumerate(timeslots)}
    c_idx = {str(c["courtName"]): i for i, c in enumerate(courts)}

    for t in trainers:
        gid = str(t.get("groupID", ""))
        if gid and gid not in g_idx:
            logger.warning(
                "Trainer '%s' references unknown groupID '%s'.",
                t.get("name"), gid,
            )

    # Group membership: group_index -> [str(trainerID), ...]
    members_in_group: dict[int, list] = {gi: [] for gi in g_idx.values()}
    for t in trainers:
        gid = str(t.get("groupID", ""))
        tid = str(t.get("trainerID", ""))
        if gid in g_idx and tid:
            members_in_group[g_idx[gid]].append(tid)

    assign_trainers = bool(raw_data.get("assign_trainers", False))
    quals         = _calculate_qualifications(trainers, groups, assign_trainers)
    trainer_avail = [t["availability_bitmask"] for t in trainers]
    group_avail   = [g["availability_bitmask"] for g in groups]
    capacity      = [max(1, int(t.get("capacity", 1))) for t in trainers]

    # court index → venue name
    court_venue = {i: c.get("location", "") for i, c in enumerate(courts)}

    # (venue_a, venue_b) → travel minutes (symmetric)
    travel_minutes: dict[tuple, int] = {}
    for tt in raw_data.get("travel_times", []):
        v1 = tt.get("from_venue", "")
        v2 = tt.get("to_venue", "")
        mins = int(tt.get("minutes", 0))
        if v1 and v2 and mins > 0:
            travel_minutes[(v1, v2)] = mins
            travel_minutes[(v2, v1)] = mins

    location_names  = raw_data.get("location_names", [])
    location_to_idx = {name: i for i, name in enumerate(location_names)}

    return {
        "indices": {"t": t_idx, "g": g_idx, "s": s_idx, "c": c_idx},
        "members":  members_in_group,
        "quals":    quals,
        "assign_trainers": assign_trainers,
        "capacity": capacity,
        "availability": {
            "trainers": trainer_avail,
            "groups":   group_avail,
        },
        "court_venue":     court_venue,
        "travel_minutes":  travel_minutes,
        "location_to_idx": location_to_idx,
        "raw": raw_data,
    }
