from ortools.sat.python import cp_model
from .constraints import apply_constraints, slot_allows_space
from .transform import transform_data
from .diagnostics import diagnose_infeasibility
from .state import update_job, get_job, register_process, unregister_process
import multiprocessing as mp
import queue as queue_mod
import os
import time
import logging

logger = logging.getLogger(__name__)



class SchedulerCallback(cp_model.CpSolverSolutionCallback):
    """
    Fires every time the solver finds a new (improved) feasible solution.

    This runs inside the solver *child* process, so it cannot touch the shared
    job state directly (that lives in the parent's memory). Instead it streams
    each improving schedule back to the parent over `progress_queue`, and the
    parent writes it into job state. This keeps the live-schedule behaviour
    while letting the parent kill the child on demand.
    """
    def __init__(self, x: dict, data: dict, progress_queue, rewards: dict, stage: dict | None = None,
                 tidy_bound: float | None = None):
        super().__init__()
        self._x = x
        self._data = data
        self._queue = progress_queue
        self._rewards = rewards
        self.reward_counts: dict = {}
        self.chosen: list = []  # the (group, trainer, space, slot) keys of that schedule
        self._stage = stage or {}  # Hierarchical Mode: which reward is being optimised
        # The tidy-up (see _tidy_spaces) minimises space numbers, not the score, so its score
        # is worked out from the reward counts, and its gap uses the main search's bound.
        self._tidy_bound = tidy_bound
        self._solution_count = 0

    def on_solution_callback(self):
        self._solution_count += 1

        # Extract the Current Variable Value Assignments
        current_schedule = []
        self.chosen = []
        for key, var in self._x.items():
            if self.Value(var) == 1:
                self.chosen.append(key)
                g_i, t_i, c_i, s_i = key
                current_schedule.append({
                    "group":    self._data["raw"]["groups"][g_i]["name"],
                    "trainer":  self._data["raw"]["trainers"][t_i]["name"],
                    "space":    self._data["raw"]["spaces"][c_i]["spaceName"],
                    "timeslot": self._data["raw"]["timeslots"][s_i]["id"],
                })

        self.reward_counts = {key: sum(self.Value(v) for v in vars_) for key, vars_ in self._rewards.items()}

        tidying = self._tidy_bound is not None
        objective = _score(self._data, self.reward_counts) if tidying else self.ObjectiveValue()
        stats = {
            "solutions_found": self._solution_count,
            "current_score":   objective,
            "elapsed_seconds": round(self.WallTime(), 2),
            **self._stage,
        }
        try:
            stats.update(_gap(objective, self._tidy_bound if tidying else self.BestObjectiveBound()))
        except Exception as e:
            logger.warning("Could not compute gap: %s", e)

        self._queue.put({"type": "progress", "result": current_schedule, "stats": stats})



def build_and_solve(data: dict, progress_queue):
    """
    Initializes the CP-SAT model, creates decision variables, applies constraints and
    solves, in points or hierarchical mode. Returns (status, stats), where stats are the
    final job stats when a schedule was found.
    """
    model = cp_model.CpModel()

    num_g = len(data["indices"]["g"])
    num_t = len(data["indices"]["t"])
    num_c = len(data["indices"]["c"])
    num_s = len(data["indices"]["s"])

    trainer_keys = list(data["indices"]["t"].keys())

    space_venue     = data.get("space_venue", {})
    location_to_idx = data.get("location_to_idx", {})

    x = {}
    for g in range(num_g):
        group_loc_bitmask = data["raw"]["groups"][g].get("location_bitmask", [])
        for t in range(num_t):
            trainer_id = trainer_keys[t]
            if not data["quals"][t][g]:
                continue
            if trainer_id in data["members"].get(g, []):
                continue
            for c in range(num_c):
                venue   = space_venue.get(c, "")
                loc_idx = location_to_idx.get(venue)
                # Skip if this group is not allowed at this space's location
                if loc_idx is not None and group_loc_bitmask:
                    if loc_idx < len(group_loc_bitmask) and group_loc_bitmask[loc_idx] == 0:
                        continue
                for s in range(num_s):
                    if not (data["availability"]["trainers"][t][s] and
                            data["availability"]["groups"][g][s]):
                        continue
                    # Skip if this timeslot doesn't run on this space (or its location)
                    if not slot_allows_space(data["raw"]["timeslots"][s], data["raw"]["spaces"][c], location_to_idx):
                        continue

                    x[g, t, c, s] = model.NewBoolVar(f"x_g{g}_t{t}_c{c}_s{s}")

    if not x:
        logger.warning(
            "No valid (group, trainer, space, slot) combinations found. "
            "Check availability and qualification data.",
        )

    rewards = apply_constraints(model, x, data)

    # Hierarchical mode with no reward to optimise has nothing to rank, so it falls
    # through to an ordinary solve (every reward's points are 0 then).
    stages = [key for key in data["reward_order"] if rewards.get(key)]
    if data["reward_mode"] == "hierarchical" and stages:
        return _solve_hierarchical(model, x, data, rewards, stages, progress_queue)

    # Points: minimise the points-weighted total of the penalties.
    points = data["rewards_cfg"]
    score = sum(points[key] * sum(vars_) for key, vars_ in rewards.items())
    model.Minimize(score)

    started = time.monotonic()
    solver = _new_solver(data["max_solve_seconds"] - _tidy_seconds(data))
    callback = SchedulerCallback(x, data, progress_queue, rewards)
    status = solver.Solve(model, callback)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return status, {}

    # The tidy-up never makes the score worse.
    model.Add(score <= round(_score(data, callback.reward_counts)))
    best_bound = solver.BestObjectiveBound()
    reward_counts = _tidy_spaces(model, x, data, rewards, progress_queue, callback.chosen,
                                 started + data["max_solve_seconds"], tidy_bound=best_bound) or callback.reward_counts
    final_score = _score(data, reward_counts)
    return status, {
        "optimal":         status == cp_model.OPTIMAL,
        "elapsed_seconds": round(time.monotonic() - started, 2),
        "stopped_reason":  "optimal" if status == cp_model.OPTIMAL else "time_limit",
        "reward_counts":   reward_counts,
        "final_score":     final_score,
        **_gap(final_score, best_bound),
    }


