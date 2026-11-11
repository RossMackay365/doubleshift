from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uuid
from .schemas import OptimizeRequest, JobStatusResponse, VerifyRequest, VerifyResponse
from .state import get_job, update_job, get_process
from .solver import run_optimization_task
from .verify import verify_schedule
from . import schedules
from pydantic import BaseModel
from typing import Any
from dotenv import load_dotenv
import logging

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)

app = FastAPI(title="DoubleShift API")

schedules.init()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/optimize", status_code=202)
async def optimize(request: OptimizeRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    update_job(job_id, status="pending")

    raw_data = {
        "groups":         [g.model_dump() for g in request.groups],
        "trainers":       [t.model_dump() for t in request.trainers],
        "courts":         [c.model_dump() for c in request.courts],
        "timeslots":      [s.model_dump() for s in request.timeslots],
        "travel_times":   [tt.model_dump() for tt in request.travel_times],
        "location_names": request.location_names,
        "rewards_cfg":    dict(request.reward_config) if request.reward_config else {},
    }

    background_tasks.add_task(run_optimization_task, job_id, raw_data)

    return {"job_id": job_id, "message": "Optimization task started"}


@app.post("/api/cancel/{job_id}")
async def cancel(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Already finished — nothing to stop; report the terminal state as-is.
    if job["status"] in ("completed", "failed", "cancelled"):
        return {"job_id": job_id, "status": job["status"], "message": "Job already finished"}

    # Kill the solver child process, freeing its memory immediately. The best
    # schedule found so far is left in place so the user can still edit/verify it.
    proc = get_process(job_id)
    if proc is not None and proc.is_alive():
        proc.terminate()

    update_job(job_id, status="cancelled", stats={"stopped_reason": "cancelled"})
    return {"job_id": job_id, "status": "cancelled", "message": "Cancellation requested"}


@app.get("/api/status/{job_id}", response_model=JobStatusResponse)
async def get_status(job_id: str):
    job_data = get_job(job_id)
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")

    return {"job_id": job_id, **job_data}


@app.post("/api/verify", response_model=VerifyResponse)
async def verify(request: VerifyRequest):
    raw_data = {
        "groups":         [g.model_dump() for g in request.groups],
        "trainers":       [t.model_dump() for t in request.trainers],
        "courts":         [c.model_dump() for c in request.courts],
        "timeslots":      [s.model_dump() for s in request.timeslots],
        "travel_times":   [tt.model_dump() for tt in request.travel_times],
        "location_names": request.location_names,
    }

    schedule_entries = [e.model_dump() for e in request.schedule]

    # Verify only checks feasibility and computes the schedule's score — it needs
    # no job state. The optimality gap is derived on the frontend, which already
    # holds the solver's best_bound from the run.
    try:
        result = verify_schedule(raw_data, schedule_entries, rewards_cfg=dict(request.reward_config) if request.reward_config else {})
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


# --- Saved schedules (.doubleshift files) ---
# A schedule is identified by its file path. data, reward_config and last_run are
# stored exactly as the frontend sends them.

class ScheduleCreate(BaseModel):
    name: str


class ScheduleContents(BaseModel):
    data: Any = None
    reward_config: Any = None
    last_run: Any = None


class ScheduleImport(BaseModel):
    name: str
    file: Any  # the parsed contents of the .doubleshift file


@app.get("/api/schedules")
def list_schedules():
    return {"folder": schedules.SCHEDULES_DIR, "schedules": schedules.list_schedules()}


@app.get("/api/recent")
def recent_schedules():
    return schedules.recent_schedules()


@app.post("/api/schedules", status_code=201)
def create_schedule(request: ScheduleCreate):
    try:
        return schedules.create_schedule(request.name)
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/api/schedules/import", status_code=201)
def import_schedule(request: ScheduleImport):
    """Copy an uploaded file into the schedules folder (used when running in a browser)."""
    try:
        contents = schedules.validate_contents(request.file)
        return schedules.create_schedule(request.name, contents, rename_if_taken=True)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.get("/api/schedule")
def get_schedule(path: str):
    try:
        schedule = schedules.read_schedule(path)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return schedule


@app.put("/api/schedule")
def save_schedule(path: str, request: ScheduleContents):
    try:
        schedules.save_schedule(path, request.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"ok": True}
