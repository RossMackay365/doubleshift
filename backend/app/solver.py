from ortools.sat.python import cp_model
from .constraints import apply_constraints
from .transform import transform_data
from .diagnostics import diagnose_infeasibility
from .state import update_job, get_job, register_process, unregister_process
import multiprocessing as mp
import queue as queue_mod
import os
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
    def __init__(self, x: dict, data: dict, progress_queue):
        super().__init__()
        self._x = x
        self._data = data
        self._queue = progress_queue
        self._solution_count = 0

    def on_solution_callback(self):
        self._solution_count += 1

        # Extract the current assignment while variable values are accessible.
        # Once the solver moves on, these values are gone.
        current_schedule = []
        for key, var in self._x.items():
            if self.Value(var) == 1:
                g_i, t_i, c_i, s_i = key
                current_schedule.append({
                    "group":    self._data["raw"]["groups"][g_i]["name"],
                    "trainer":  self._data["raw"]["trainers"][t_i]["name"],
                    "court":    self._data["raw"]["courts"][c_i]["courtName"],
                    "timeslot": self._data["raw"]["timeslots"][s_i]["id"],
                })

        objective = self.ObjectiveValue()
        stats = {
            "solutions_found": self._solution_count,
            "current_score":   objective,
            "elapsed_seconds": round(self.WallTime(), 2),
        }
        try:
            best_bound   = self.BestObjectiveBound()
            absolute_gap = best_bound - objective
            gap_pct      = round((absolute_gap / best_bound) * 100, 2) if best_bound != 0 else 0.0
            stats.update({
                "best_bound":   best_bound,
                "absolute_gap": absolute_gap,
                "gap_percent":  gap_pct,
            })
        except Exception as e:
            logger.warning("Could not compute gap: %s", e)

        self._queue.put({"type": "progress", "result": current_schedule, "stats": stats})



def build_and_solve(data: dict, progress_queue):
    """
    Initializes the CP-SAT model, creates decision variables,
    applies constraints, and returns the solver and status.
    """
    model = cp_model.CpModel()

    num_g = len(data["indices"]["g"])
    num_t = len(data["indices"]["t"])
    num_c = len(data["indices"]["c"])
    num_s = len(data["indices"]["s"])

    trainer_keys = list(data["indices"]["t"].keys())

    court_venue     = data.get("court_venue", {})
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
                venue   = court_venue.get(c, "")
                loc_idx = location_to_idx.get(venue)
                # Skip if this group is not allowed at this court's location
                if loc_idx is not None and group_loc_bitmask:
                    if loc_idx < len(group_loc_bitmask) and group_loc_bitmask[loc_idx] == 0:
                        continue
                for s in range(num_s):
                    if not (data["availability"]["trainers"][t][s] and
                            data["availability"]["groups"][g][s]):
                        continue
                    # Skip if this timeslot does not apply to this court's location
                    if loc_idx is not None:
                        ts_loc = data["raw"]["timeslots"][s].get("location_bitmask", [])
                        if ts_loc and loc_idx < len(ts_loc) and ts_loc[loc_idx] == 0:
                            continue

                    x[g, t, c, s] = model.NewBoolVar(f"x_g{g}_t{t}_c{c}_s{s}")

    if not x:
        logger.warning(
            "No valid (group, trainer, court, slot) combinations found. "
            "Check availability and qualification data.",
        )

    apply_constraints(model, x, data)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(os.getenv("MAX_SOLVE_TIME", "120"))
    # Use all available CPU cores for the fastest solve. 0 = let CP-SAT decide
    # (one worker per core). Peak memory is bounded instead by the container's
    # mem_limit combined with running the solve in a killable child process: if
    # a run exceeds the budget the OS kills only the child, not the API. Set
    # SOLVER_WORKERS to a small number as an escape hatch if OOM-kills recur.
    solver.parameters.num_search_workers = int(os.getenv("SOLVER_WORKERS", "0"))

    callback = SchedulerCallback(x, data, progress_queue)
    status = solver.Solve(model, callback)

    return solver, status


def _compute_gap(solver) -> dict:
    """
    Computes the optimality gap between the best solution found and the
    theoretical upper bound. Only call this when status is FEASIBLE or OPTIMAL.
    """
    objective    = solver.ObjectiveValue()
    best_bound   = solver.BestObjectiveBound()
    absolute_gap = best_bound - objective
    gap_pct      = round((absolute_gap / best_bound) * 100, 2) if best_bound != 0 else 0.0

    return {
        "final_score":  objective,
        "best_bound":   best_bound,
        "absolute_gap": absolute_gap,
        "gap_percent":  gap_pct,
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
        data['rewards_cfg'] = raw_data.get('rewards_cfg', {})

        solver, status = build_and_solve(data, progress_queue)

        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            gap = _compute_gap(solver)
            progress_queue.put({
                "type":   "final",
                "status": "completed",
                "stats": {
                    "optimal":         status == cp_model.OPTIMAL,
                    "elapsed_seconds": round(solver.WallTime(), 2),
                    "stopped_reason":  "optimal" if status == cp_model.OPTIMAL else "time_limit",
                    **gap,
                },
            })
        elif status == cp_model.INFEASIBLE:
            issues = diagnose_infeasibility(data)
            error = (
                "No feasible schedule exists with the current data."
                if issues
                else "No feasible schedule exists. Trainer/slot conflicts across "
                     "groups are likely — try adding trainers or relaxing availability."
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
                        "Solver timed out before finding a solution. Try increasing "
                        "MAX_SOLVE_TIME or reducing the problem size."
                    ),
                    "stopped_reason": "time_limit",
                },
            })
        else:
            progress_queue.put({
                "type":   "final",
                "status": "failed",
                "stats":  {"error": "Solver could not process the model (invalid).",
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
            "stats": {"error": "Internal error.", "stopped_reason": "error"},
        })



def run_optimization_task(job_id: str, raw_data: dict):
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
        stats={"time_limit_seconds": float(os.getenv("MAX_SOLVE_TIME", "120"))},
    )

    final_seen = False
    try:
        while True:
            try:
                msg = progress_queue.get(timeout=1.0)
            except queue_mod.Empty:
                # No message this second — stop once the child is gone.
                if not proc.is_alive():
                    break
                continue

            # A cancel may have landed while we were reading. Never resurrect a
            # cancelled job by writing a later progress/final update over it.
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
                    result=msg.get("result"),  # None keeps the best-so-far result
                )
                break
    finally:
        proc.join(timeout=5)
        if proc.is_alive():
            proc.terminate()
        unregister_process(job_id)

    # Child died without reporting a terminal outcome (e.g. killed by OOM) and
    # the job wasn't cancelled — surface it rather than leaving it "solving".
    if not final_seen:
        job = get_job(job_id)
        if job and job["status"] not in ("cancelled", "completed", "failed"):
            update_job(
                job_id,
                status="failed",
                stats={"error": ("The solver stopped unexpectedly — it likely ran out of "
                                 "memory. Try reducing the problem size or lowering "
                                 "SOLVER_WORKERS."),
                       "stopped_reason": "error"},
            )
