from pydantic import BaseModel
from typing import Optional, Dict, Any, List


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
    ladiesRank: int
    gentsRank: int
    capacity: int = 1  # max number of groups this trainer can be assigned to coach
    availability_bitmask: list[int]
    # Day preference for player-trainers: coach on the same day they play and/or a
    # different day. Both or neither ticked = no preference. Required makes it a hard
    # constraint instead of a scored reward.
    prefSameDay: bool = True
    prefDifferentDay: bool = False
    prefRequired: bool = False


class Court(BaseModel):
    courtName: str
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


class OptimizeRequest(BaseModel):
    groups:         list[Group]
    trainers:       list[Trainer]
    courts:         list[Court]
    timeslots:      list[Timeslot]
    travel_times:   list[TravelTime] = []
    location_names: list[str] = []
    reward_config:  Optional[Dict[str, int]] = None


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    stats:  Dict[str, Any]
    result: Optional[list] = None


class ScheduleEntryModel(BaseModel):
    group:    str
    trainer:  str
    court:    str
    timeslot: int


class VerifyRequest(BaseModel):
    groups:         list[Group]
    trainers:       list[Trainer]
    courts:         list[Court]
    timeslots:      list[Timeslot]
    schedule:       list[ScheduleEntryModel]
    travel_times:   list[TravelTime] = []
    location_names: list[str] = []
    reward_config:  Optional[Dict[str, int]] = None


class VerifyResponse(BaseModel):
    feasible:     bool
    score:        Optional[float] = None
    best_bound:   Optional[float] = None
    absolute_gap: Optional[float] = None
    gap_percent:  Optional[float] = None
    violations:   List[str] = []
