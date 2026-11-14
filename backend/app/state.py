import time
import threading
from typing import Dict, Any

# Internal storage: { job_id: { "status": str, "stats": dict, "result": list | None,
#                               "updated_at": float } }
_jobs: Dict[str, Any] = {}
_lock = threading.Lock()

_FINISHED_JOB_SECONDS = 60

_TERMINAL_STATUSES = {"completed", "failed", "cancelled"}

# Registry of live solver child processes, keyed by job_id, so the /cancel
# endpoint can terminate the process backing a running job.
_processes: Dict[str, Any] = {}
_proc_lock = threading.Lock()


def register_process(job_id: str, proc) -> None:
    with _proc_lock:
        _processes[job_id] = proc


def unregister_process(job_id: str) -> None:
    with _proc_lock:
        _processes.pop(job_id, None)


def get_process(job_id: str):
    with _proc_lock:
        return _processes.get(job_id)


def _evict_locked():
    """Drop finished jobs older than _FINISHED_JOB_SECONDS. Caller must hold _lock."""
    now = time.monotonic()
    expired = [
        job_id
        for job_id, job in _jobs.items()
        if job["status"] in _TERMINAL_STATUSES
        and now - job["updated_at"] > _FINISHED_JOB_SECONDS
    ]
    for job_id in expired:
        del _jobs[job_id]


def update_job(job_id: str, status: str = None, stats: dict = None, result: list = None):
    with _lock:
        if job_id not in _jobs:
            _jobs[job_id] = {
                "status": "pending",
                "stats": {
                    "solutions_found": 0,
                    "current_score":   None,
                    "final_score":     None,
                    "best_bound":      None,
                    "absolute_gap":    None,
                    "gap_percent":     None,
                    "optimal":         None,
                    "elapsed_seconds": None,
                    "error":           None,
                    "issues":          None,
                },
                "result": None,
                "updated_at": time.monotonic(),
            }

        if status is not None:
            _jobs[job_id]["status"] = status
        if stats is not None:
            _jobs[job_id]["stats"].update(stats)
        if result is not None:
            _jobs[job_id]["result"] = result

        _jobs[job_id]["updated_at"] = time.monotonic()

        _evict_locked()


def get_job(job_id: str):
    with _lock:
        _evict_locked()
        job = _jobs.get(job_id)
        if job is None:
            return None
        return {k: v for k, v in job.items() if k != "updated_at"}
