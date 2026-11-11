# DoubleShift: Training Scheduler

An app for scheduling training sessions. Given groups, trainers, courts, and timeslots, it uses constraint programming to produce a schedule that satisfies hard rules (qualifications, availability, court capacity, travel time) while maximising soft objectives (trainer convenience, session adjacency).

## How It Works

1. **Data** — enter your groups, trainers, courts, and timeslots on the Data page
2. **Run** — submit to the solver; intermediate results appear in real time as the solver improves its solution
3. **Edit** — drag and drop sessions, swap trainers, then verify before saving

Each schedule (input data, reward settings and the last run) is saved as a `.doubleshift` file in `Documents\DoubleShift` (or `./schedules` when running with Docker), so it can be backed up or shared like any document. The backend runs [Google OR-Tools CP-SAT](https://developers.google.com/optimization/reference/python/sat/python/cp_model) in a background thread and exposes progress via a polling endpoint.

## Quick Start

```bash
# Optional: override solver settings (e.g. MAX_SOLVE_TIME)
cp backend/.env.example backend/.env

docker compose up
```

| Service  | URL                    |
|----------|------------------------|
| Frontend | http://localhost:3000  |
| Backend  | http://localhost:8000  |
| API docs | http://localhost:8000/docs |

## Running Without Docker

See [backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md) for per-service instructions.

## Architecture

```
schedule-optimiser/
├── backend/            # FastAPI + OR-Tools — solver, constraint checking
├── frontend/           # Next.js — data entry, schedule grid, editing UI
└── docker-compose.yml  # local dev orchestration
```

The two services communicate over HTTP. The frontend sends a JSON payload to `POST /api/optimize`, receives a `job_id`, and polls `GET /api/status/{job_id}` until the solver finishes or times out. A separate `POST /api/verify` endpoint lets users validate hand-edited schedules against all constraints.

## Key Concepts

### Groups and Trainers

- **Group** — a training group defined by gender (`female`/`male`) and level, with levels defined per gender
- **Trainer** — has separate skill ranks for each gender; a trainer qualifies for a group when their rank ≤ the group's level
- A trainer can also be a **player** (member of a group). The solver prevents them from coaching a group they play in, and prevents coaching and playing in the same timeslot.
- Player-trainers have a **day preference**: tick *Same day* to coach on the day they play, *Different day* to coach on another day, or both/neither for no preference. Ticking **Required** makes it a hard constraint (the schedule is infeasible if it isn't met, and Verify reports which assignment breaks it); otherwise it is scored via the Day Preference reward. The Back-to-Back reward only applies to trainers who accept same-day coaching.

### Scoring

Schedules are scored by soft rewards (all configurable):

| Reward | Default | Purpose |
|---|---|---|
| Day Preference | 1,000,000 | Trainer's same-day / different-day preference is met (non-required preferences only) |
| Back-to-Back | 10,000 | Trainer's coaching and playing slots are adjacent (same-day-accepting trainers only) |
| No Travel | 100 | Trainer stays at one venue all day |
| Adjacent Groups B2B | 5,000 | Same-gender groups with adjacent levels are scheduled consecutively |
| Adjacent Groups Same Day | 1,000 | Same as above but just same day |
| No Net Height Changes | 1 | Same-gender groups on the same court in consecutive slots |
| Trainer Cannot Sub Up (penalty) | −10,000 | A trainer cannot sub in a higher group due to giving training |

Scores are displayed divided by 10,000 in the UI to keep the numbers readable.

### Multi-Venue Support

If you define more than one location, you can:
- Set travel times between venues (enforced as hard constraints)
- Restrict groups and timeslots to specific locations via the location bitmask
- Earn the No Travel reward when a trainer stays at one venue all day
