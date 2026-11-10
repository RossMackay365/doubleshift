# Frontend

Next.js app for entering scheduling data, running the optimiser, and viewing/editing the resulting schedule.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 4**
- **Lucide React** — icons

## Project Structure

```
frontend/src/
├── app/
│   ├── page.tsx                 # Root — redirects to /data
│   ├── data/page.tsx            # Data entry: locations, timeslots, groups, trainers
│   ├── run/page.tsx             # Run scheduler, view results, edit schedule
│   └── login/page.tsx           # Password login
├── components/
│   ├── AuthGuard.tsx            # Wraps pages; redirects to /login if no token
│   ├── Nav.tsx                  # Top navigation bar
│   ├── EditableTable.tsx        # Generic editable table with paste support
│   ├── ScheduleGrid.tsx         # Schedule display with drag-and-drop edit mode
│   ├── ConfigPanel.tsx          # Reward settings modal
│   └── ScoreBreakdownPanel.tsx  # Per-reward score breakdown
└── lib/
    ├── types.ts             # TypeScript interfaces for all domain entities
    ├── api.ts               # HTTP client for backend endpoints
    ├── storage.ts           # localStorage persistence helpers
    ├── rewardConfig.ts      # Default reward values and config utilities
    └── scoreBreakdown.ts    # Client-side score calculation (mirrors backend)
```

## Running Locally

```bash
cd frontend
npm install

# Point at your local backend (default shown below)
echo "NEXT_PUBLIC_BACKEND_API_URL=http://localhost:8000" > .env.local

npm run dev
```

Open http://localhost:3000.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_BACKEND_API_URL` | Yes | `http://localhost:8000` | Backend base URL |

## Key Concepts

### Data Entry (`/data`)

Data is stored in `localStorage` under the key `schedule_optimiser`. The four tabs — Locations, Timeslots, Groups, Trainers — each render an `EditableTable`. You can paste directly from a spreadsheet; the table's `parsePaste` callbacks handle column-aware parsing.

**Availability** and **location** columns use bitmask arrays: one bit per timeslot/location, 1 = active. These render as inline checkbox grids rather than raw numbers. Paste `1,0,1,0` or a tab-separated row of `TRUE`/`FALSE` values and they will be interpreted correctly.

**Trainer Group** — each trainer optionally belongs to one group (they "play" in it). This field is a dropdown populated from the Groups tab. At send-time, the group name is resolved to the group's generated ID.

### ID Generation (`lib/api.ts`)

The frontend stores entities without IDs to keep the localStorage schema clean. `withIDs()` in `api.ts` generates sequential IDs (`g0, g1…`, `t0, t1…`, `0, 1…`) immediately before sending a request to the backend. It also:
- Expands `Location[]` into flat `Court[]` (e.g. "Club A" with 3 courts → "Club A 1", "Club A 2", "Club A 3")
- Resolves `trainer.groupID` from a group name to the generated `groupID`

### Running the Solver (`/run`)

Clicking **Run** calls `POST /optimize` and then polls `GET /status/{job_id}` every second. Intermediate solutions appear in the schedule grid as they are found. The gap percentage shows how far the current solution is from the theoretical optimum.

Scores are displayed divided by 10,000. The solver uses large integers internally to keep everything in integer arithmetic; the division produces a more readable decimal.

### Editing a Schedule

**Edit mode** is entered via the Edit Schedule button. In edit mode:
- Drag a session card to a different cell to move it; dropping on an occupied cell swaps the two sessions
- Use the dropdown on a card to change the trainer
- **Verify** sends the edited schedule to `POST /verify` — the backend checks all hard constraints and returns any violations plus a score
- **Save changes** is only enabled after a clean verify

Ctrl/Cmd+S in edit mode triggers verify-and-save automatically.

### Reward Configuration

The ConfigPanel lets users toggle rewards on/off and adjust their values before a run. The config is saved to `localStorage` and sent as `reward_config` in the optimize/verify payloads. If a reward is disabled its value is sent as `0`. Settings are locked while a schedule is being edited to keep score comparisons meaningful.

### Score Breakdown

`computeScoreBreakdown()` in `lib/scoreBreakdown.ts` calculates a per-reward breakdown client-side, mirroring the backend's scoring logic. The result drives `ScoreBreakdownPanel`, which shows per-trainer Day Preference / B2B contributions, No Travel trainer-days, and adjacent group statistics including penalty occurrences.

### Authentication

The auth token from `POST /auth/login` is stored in `sessionStorage` (cleared on tab close, unlike `localStorage`). `AuthGuard` checks `sessionStorage` on every navigation and redirects to `/login` if the token is absent. `fetchWithAuth` in `api.ts` attaches the token as a `Bearer` header and redirects to `/login` on any 401.

## Notes for Contributors

- There is no external state library. State lives in `useState`/`useRef` within each page component, with persistence via `lib/storage.ts`.
- `runRewardConfigRef` in `run/page.tsx` is a ref rather than state so it can be read inside the polling closure without stale capture.
- `scoreBreakdown.ts` must stay in sync with the backend's `_compute_score()` in `verify.py`. If you add or change a reward in the backend, update both.
