# Backend

A FastAPI service that runs the solver, saves schedule files and serves the frontend. For what the app does, see the [root README](../README.md).

## Stack

- **Python 3.11 or newer**: the Docker image uses 3.11 and the Windows app is built with 3.12
- **FastAPI** and **Uvicorn**: the HTTP server
- **OR-Tools CP-SAT**: Google's constraint programming solver
- **Pydantic**: request and response validation

## Project Structure

```
backend/
├── app/
│   ├── main.py         # FastAPI app and routes
│   ├── schemas.py      # Pydantic request and response models
│   ├── transform.py    # Turns the frontend payload into solver-ready data
│   ├── solver.py       # Builds the CP-SAT model and runs it in a child process
│   ├── constraints.py  # The hard constraints and rewards applied to the model
│   ├── verify.py       # Checks hand-edited schedules against every constraint
│   ├── diagnostics.py  # Finds likely causes when no schedule is possible
│   ├── schedules.py    # Saved schedules (.doubleshift files) and the recently opened list
│   └── state.py        # In-memory job state (thread-safe)
├── examples/                  # Simple Example and Complex Example, copied to the schedules folder on first run
├── desktop.py                 # The Windows app: runs the backend on 127.0.0.1 and opens a window
├── doubleshift.spec           # PyInstaller build of the Windows app
├── requirements.txt
└── requirements-desktop.txt   # requirements.txt plus pywebview and PyInstaller
```

## Running Locally

