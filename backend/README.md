# Backend

FastAPI service that runs the constraint solver and exposes the scheduling API.

## Stack

- **Python 3.11**
- **FastAPI** + Uvicorn: async HTTP server
- **OR-Tools CP-SAT**: Google's constraint programming solver
- **Pydantic**: request/response validation

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
├── examples/            # Simple and Complex Example, copied to the schedules folder on first run
├── desktop.py           # The desktop app: runs the backend on 127.0.0.1 and opens a window
├── doubleshift.spec     # PyInstaller build of the desktop app
├── requirements.txt
└── requirements-desktop.txt   # requirements.txt plus pywebview and PyInstaller
```

The backend also serves the frontend's static build at `/` when it finds one (`frontend/out`, the copy bundled in the desktop app, or `DOUBLESHIFT_FRONTEND_DIR`).

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
| `DOUBLESHIFT_FRONTEND_DIR` | No | `frontend/out` | The frontend's static build to serve at `/` |
| `SOLVER_WORKERS` | No | `0` (all cores) | CP-SAT worker threads |

The solver time limit comes from each schedule's Scheduler Settings (`max_solve_seconds` in the solve request, 10 to 3600, default 120).

## API Reference

### `POST /api/solve` → 202
Starts a background solve job. Returns `{ "job_id": "..." }`.

Request body: groups, trainers, spaces, timeslots, optional travel times and reward config overrides.

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

One boolean variable per `(group, trainer, space, timeslot)` combination. Variables are only created for combinations that pass the pre-filter (availability, qualifications, location restrictions, a trainer being a member of the group). This keeps the model small.

### Hard Constraints (`constraints.py`)

1. Each group assigned to exactly one session
2. At most one group per space at any time
3. A trainer trains at most one group at any time
4. A trainer trains no more groups than their capacity
5. A trainer cannot train while their own group has its session
6. A trainer cannot be at location A at slot S1 and location B at slot S2 if the gap between S1.finish and S2.start is less than the defined travel time

"At any time" compares actual times, not just slot numbers: timeslots on the same day whose times overlap (e.g. 16:30-18:00 and 17:00-18:30) clash, so rules 2, 3 and 5 apply across them too. Likewise, "consecutive" slots (used by the Adjacent Groups Back-to-Back and Same Gender Back-to-Back rewards) are the next slot by start time on the same day, provided the two don't overlap. Timeslots can be entered in any order. A timeslot can also be limited to certain spaces by name (`spaces`, for space-specific timeslots) as well as to locations (`location_bitmask`); `slot_allows_space` checks both.

**Same Day** and **Minimise Wait Time** look at all of a trainer's activities (the sessions they train, and their own group's session). Same Day counts every trainer whose activities fall on at most one day. Wait Time is, per trainer per day, the minutes from their first start to their last finish not spent in a session; its terms are integer minutes rather than 0/1, computed exactly with `AddMinEquality`/`AddMaxEquality`. The helpers for this (`group_slots_by_day`, `clashing_slot_pairs`, `consecutive_slot_pairs`) live in `constraints.py` and are shared with `verify.py`; `lib/scoreBreakdown.ts` mirrors them.

### Soft Constraints / Rewards (`constraints.py`)

All rewards are configurable per schedule on the Scheduler Settings page and passed in `reward_config` (`{ REWARD_KEY: points }`, 0 when off). Points for every reward in `REWARD_KEYS` are required; the backend has no defaults of its own. See the root README for the full reward table.

`apply_constraints()` returns each reward's indicator variables (`{ reward key: [BoolVar] }`, 1 = achieved once, or for the penalty, incurred once). `solver.py` turns them into the objective:

- **Points** (`reward_mode: "points"`): maximise the points-weighted total, penalties subtracted.
- **Priority Order** (`reward_mode: "hierarchical"`): optimise each reward in `reward_order` in turn. After each stage its result is locked in (a constraint), and the next stage starts from that schedule (solution hints). Each stage gets an equal share of the remaining time, so a stage that finishes early passes its spare time on; rewards with nothing to optimise are skipped. Progress stats include `stage`, `stage_count` and `stage_name`.

Both modes report `reward_counts` (how often each reward was achieved) in the final stats, and `POST /api/verify` returns the same counts for an edited schedule (`verify.py` mirrors the reward logic, and its points score is computed from those counts).

### Group Rules

`group_rules` in solve/verify requests: `{ type: "notAtSameTime", groups: [groupID], against: [groupID], required }`. `transform.py` turns them into directed pairs (`group_rule_pairs`: own group, group to avoid conflicts with, required; each direction once, required if any rule requires it). A conflict between two placements is `missed_minutes` (`constraints.py`): the minutes of the other group's session that someone attending all of their own session would miss, allowing for travel between their locations either side; 0 on different days. Required pairs forbid any placements that would clash; preferred pairs add one term per possible clash (minutes × a 0/1 "both placed there" variable) to `PENALTY_GROUP_RULES`. `verify.py` reports broken required rules and counts the minutes for preferred ones; `diagnostics.py` mentions required rules when a run is impossible.

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
- `verify.py` replicates the soft-constraint scoring logic from `constraints.py`: if you change a reward in constraints, update the mirror in verify's `_compute_score()`
- Job state is in-memory only; restarting the server clears all jobs
