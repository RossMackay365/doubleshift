from fastapi import FastAPI, BackgroundTasks, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
import uuid
from .schemas import OptimizeRequest, JobStatusResponse, VerifyRequest, VerifyResponse
from .state import get_job, update_job, get_process
from .solver import run_optimization_task
from .verify import verify_schedule
from .auth import login as auth_login, require_auth
from pydantic import BaseModel
from dotenv import load_dotenv
import logging

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)

app = FastAPI(title="Schedule Optimizer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginRequest(BaseModel):
    password: str


@app.post("/auth/login")
async def login(request: LoginRequest):
    token = auth_login(request.password)
    return {"token": token}

@app.post("/optimize", status_code=202, dependencies=[Depends(require_auth)])
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


@app.post("/cancel/{job_id}", dependencies=[Depends(require_auth)])
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


@app.get("/status/{job_id}", response_model=JobStatusResponse, dependencies=[Depends(require_auth)])
async def get_status(job_id: str):
    job_data = get_job(job_id)
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")

    return {"job_id": job_id, **job_data}


@app.post("/verify", response_model=VerifyResponse, dependencies=[Depends(require_auth)])
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