def _solve_hierarchical(model, x, data, rewards, stages, progress_queue):
    """
    Optimises the rewards one at a time in priority order. After each stage its result
    is locked in, so later stages can never make an earlier reward worse, and the next
    stage starts from the schedule just found.

    The time limit is shared: each stage gets an equal share of the time left, so a stage
    that finishes early passes its spare time on. If a later stage runs out of time
    before finding a schedule, the previous stage's schedule stands.
    """
    started  = time.monotonic()
    deadline = started + data["max_solve_seconds"] - _tidy_seconds(data)  # the rest is for the tidy-up
    status = reward_counts = None
    chosen, stage = [], {}
    all_optimal = True

    for i, key in enumerate(stages):
        objective = sum(rewards[key])
        model.ClearObjective()
        model.Minimize(objective)

        stage = {"stage": i + 1, "stage_count": len(stages), "stage_name": key}
        stage_solver = _new_solver(max(0.0, (deadline - time.monotonic()) / (len(stages) - i)))
        callback = SchedulerCallback(x, data, progress_queue, rewards, stage)
        stage_status = stage_solver.Solve(model, callback)

        if stage_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            if status is None:  # first stage: no schedule at all
                return stage_status, {}
            all_optimal = False
            break

        status, reward_counts, chosen = stage_status, callback.reward_counts, callback.chosen
        all_optimal = all_optimal and stage_status == cp_model.OPTIMAL
        # Lock in the schedule this stage reported (see SchedulerCallback.reward_counts).
        model.Add(objective <= reward_counts[key])
        model.ClearHints()
        for var in x.values():
            model.AddHint(var, stage_solver.Value(var))

    # Every stage's result is locked in, so the tidy-up can't make any reward worse.
    reward_counts = _tidy_spaces(model, x, data, rewards, progress_queue, chosen,
                                 started + data["max_solve_seconds"], stage=stage) or reward_counts
    return status, {
        "optimal":         all_optimal,
        "elapsed_seconds": round(time.monotonic() - started, 2),
        "stopped_reason":  "optimal" if all_optimal else "time_limit",
        "reward_counts":   reward_counts,
    }


def _score(data: dict, reward_counts: dict) -> int:
    """The points-mode score of a schedule: each penalty's count times its points."""
    return sum(data["rewards_cfg"].get(key, 0) * n for key, n in reward_counts.items())


def _tidy_seconds(data: dict) -> float:
    """Time kept back from Max Solve Time for the tidy-up: a tenth of it, at most 5 seconds."""
    return min(5.0, data["max_solve_seconds"] / 10)


def _tidy_spaces(model, x, data, rewards, progress_queue, chosen, deadline, stage=None, tidy_bound=None):
    """
    The tidy-up after the main search: moves sessions into the lowest-numbered free spaces
    (in the order entered on the Locations tab), so a schedule doesn't use Space 2 while
    Space 1 sits empty at the same time. Every session keeps its group, trainer, timeslot
    and location; only the space can change. The caller locks in the score first, so it can't
    get worse. Returns the tidied schedule's reward counts, or None if it found nothing.
    """
    if not chosen:
        return None
    space_venue = data.get("space_venue", {})
    placed = {(g, t, s, space_venue.get(c, "")) for g, t, c, s in chosen}
    for (g, t, c, s), var in x.items():
        if (g, t, s, space_venue.get(c, "")) not in placed:
            model.Add(var == 0)

    # Each space's position within its location: 0 for its first space, 1 for its second.
    position, seen = {}, {}
    for c in range(len(data["raw"]["spaces"])):
        venue = space_venue.get(c, "")
        position[c] = seen.get(venue, 0)
        seen[venue] = position[c] + 1

    model.ClearObjective()
    model.Minimize(sum(position[c] * var for (_, _, c, _), var in x.items()))
    model.ClearHints()
    chosen_set = set(chosen)
    for key, var in x.items():
        model.AddHint(var, 1 if key in chosen_set else 0)

    solver = _new_solver(max(1.0, deadline - time.monotonic()))
    callback = SchedulerCallback(x, data, progress_queue, rewards, stage,
                                 tidy_bound=0 if tidy_bound is None else tidy_bound)
    status = solver.Solve(model, callback)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE) or not callback.reward_counts:
        return None
    return callback.reward_counts


