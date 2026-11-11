# Backend

FastAPI service that runs the constraint solver and exposes the scheduling API.

## Stack

- **Python 3.11**
- **FastAPI** + Uvicorn — async HTTP server
- **OR-Tools CP-SAT** — Google's constraint programming solver
- **Pydantic** — request/response validation

## Project Structure

```
backend/
├── app/
│   ├── main.py         # FastAPI app, route definitions
│   ├── schemas.py      # Pydantic request/response models
│   ├── solver.py       # CP-SAT model construction and background task
│   ├── constraints.py  # Hard and soft constraints applied to the model
│   ├── transform.py    # Converts frontend payload into solver-ready data structures
│   ├── verify.py       # Validates user-edited schedules against all constraints
│   ├── diagnostics.py  # Post-INFEASIBLE analysis: diagnoses likely causes
│   ├── schedules.py    # Saved schedules (.doubleshift files) and the recently opened list
│   └── state.py        # In-memory job state (thread-safe)
├── requirements.txt
├── Dockerfile
```

## Running Locally

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt

uvicorn app.main:app --reload --port 8000
```

API docs are available at http://localhost:8000/docs once running.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DOUBLESHIFT_SCHEDULES_DIR` | No | `Documents\DoubleShift` | Where `.doubleshift` files are saved |
| `DOUBLESHIFT_DATA_DIR` | No | per-user app data folder | Where the recently opened list is kept |
| `SOLVER_WORKERS` | No | `0` (all cores) | CP-SAT worker threads |

The solver time limit comes from each schedule's Scheduler Settings (`max_solve_seconds` in the optimize request, 10–3600, default 120).

## API Reference

### `POST /api/optimize` → 202
Starts a background solve job. Returns `{ "job_id": "..." }`.

Request body: groups, trainers, courts, timeslots, optional travel times and reward config overrides.

### `GET /api/status/{job_id}`
Polls job progress. Returns the current status, solver statistics, and the best schedule found so far.

Status lifecycle: `pending → processing → solving → completed | failed`

Stats include `current_score`, `best_bound`, `gap_percent`, `solutions_found`, `elapsed_seconds`.

### `POST /api/cancel/{job_id}`
Stops a running job, keeping the best schedule found so far.

### `POST /api/verify`
Validates a (potentially user-edited) schedule against all hard constraints and returns its soft-constraint score.

### Saved schedules
Each schedule is a `.doubleshift` file (JSON: `version`, `data`, `settings`, `last_run`) identified by its full path; the file name is the schedule name. `data`, `settings` and `last_run` are stored exactly as the frontend sends them. Files are written to a temporary file and then swapped in, so a crash never leaves a half-written schedule.

| Endpoint | Description |
|---|---|
| `GET /api/schedules` | `{ folder, schedules }`: files in the schedules folder, most recently modified first |
| `GET /api/recent` | Recently opened files (moved or deleted ones are skipped) |
| `POST /api/schedules` | Create `<name>.doubleshift`: `{ name }`. 409 if the name is taken |
| `POST /api/schedules/import` | Copy an uploaded file into the folder: `{ name, file }`. Renames to `name (2)` if taken |
| `GET /api/schedule?path=` | Read a file and add it to the recent list |
| `PUT /api/schedule?path=` | Write the whole file: `{ data, settings, last_run }` |

## Solver Design

### Decision Variables

One boolean variable per `(group, trainer, court, timeslot)` combination. Variables are only created for combinations that pass the pre-filter (availability, qualifications, location restrictions, trainer-player membership). This keeps the model small.

### Hard Constraints (`constraints.py`)

1. Each group assigned to exactly one session
2. At most one group per court per timeslot
3. At most one group per trainer per timeslot
4. Total coaching assignments ≤ trainer capacity
5. A trainer cannot coach and play in the same timeslot
6. A trainer cannot be at venue A at slot S1 and venue B at slot S2 if the gap between S1.finish and S2.start is less than the defined travel time

### Soft Constraints / Rewards (`constraints.py`)

All rewards are configurable per schedule on the Scheduler Settings page and passed in `reward_config` (`{ REWARD_KEY: points }`, 0 when off). Points for every reward in `REWARD_KEYS` are required; the backend has no defaults of its own. See the root README for the full reward table.

`apply_constraints()` returns each reward's indicator variables (`{ reward key: [BoolVar] }`, 1 = achieved once, or for the penalty, incurred once). `solver.py` turns them into the objective:

- **Points** (`reward_mode: "points"`): maximise the points-weighted total, penalties subtracted.
- **Hierarchical** (`reward_mode: "hierarchical"`): optimise each reward in `reward_order` in turn. After each stage its result is locked in (a constraint), and the next stage starts from that schedule (solution hints). Each stage gets an equal share of the remaining time, so a stage that finishes early passes its spare time on; rewards with nothing to optimise are skipped. Progress stats include `stage`, `stage_count` and `stage_name`.

Both modes report `reward_counts` (how often each reward was achieved) in the final stats, and `POST /api/verify` returns the same counts for an edited schedule (`verify.py` mirrors the reward logic, and its points score is computed from those counts).

### Assigned Trainers

With `assign_trainers: true`, each trainer's `assigned_groups` (group IDs) replace level-based qualifications: a trainer qualifies only for the groups they're assigned. Diagnostics then report groups with no trainer assigned instead of qualification-coverage problems.

### Live Results

The solver uses a `CpSolverSolutionCallback` that fires each time a new best solution is found. It writes the current schedule and gap statistics to `state.py` immediately, so the frontend can display partial results while solving continues.

### Infeasibility Diagnostics (`diagnostics.py`)

When the solver returns INFEASIBLE, `diagnose_infeasibility()` runs a series of independent checks to identify likely causes: unqualified groups, availability gaps, trainer bottlenecks, per-day over-demand, and gender-stratified capacity shortfalls. All failing checks are reported (not just the first).

## Data Flow

```
Frontend payload (JSON)
  → transform.py       (normalise IDs, build quals matrix, availability arrays)
  → solver.py          (create CP-SAT model, apply constraints, start solve)
  → constraints.py     (add hard + soft constraints to model)
  → SchedulerCallback  (stream intermediate results to state.py)
  → state.py           (in-memory store, polled by /status)
```

## Notes for Contributors

- `transform.py` normalises all IDs to strings to prevent int/str type mismatches between the frontend and solver
- Availability and location restrictions are represented as bitmask arrays (one entry per timeslot or location)
- `verify.py` replicates the soft-constraint scoring logic from `constraints.py` — if you change a reward in constraints, update the mirror in verify's `_compute_score()`
- Job state is in-memory only; restarting the server clears all jobs