Build the frontend first (`npm run build` in `frontend`, see the [frontend README](../frontend/README.md#running-locally)), then:

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt

uvicorn app.main:app --port 8000
```

Open http://localhost:8000 for the app. Interactive API docs are at http://localhost:8000/docs.

The backend serves the frontend's static build at `/` when it finds one. It looks in `DOUBLESHIFT_FRONTEND_DIR`, then the copy bundled in the Windows app, then `frontend/out`. Without a build, the API still runs on its own.

While you work on the backend, add `--reload` to restart it whenever a file changes.

### Windows App

To try the Windows app without packaging it, build the frontend first (`npm run build` in `frontend`), then:

```powershell
cd backend
.\venv\Scripts\python.exe -m pip install -r requirements-desktop.txt
.\venv\Scripts\python.exe desktop.py
```

`desktop.py` starts the backend on a free port on `127.0.0.1` and shows it in a window ([pywebview](https://pywebview.flowrl.com/) with Windows' built-in WebView2). A `.doubleshift` path on the command line opens that schedule straight away. It also gives the page a few functions as `window.pywebview.api`: the Open dialog, the leave warning and the window buttons. The app writes a log to `doubleshift.log` in its data folder.

To build the packaged app, see the [packaging README](../packaging/README.md).

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DOUBLESHIFT_SCHEDULES_DIR` | `Documents\DoubleShift` | Where `.doubleshift` files are saved |
| `DOUBLESHIFT_DATA_DIR` | The user's app data folder | Where the recently opened list and the log are kept |
| `DOUBLESHIFT_FRONTEND_DIR` | `frontend/out` | The frontend's static build to serve at `/` |
| `SOLVER_WORKERS` | `0` (all cores) | CP-SAT worker threads |

All environment variables are optional. The solver time limit is not an environment variable. It comes from each schedule's Scheduler Settings (`max_solve_seconds` in the solve request, 10 to 3600, default 120).

## API Reference

### Solving

| Endpoint | Description |
|---|---|
| `POST /api/solve` | Starts a solve job in the background. Returns 202 and `{ "job_id": "..." }` |
| `GET /api/status/{job_id}` | The job's status, solver statistics and the best schedule found so far. 404 if the job is gone |
| `POST /api/cancel/{job_id}` | Stops a running job and keeps the best schedule found so far |
| `POST /api/verify` | Checks a schedule against every hard constraint and returns any violations, its reward counts and its score |

The solve request holds groups, trainers, spaces, timeslots, travel times, group rules, `reward_config`, `reward_mode`, `reward_order` and `max_solve_seconds`.

Status lifecycle: `pending → processing → solving → completed | failed | cancelled`

Stats include `current_score`, `best_bound`, `gap_percent`, `solutions_found` and `elapsed_seconds`.

### Saved Schedules

Each schedule is a `.doubleshift` file (JSON: `version`, `data`, `settings`, `last_run`) identified by its full path. The file name is the schedule name. `data`, `settings` and `last_run` are stored exactly as the frontend sends them. Each save writes a temporary file and then swaps it in, so a crash never leaves a half-written schedule.

| Endpoint | Description |
|---|---|
| `GET /api/schedules` | `{ folder, schedules }`: the files in the schedules folder, most recently modified first |
| `GET /api/recent` | Recently opened files. Moved or deleted ones are skipped |
| `POST /api/schedules` | Creates `<name>.doubleshift` from `{ name }`. Returns 201, or 409 if the name is taken |
| `POST /api/schedules/import` | Copies an uploaded file into the folder from `{ name, file }`. Returns 201. Renames to `name (2)` if the name is taken |
| `GET /api/schedule?path=` | Reads a file and adds it to the recently opened list |
| `PUT /api/schedule?path=` | Writes the whole file from `{ data, settings, last_run }` |
| `DELETE /api/schedule?path=` | Deletes the file and takes it off the recently opened list. The file goes to the Recycle Bin on Windows and is deleted for good elsewhere. Returns 204, 404 if the file is gone, or 409 if it can't be deleted |

## Data Flow

```
Frontend payload (JSON)
  → transform.py       (normalise IDs, build the qualification matrix and availability arrays)
  → solver.py          (create the CP-SAT model and start the solve in a child process)
  → constraints.py     (add the hard constraints and rewards to the model)
  → SchedulerCallback  (send each better schedule back as it is found)
  → state.py           (in-memory store, read by /api/status)
```

## Solver Design

### Decision Variables

There is one boolean variable for each `(group, trainer, space, timeslot)` combination. A variable is only created when the combination passes the pre-filter: the group and trainer are both available, the trainer is qualified, the location is allowed, and the trainer is not a member of the group. Availability and qualifications are therefore enforced by leaving variables out, which keeps the model small.

### Hard Constraints (`constraints.py`)

1. Each group gets exactly one session.
2. A space holds at most one group at any time.
3. A trainer trains at most one group at any time.
4. A trainer trains no more groups than their capacity.
5. A trainer never trains while their own group has its session.
6. A trainer can't be at one location and then another if the gap between the two sessions is shorter than the travel time.
7. Required group rules are never broken (see Group Rules below).

"At any time" compares actual times, not slot numbers. Timeslots on the same day whose times overlap (such as 16:30-18:00 and 17:00-18:30) clash, so constraints 2, 3 and 5 apply across them too. Timeslots can be entered in any order.

A timeslot can be limited to locations (`location_bitmask`) or, with space-specific timeslots, to spaces by name (`spaces`). `slot_allows_space` checks both.

### Rewards (`constraints.py`)

Rewards are the soft constraints. Each schedule's Scheduler Settings decide them, and they arrive in `reward_config` (`{ REWARD_KEY: points }`, 0 when off). Points for every reward in `REWARD_KEYS` are required. The backend has no defaults of its own. See the [root README](../README.md#rewards) for the reward table.

`apply_constraints()` returns each reward's terms (`{ reward key: [variables] }`). Most terms are 0 or 1: a reward achieved once, or a penalty incurred once. The two per-minute penalties use integer minutes. `solver.py` turns the terms into the objective:

- **Points** (`reward_mode: "points"`): maximise the points-weighted total, with penalties subtracted.
- **Priority Order** (`reward_mode: "hierarchical"`): optimise each reward in `reward_order` in turn. After each stage its result is locked in as a constraint, and the next stage starts from that schedule as a hint. Each stage gets an equal share of the remaining time, so a stage that finishes early passes its spare time on. Rewards with nothing to optimise are skipped. Progress stats include `stage`, `stage_count` and `stage_name`.

Both modes report `reward_counts` (how often each reward was achieved) in the final stats. `POST /api/verify` returns the same counts for an edited schedule.

Some details of how rewards are measured:

- **Same Day** and **Minimise Wait Time** look at all of a trainer's activities: the sessions they train and their own group's session. Same Day counts every trainer whose activities fall on at most one day. Wait time is, for each trainer and day, the minutes from their first start to their last finish that are not spent in a session. It is computed exactly with `AddMinEquality` and `AddMaxEquality`.
- **Back-to-back** rewards use "consecutive" timeslots: the next slot by start time on the same day, provided the two don't overlap.
- The shared helpers (`group_slots_by_day`, `clashing_slot_pairs`, `consecutive_slot_pairs`) live in `constraints.py`. `verify.py` uses them too, and the frontend's `lib/scoreBreakdown.ts` mirrors them.

### Group Rules

Solve and verify requests carry `group_rules`: `{ type: "notAtSameTime", groups: [groupID], against: [groupID], required }`. `transform.py` turns them into directed pairs (`group_rule_pairs`): own group, the group to avoid conflicts with, and whether it is required. Each direction appears once, and is required if any rule requires it.

A conflict between two placements is `missed_minutes` (`constraints.py`): the minutes of the other group's session that someone attending all of their own session would miss, allowing for travel between the two locations. It is 0 on different days.

- **Required** pairs forbid any placements that would clash.
- **Preferred** pairs add one term for each possible clash to `PENALTY_GROUP_RULES`: the minutes missed, times a 0 or 1 variable for "both placed there".

`verify.py` reports broken required rules and counts the minutes for preferred ones. `diagnostics.py` mentions required rules when no schedule is possible.

### Assigned Trainers

With `assign_trainers: true`, each trainer's `assigned_groups` (group IDs) replace level-based qualifications. A trainer qualifies only for the groups they are assigned. Diagnostics then report groups with no trainer assigned, not qualification problems.

### Live Results

The solver uses a `CpSolverSolutionCallback` that fires each time it finds a better schedule. The child process sends the schedule and its statistics back over a queue, and the backend writes them to `state.py` straight away, so the frontend can show the best schedule so far while the solve continues.

### When No Schedule Is Possible (`diagnostics.py`)

When the solver returns INFEASIBLE, `diagnose_infeasibility()` runs a set of independent checks for likely causes: groups no trainer can train, availability gaps, trainer bottlenecks, too much demand on one day, and capacity shortfalls for one gender. It reports every failing check, not just the first.

## Notes for Contributors

- `transform.py` turns all IDs into strings, to prevent int and str mismatches between the frontend and the solver.
- Availability and location restrictions are bitmask arrays, with one entry for each timeslot or location.
- `verify.py` repeats the reward scoring from `constraints.py`. If you change a reward in `constraints.py`, update `_compute_score()` in `verify.py` and the frontend's `lib/scoreBreakdown.ts` too.
- Job state is in memory only. Restarting the server clears all jobs.