def _new_solver(max_seconds: float):
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(max_seconds)
    solver.parameters.num_search_workers = int(os.getenv("SOLVER_WORKERS", "0"))
    return solver


def _gap(objective: float, best_bound: float) -> dict:
    """How far the score (penalty points, lower is better) could still be above the best
    possible: best_bound is the lowest score any schedule could have."""
    absolute_gap = objective - best_bound
    return {
        "best_bound":   best_bound,
        "absolute_gap": absolute_gap,
        "gap_percent":  round((absolute_gap / objective) * 100, 2) if objective != 0 else 0.0,
    }


def _solve_worker(job_id: str, raw_data: dict, progress_queue):
    """
    Runs in the child process: transform -> solve -> report a single "final"
    message describing the terminal outcome. Improving solutions are streamed
    separately via SchedulerCallback. `stopped_reason` tells the frontend why
    the solver stopped so it can label the result unambiguously.
    """
    try:
        data = transform_data(raw_data)
        data['rewards_cfg'] = raw_data['rewards_cfg']
        data['max_solve_seconds'] = raw_data['max_solve_seconds']
        data['reward_mode']  = raw_data.get('reward_mode', 'points')
        data['reward_order'] = raw_data.get('reward_order', [])

        status, stats = build_and_solve(data, progress_queue)

        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            progress_queue.put({"type": "final", "status": "completed", "stats": stats})
        elif status == cp_model.INFEASIBLE:
            issues = diagnose_infeasibility(data)
            error = (
                "The scheduler couldn't find a schedule that fits your data."
                if issues
                else "The scheduler couldn't find a schedule that fits your data. Your trainers "
                     "are probably needed in too many places at once. Try adding trainers, or "
                     "giving trainers and groups more availability."
            )
            progress_queue.put({
                "type":   "final",
                "status": "failed",
                "stats":  {"error": error, "issues": issues, "stopped_reason": "infeasible"},
            })
        elif status == cp_model.UNKNOWN:
            progress_queue.put({
                "type":   "final",
                "status": "failed",
                "stats":  {
                    "error": (
                        "The scheduler ran out of time before it found a schedule. Give it "
                        "more time with Max Solve Time in Scheduler Settings."
                    ),
                    "stopped_reason": "time_limit",
                },
            })
        else:
            progress_queue.put({
                "type":   "final",
                "status": "failed",
                "stats":  {"error": "Something went wrong while preparing your schedule. Please check your data and try again.",
                           "stopped_reason": "error"},
            })

    except ValueError as e:
        logger.error("Job %s failed during data validation: %s", job_id, e)
        progress_queue.put({
            "type": "final", "status": "failed",
            "stats": {"error": str(e), "stopped_reason": "error"},
        })
    except Exception:
        logger.exception("Job %s failed unexpectedly in solver worker.", job_id)
        progress_queue.put({
            "type": "final", "status": "failed",
            "stats": {"error": "Something went wrong. Please try again.", "stopped_reason": "error"},
        })



def run_solve_task(job_id: str, raw_data: dict):
    """
    Background task (runs in the parent process): spawn a killable solver child,
    stream its progress into shared job state, and finalize. Running the solve in
    a separate process means a cancel (or an OOM) kills only that process and
    frees its memory immediately, instead of taking down the API.
    """
    update_job(job_id, status="processing")

    progress_queue = mp.Queue()
    proc = mp.Process(
        target=_solve_worker,
        args=(job_id, raw_data, progress_queue),
        daemon=True,
    )
    register_process(job_id, proc)
    proc.start()
    update_job(
        job_id,
        status="solving",
        stats={"time_limit_seconds": float(raw_data["max_solve_seconds"])},
    )

    final_seen = False
    try:
        while True:
            try:
                msg = progress_queue.get(timeout=1.0)
            except queue_mod.Empty:
                if not proc.is_alive():
                    break
                continue

            current = get_job(job_id)
            if current and current["status"] == "cancelled":
                break

            if msg["type"] == "progress":
                update_job(job_id, result=msg["result"], stats=msg["stats"])
            elif msg["type"] == "final":
                final_seen = True
                update_job(
                    job_id,
                    status=msg["status"],
                    stats=msg["stats"],
                    result=msg.get("result"),
                )
                break
    finally:
        proc.join(timeout=5)
        if proc.is_alive():
            proc.terminate()
        unregister_process(job_id)

    if not final_seen:
        job = get_job(job_id)
        if job and job["status"] not in ("cancelled", "completed", "failed"):
            update_job(
                job_id,
                status="failed",
                stats={"error": ("The scheduler stopped unexpectedly. It may have run out of "
                                 "memory. Try again with fewer groups or timeslots."),
                       "stopped_reason": "error"},
            )
