from pydantic import AfterValidator, BaseModel, Field
from typing import Annotated, Optional, Dict, Any, List, Literal
from .constraints import REWARD_KEYS


def _require_every_reward(points: Dict[str, int]) -> Dict[str, int]:
    missing = [key for key in REWARD_KEYS if key not in points]
    if missing:
        raise ValueError(f"reward_config is missing points for: {', '.join(missing)}")
    return points


# Points for every reward, { REWARD_KEY: points } (0 = off), from the schedule's
# Scheduler Settings. There are no backend defaults: the frontend always sends them all.
RewardPoints = Annotated[Dict[str, int], AfterValidator(_require_every_reward)]


class Group(BaseModel):
    groupID: str
    name: str
    level: int
    gender: str  # 'female' | 'male'
    availability_bitmask: list[int]
    location_bitmask: list[int] = []


class Trainer(BaseModel):
    trainerID: str
    groupID: str  # references Group.groupID
    name: str
    femaleLevel: int
    maleLevel: int
    capacity: int = 1  # max number of groups this trainer can be assigned to coach
    availability_bitmask: list[int]
    # Groups this trainer is assigned to coach (groupIDs). Only used when assign_trainers is set.
    assigned_groups: list[str] = []


class Space(BaseModel):
    spaceName: str
    location: str


class TravelTime(BaseModel):
    from_venue: str
    to_venue: str
    minutes: int


class Timeslot(BaseModel):
    id: int
    day: str
    start: str
    finish: str
    location_bitmask: list[int] = []
    # Space-specific timeslots: the names of the spaces this slot runs on (empty = all).
    spaces: list[str] = []


class GroupRule(BaseModel):
    # 'notAtSameTime': each group in `groups` shouldn't clash with each group in `against`
    # (e.g. so a team's players can watch other groups train). Groups are groupIDs.
    # Required rules must hold; preferred ones are penalised per minute (Group Rules reward).
    type: Literal['notAtSameTime'] = 'notAtSameTime'
    groups: list[str]
    against: list[str]
    required: bool = False


class SolveRequest(BaseModel):
    groups:         list[Group]
    trainers:       list[Trainer]
    spaces:         list[Space]
    timeslots:      list[Timeslot]
    travel_times:   list[TravelTime] = []
    location_names: list[str] = []
    reward_config:  RewardPoints
    # Trainers coach only their assigned_groups, instead of any group their level qualifies them for.
    assign_trainers: bool = False
    group_rules: list[GroupRule] = []
    # 'points': maximise the points-weighted total. 'hierarchical': optimise the rewards in
    # reward_order one at a time, never giving up a higher one for a lower one.
    reward_mode: Literal['points', 'hierarchical'] = 'points'
    reward_order: list[str] = []
    # Solver time limit, from the schedule's Scheduler Settings (10 seconds to 1 hour).
    max_solve_seconds: int = Field(default=120, ge=10, le=3600)


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    stats:  Dict[str, Any]
    result: Optional[list] = None


class ScheduleEntryModel(BaseModel):
    group:    str
    trainer:  str
    space:    str
    timeslot: int


class VerifyRequest(BaseModel):
    groups:         list[Group]
    trainers:       list[Trainer]
    spaces:         list[Space]
    timeslots:      list[Timeslot]
    schedule:       list[ScheduleEntryModel]
    travel_times:   list[TravelTime] = []
    location_names: list[str] = []
    reward_config:  RewardPoints
    assign_trainers: bool = False
    group_rules: list[GroupRule] = []


class VerifyResponse(BaseModel):
    feasible:     bool
    score:        Optional[float] = None
    best_bound:   Optional[float] = None
    absolute_gap: Optional[float] = None
    gap_percent:  Optional[float] = None
    violations:   List[str] = []
    reward_counts: Optional[Dict[str, int]] = None


### Saved Schedule Schemas ###
class ScheduleCreate(BaseModel):
    name: str


class ScheduleContents(BaseModel):
    data: Any = None
    settings: Any = None
    last_run: Any = None


class ScheduleImport(BaseModel):
    name: str
    file: Any  # the parsed contents of the .doubleshift file
