# Frontend

Next.js app for entering scheduling data, running the optimiser, and viewing/editing the resulting schedule.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 4**
- **Lucide React**: icons

## Project Structure

```
frontend/src/
├── app/
│   ├── page.tsx                 # Home: create, open and recently viewed schedules
│   └── (schedule)/              # Pages of an open schedule (folder name isn't in the URL)
│       ├── layout.tsx           # Wraps them in ScheduleProvider + the header
│       ├── data/page.tsx        # Data entry: locations, timeslots, groups, trainers
│       ├── run/page.tsx         # Run scheduler, view results, edit schedule
│       └── settings/page.tsx    # Scheduler Settings (per schedule; content to come)
├── components/
│   ├── Nav.tsx                  # Header of an open schedule (name, Data/Scheduler tabs, Save, Settings, Home)
│   ├── ScheduleProvider.tsx     # The open schedule's working copy, solver run, Save, Ctrl+S, leave warning
│   ├── ScheduleNotFound.tsx     # Shown when ?file= can't be opened
│   ├── EditableTable.tsx        # Generic editable table with paste support
│   ├── ScheduleGrid.tsx         # Schedule display with drag-and-drop edit mode
│   └── ScoreBreakdownPanel.tsx  # Per-reward score breakdown
└── lib/
    ├── types.ts             # TypeScript interfaces for all domain entities
    ├── api.ts               # HTTP client for backend endpoints
    ├── settings.ts          # Scheduler Settings defaults, reward descriptions, points payload
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

### Schedules

Each schedule is a `.doubleshift` file (see the backend README). The home page (`/`) creates and opens them and lists the recently viewed ones. An open schedule's pages carry its file path in the URL (`/data?file=...`); in the desktop app there is no address bar, so users never see it.

`ScheduleProvider` loads the file once and holds the working copy (data, reward settings, last run) shared by the Data, Run and Settings pages, so switching tabs never loses anything. The header's **Save** (or Ctrl+S, from anywhere) writes the whole file. An "Unsaved changes" dot next to the schedule name shows when the working copy differs from the file, and leaving the schedule (Home, or closing the window) asks for confirmation.

A solver run also lives in `ScheduleProvider` (`startRun`, `cancelRun`, `activeRun`), so it keeps going while you switch tabs; the Scheduler tab shows a spinner meanwhile. When it finishes it becomes the schedule's last run. Leaving the schedule mid-run asks first, then cancels the job on the backend.

### Data Entry (`/data`)

Every edit updates the open schedule's working copy (see Schedules above). The four tabs (Locations, Timeslots, Groups, Trainers) each render an `EditableTable`. You can paste directly from a spreadsheet; the table's `parsePaste` callbacks handle column-aware parsing.

Timeslots may overlap only on different spaces: `timeslotClashes()` in `lib/settings.ts` lists any that overlap on the same space, shown on the Timeslots tab and blocking a run.

**Availability** and **location** columns use bitmask arrays: one bit per timeslot/location, 1 = active. These render as inline checkbox grids rather than raw numbers. Paste `1,0,1,0` or a tab-separated row of `TRUE`/`FALSE` values and they will be interpreted correctly.

**Member Of**: each trainer optionally belongs to one group. This field is a dropdown populated from the Groups tab. At send-time, the group name is resolved to the group's generated ID.

A **space** is a place inside a location where one session runs at a time (a hall, pitch, pool or room).

**Columns follow the Scheduler Settings** (hidden values are kept, not deleted):
- *Gendered Groups* off: no Gender column on Groups, and a single **Level** column on Trainers (stored as the female level).
- *Space-Specific Timeslots* on: the Timeslots tab's **Locations** column becomes **Spaces**, with a checkbox per space grouped by location. Spaces are stored by name; all ticked is stored as "no limit".
- *Name Spaces* on (forced on by space-specific timeslots): the Locations tab gains **Space Names**, one box per space. A space's identity is "location + name" (`expandLocations` in `lib/types.ts`), so names only need to be unique within a location; unnamed spaces keep their number ("Club A 3", shown as "Space 3"). `spaceNameProblems()` in `lib/settings.ts` blocks a run while names are missing (with space-specific timeslots) or duplicated. Renaming a space or its location on the Locations tab carries that space's timeslot ticks over to the new name (`updateTab` in the Data page).
- *Group Rules* on: a **Group Rules** tab after Trainers. Each rule picks groups on two sides ("Members Of" and "Can Attend", added from a dropdown; read as a sentence, it's one-directional: the minutes counted are those of the "Can Attend" groups' sessions that members of the first groups would miss) and whether it's **Required** (off = preferred, scored by the Group Rules reward). With the setting off the rules are kept but not sent, and the reward is unavailable.

Renames carry over to references (`carryRenames` in the Data page): renaming a group updates trainers' Member Of and Training Groups and any group rules; renaming a space or location updates timeslot space ticks.
- *Assign Trainers to Groups* on: Trainers lose their level columns and gain **Training Groups**: one dropdown per unit of capacity, each listing only groups no other trainer trains. Groups lose their **Level** column too, unless a level-based reward is on.

`applySettings()` in `lib/settings.ts` produces the data as the solver sees it under the settings (one gender when groups aren't gendered, level 1 when levels aren't used). The API calls, the score breakdown and the schedule grid all use it.

### ID Generation (`lib/api.ts`)

The frontend stores entities without IDs to keep the saved schema clean. `withIDs()` in `api.ts` generates sequential IDs (`g0, g1, ...`, `t0, t1, ...`, `0, 1, ...`) immediately before sending a request to the backend. It also:
- Expands `Location[]` into flat `Space[]` (e.g. "Club A" with 3 spaces becomes "Club A 1", "Club A 2", "Club A 3")
- Resolves `trainer.groupID` from a group name to the generated `groupID`

### Running the Solver (`/run`)

Clicking **Run** (disabled while assigned trainers leave a group uncovered) calls `POST /api/solve` and then polls `GET /api/status/{job_id}` every second. When the run finishes, it becomes the schedule's last run (saved with the header's Save). Intermediate solutions appear in the schedule grid as they are found. The gap percentage shows how far the current solution is from the theoretical optimum.

In Points mode scores are shown as the plain sum of points. Priority Order mode shows no total, only how each reward did.

### Editing a Schedule

**Edit mode** is entered via the Edit Schedule button. In edit mode:
- Drag a session card to a different cell to move it; dropping on an occupied cell swaps the two sessions
- Use the dropdown on a card to change the trainer
- **Verify** sends the edited schedule to `POST /api/verify`: the backend checks all hard constraints and returns any violations plus a score
- **Apply Changes** is only enabled after a clean verify. It applies the edits to the schedule's last run; the header's Save then writes them to the file.

In Priority Order mode (`hierarchical` in the code) there is no single score or gap: while running, the stats show which reward is being optimised (stage *n* of *m*). The **Score Breakdown** shows how each reward did.

The schedule is shown as a week-view calendar: each session is placed by its real times, with spaces as columns under each day. As many whole days as fit (space columns at least 110px) sit side by side, spread evenly over rows; every day panel has the same width and time range, so they line up, and only a day too wide for the screen scrolls sideways. In edit mode, drag a session onto another to swap them or onto an empty slot to move it.

Ctrl+S always saves the whole file, including in edit mode (edits not yet applied with **Apply Changes** aren't included).

### Scheduler Settings (`/settings`)

Each schedule's settings (`settings` in the file; types in `lib/types.ts`, defaults and reward descriptions in `lib/settings.ts`) are edited on the Settings page and saved with the header's Save:

The page has Max Solve Time at the top (a dropdown of set choices, `SOLVE_TIME_OPTIONS` in `lib/settings.ts`; other saved values snap to the nearest), then three sections:
- **Rewards:** Points or Priority Order mode, plus each reward's on/off switch, points, and (in Priority Order mode) priority order.
- **Groups and Trainers:** Gendered Groups, Assign Trainers to Groups, Group Rules.
- **Locations and Timeslots:** Name Spaces, Space-Specific Timeslots.

Runs send `reward_config` (`{ REWARD_KEY: points }`, `0` for rewards that are off or don't apply) and `max_solve_seconds`. Each run keeps a copy of the settings it used, so scoring and verifying it later aren't affected by changing the settings afterwards.

### Score Breakdown

`computeScoreBreakdown()` in `lib/scoreBreakdown.ts` calculates a per-reward breakdown client-side, mirroring the backend's scoring logic. The result drives `ScoreBreakdownPanel`, which shows Same Day and wait-time figures per trainer, No Travel trainer-days, and adjacent group statistics including penalty occurrences.

## Notes for Contributors

- There is no external state library. State lives in `useState`/`useRef` within each page component, with the open schedule shared through `ScheduleProvider`.
- `runRewardConfigRef` in `run/page.tsx` is a ref rather than state so it can be read inside the polling closure without stale capture.
- `scoreBreakdown.ts` must stay in sync with the backend's `_compute_score()` in `verify.py`. If you add or change a reward in the backend, update both.

## Helping the User

Four things teach a new user the app. Keep them in step when you add or rename a feature.

- **On-screen text.** Each page and each Data tab starts with one line saying what it is for. The Scheduler page lists what is still missing before a run can start.
- **Info hints** (`components/InfoHint.tsx`). The "i" buttons next to terms that need explaining. A table column gets one from its `hint`.
- **The guide** (`components/Guide.tsx`). A panel opened from the home page and the "?" in the header. Its text lives in that file.
- **The example schedule** (`public/Example Schedule.doubleshift`). A real schedule file that ships with the app. "Open Example Schedule" on the home page imports a copy of it, so the user can change it freely.

Writing style for everything the user reads: active voice, kind, and as simple as possible. Say what to do next. Use one word for each idea (location, timeslot, session, group, trainer, level, "the scheduler"). Avoid dashes and symbols in sentences.
