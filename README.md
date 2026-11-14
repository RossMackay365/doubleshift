# DoubleShift: Training Scheduler

DoubleShift builds a training schedule for a club or school. You tell it which groups need a session, who can train them, and where and when sessions can happen. It finds a schedule that works for everyone, and then makes it as convenient as it can.

## How It Works

1. **Add your data.** Enter your locations, timeslots, groups and trainers on the Data page.
2. **Run the scheduler.** You see the best schedule so far while it works.
3. **Make it yours.** Drag sessions, swap trainers, and verify your changes before you keep them.

New to the app? Open **Simple Example** or **Complex Example** under Recently Opened on the home page. Both are already filled in. Or choose **Read the Guide** for a walkthrough.

Each schedule (its data, its settings and the last run) is saved as a `.doubleshift` file in `Documents\DoubleShift` (or `./schedules` when running with Docker), so you can back it up or share it like any document.

## Quick Start

```bash
docker compose up
```

Open http://localhost:8000 for the app, or http://localhost:8000/docs for the API docs.

## Desktop App

The Windows app runs the same backend on this computer only, and shows the app in its own window ([pywebview](https://pywebview.flowrl.com/) with Windows' built-in WebView2).

To build the app and its MSIX package for the Microsoft Store:

```powershell
.\build-msix.ps1
```

The app is in `dist\DoubleShift` and the package is `dist\DoubleShift-<version>.msix`. See [packaging/README.md](packaging/README.md) for the one-time setup, the logos, testing and releasing.

To try the app without building it, build the frontend (`npm run build` in `frontend`), then run `.\venv\Scripts\python.exe desktop.py` in `backend`. The app keeps a log in its app data folder (`doubleshift.log`).

## Development

Run the backend and frontend separately to get live reloading. See [backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md).

## Architecture

```
doubleshift/
├── backend/            # FastAPI + OR-Tools: the scheduler and the schedule checks
│   └── desktop.py      # The desktop app: backend plus a window
├── frontend/           # Next.js: data entry, schedule calendar, editing, guide
├── packaging/          # MSIX manifest, logos, third party notices script
├── build-msix.ps1      # Builds the desktop app and its MSIX package
├── Dockerfile          # One image: the frontend build served by the backend
└── docker-compose.yml
```

The frontend is a static site (`output: 'export'`) that the backend serves at `/`, with the API under `/api`. The frontend sends a JSON payload to `POST /api/solve`, receives a `job_id`, and polls `GET /api/status/{job_id}` until the scheduler finishes or reaches its time limit. A separate `POST /api/verify` endpoint checks hand-edited schedules against every rule. The backend runs [Google OR-Tools CP-SAT](https://developers.google.com/optimization/reference/python/sat/python/cp_model) in a separate process.

## Key Concepts

### Locations and Spaces

A **location** is a place where sessions happen. Each location has one or more **spaces**, such as halls, pitches, pools or rooms, and a space holds one session at a time.

### Groups and Trainers

- **Group**: a set of people who train together. Each group gets one session.
- **Trainer**: leads a group's session. A trainer's **capacity** is the most groups they can train.
- **Level**: decides which trainers can train which groups. Level 1 is the most advanced, and a trainer can train any group at their own level or a less advanced one. Level 0 means the trainer does not train.
- A trainer can also be a **member** of a group. They never train their own group, and they are never scheduled to train while their own group has its session.
- **Scheduler Settings** can change this for each schedule. With *Gendered Groups* on, each group is female or male and trainers have a level for each. With *Assign Trainers to Groups* on, you choose each trainer's Training Groups yourself, and the scheduler only picks times and spaces.

### Rewards

Every schedule follows your data. Rewards tell the scheduler which of the possible schedules you prefer, and each one can be switched on or off for each schedule.

In **Priority Order** mode (the default) the rewards are ranked. The scheduler works through them from the top and never gives up a higher reward to improve a lower one. In **Points** mode each reward has points, and the schedule with the most points wins.

| Reward | Default points | What it does |
|---|---|---|
| Same Day | 10,000 | Gives a reward for each trainer whose sessions are all on one day (the sessions they train and their own group's session) |
| No Travel | 100 | Gives a reward for each day a trainer spends at one location, on days when they have two or more sessions (needs two or more locations) |
| Minimise Wait Time (penalty) | 100 per minute | Applies a penalty for each minute a trainer waits between sessions on the same day |
| Group Rules (penalty) | 100 per minute | Applies a penalty for each minute a group's members would miss of a session they want to attend (preferred group rules only; needs the *Group Rules* setting) |
| Available to Sub in Higher Group (penalty) | 10,000 | Applies a penalty each time a trainer can't attend the session of a group one level above their own, because they are training another group at that time |
| Adjacent Groups Back-to-Back | 5,000 | Gives a reward each time two groups one level apart train straight after each other at the same location |
| Adjacent Groups Same Day | 1,000 | Gives a reward each time two groups one level apart train on the same day at the same location, at different times |
| Same Gender Back-to-Back | 1 | Gives a reward each time two sessions for the same gender follow each other in the same space. Useful when you want to avoid equipment or setup changes (needs *Gendered Groups*) |

In Points mode the score is the sum of every reward's points. Priority Order mode has no single score; the Score Breakdown shows how each reward did.

### More Than One Location

If you have more than one location, you can:

- Set the travel time between locations. The scheduler always gives trainers enough time to travel.
- Limit groups and timeslots to certain locations.
- Switch on *Space-Specific Timeslots* (Scheduler Settings) to choose the exact spaces each timeslot runs in, so spaces at one location can have different times.
- Switch on *Name Spaces* to give each space its own name. Two spaces at one location need different names. This is always on with space-specific timeslots.

### Group Rules

With the *Group Rules* setting on, the Data page gets a **Group Rules** tab. Each rule reads "members of these groups can attend those groups' sessions", for example when one group's members also want to join another group's session. A conflict is measured as the minutes of the other session they would miss while attending all of their own, including travel between locations. A rule is either **required** (the schedule must follow it) or **preferred** (each minute missed counts against the Group Rules reward).

## License

DoubleShift is free and open source under the GNU Affero General Public License v3.0 only (AGPL-3.0-only). See [LICENSE](LICENSE).

You can use, change and share it. If you share a changed version, or run one for others over a network, you must release its source code under the same license.
