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
│   ├── config.py       # Default reward values and merge logic
│   ├── state.py        # In-memory job state (thread-safe)
│   └── auth.py         # Password-based auth, Bearer token validation
├── requirements.txt
├── Dockerfile
└── .env                # Not committed — create this yourself (see below)
```

## Running Locally

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Create .env with at minimum:
echo "APP_PASSWORD=yourpassword" > .env

uvicorn app.main:app --reload --port 8000
```

API docs are available at http://localhost:8000/docs once running.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_PASSWORD` | Yes | — | Password users enter on the login page |
| `MAX_SOLVE_TIME` | No | `60` | Solver time limit in seconds |

## API Reference

All endpoints except `/auth/login` require an `Authorization: Bearer <token>` header.

### `POST /auth/login`
```json
{ "password": "..." }
```
Returns `{ "token": "..." }`. Tokens are stored in memory and survive until the server restarts.

### `POST /optimize` → 202
Starts a background solve job. Returns `{ "job_id": "..." }`.

Request body: groups, trainers, courts, timeslots, optional travel times and reward config overrides.

### `GET /status/{job_id}`
Polls job progress. Returns the current status, solver statistics, and the best schedule found so far.

Status lifecycle: `pending → processing → solving → completed | failed`

Stats include `current_score`, `best_bound`, `gap_percent`, `solutions_found`, `elapsed_seconds`.

### `POST /verify`
Validates a (potentially user-edited) schedule against all hard constraints and returns its soft-constraint score. Accepts an optional `job_id` to compare against the original solver's best bound.

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
7. A player-trainer with a **required** day preference must coach only on the day they play (`same`) or never on that day (`different`). Non-required preferences are scored instead (Day Preference reward).

### Soft Constraints / Rewards (`constraints.py`, `config.py`)

All rewards are configurable by the user via the UI and passed in `reward_config`. See the root README for the full reward table.

### Live Results

The solver uses a `CpSolverSolutionCallback` that fires each time a new best solution is found. It writes the current schedule and gap statistics to `state.py` immediately, so the frontend can display partial results while solving continues.

### Infeasibility Diagnostics (`diagnostics.py`)

When the solver returns INFEASIBLE, `diagnose_infeasibility()` runs a series of independent checks to identify likely causes: unqualified groups, availability gaps, trainer bottlenecks, required day preferences (a definitive conflict when a required trainer is the only option for a group whose days can't satisfy the rule, otherwise a general hint), per-day over-demand, and gender-stratified capacity shortfalls. All failing checks are reported (not just the first).

## Data Flow

```
Frontend payload (JSON)
  → transform.py       (normalise IDs, build quals matrix, availability arrays)
  → solver.py          (create CP-SAT model, apply constraints, start solve)
  → constraints.py     (add hard + soft constraints to model)
  → SchedulerCallback  (stream intermediate results to state.py)
  → state.py           (in-memory store, polled by /status)
```

## Authentication

Single shared password stored in `APP_PASSWORD`. On successful login, a random UUID token is generated and stored in a server-side in-memory set. Tokens never expire; they are cleared on server restart. This is intentionally simple — the app is designed for trusted internal use.

## Notes for Contributors

- `transform.py` normalises all IDs to strings to prevent int/str type mismatches between the frontend and solver
- Availability and location restrictions are represented as bitmask arrays (one entry per timeslot or location)
- `verify.py` replicates the soft-constraint scoring logic from `constraints.py` — if you change a reward in constraints, update the mirror in verify's `_compute_score()`
- Job state is in-memory only; restarting the server clears all jobs
