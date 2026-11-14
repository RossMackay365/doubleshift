# Frontend

A Next.js app for entering data, running the scheduler, and viewing and editing the schedule. For what the app does, see the [root README](../README.md).

## Stack

- **Next.js 16** (App Router), **React 19** and **TypeScript**
- **Tailwind CSS 4**
- **Lucide React**: icons
- **Geist**: the font, bundled by the `geist` package so builds never download it

## Project Structure

```
frontend/src/
├── app/
│   ├── layout.tsx               # The page shell, with the Windows app's window buttons
│   ├── page.tsx                 # Home: create and open schedules, Recently Opened, the guide
│   └── (schedule)/              # Pages of an open schedule (the folder name isn't in the URL)
│       ├── layout.tsx           # Wraps them in ScheduleProvider and the header
│       ├── data/page.tsx        # Data entry: locations, timeslots, groups, trainers, group rules
│       ├── run/page.tsx         # Run the scheduler, view the schedule, edit it
│       └── settings/page.tsx    # Scheduler Settings and Delete Schedule
├── components/
│   ├── Nav.tsx                  # Header of an open schedule (name, Data and Scheduler tabs, Save, Settings, Home)
│   ├── ScheduleProvider.tsx     # The open schedule's working copy, the run, Save, Ctrl+S, the leave warning
│   ├── ScheduleNotFound.tsx     # Shown when the file in ?file= can't be opened
│   ├── EditableTable.tsx        # Editable table with paste support
│   ├── ScheduleGrid.tsx         # The schedule as a calendar, with drag and drop in edit mode
│   ├── ScheduleTable.tsx        # The schedule as a table, with Copy Table
│   ├── ScoreBreakdownPanel.tsx  # How the schedule did on each reward
│   ├── Guide.tsx                # The user guide
│   ├── InfoHint.tsx             # The "i" buttons that explain a term
│   └── WindowControls.tsx       # Minimise, maximise and close buttons in the Windows app
└── lib/
    ├── types.ts             # TypeScript types for the data
    ├── api.ts               # HTTP client for the backend
    ├── settings.ts          # Scheduler Settings defaults, reward descriptions, checks before a run
    ├── scoreBreakdown.ts    # Score calculation in the browser (mirrors the backend)
    └── desktop.ts           # The functions the Windows app gives the page
```

## Running Locally

Build the frontend:

```bash
cd frontend
npm install
npm run build
```

Then start the backend (see the [backend README](../backend/README.md#running-locally)) and open http://localhost:8000.

`npm run build` makes a static site in `frontend/out` (`output: 'export'` in `next.config.ts`). The backend serves it, here and in Docker and the Windows app, so a build has no server of its own and calls the API on the same origin. That is why there is no `npm run start`. It also means no dynamic routes, no server code and no API routes in Next.js. Pages read the open schedule from `?file=`.

### Live Reloading

While you work on the frontend, `npm run dev` reloads the page as you edit. It runs separately from the backend, so tell it where the backend is:

```bash
echo "NEXT_PUBLIC_BACKEND_API_URL=http://localhost:8000" > .env.local
npm run dev
```

Open http://localhost:3000. Remove `.env.local` again before you build.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_BACKEND_API_URL` | Same origin | The backend's base URL. Only needed for `npm run dev`. Leave it unset for builds |

## Windows App

In the Windows app, `backend/desktop.py` gives the page a few functions as `window.pywebview.api` (`lib/desktop.ts`). In a browser there are none, and the app uses its in-page alternatives.

- **Open Existing Schedule** uses the Windows Open dialog in the schedules folder. In a browser it shows an in-page list of the schedules folder.
- **The leave warning.** `ScheduleProvider` passes its warning to the window, which asks before it closes with unsaved changes or a run in progress.
- **The window buttons.** The window has no Windows title bar, so `WindowControls` draws the minimise, maximise and close buttons and a strip for moving the window. In a browser it shows nothing.

## Key Concepts

### Schedules

Each schedule is a `.doubleshift` file (see the [backend README](../backend/README.md#saved-schedules)). The home page (`/`) creates and opens them and lists the recently opened ones. An open schedule's pages carry its file path in the URL (`/data?file=...`). The Windows app has no address bar, so users never see it.

`ScheduleProvider` loads the file once and holds the working copy (data, settings, last run) shared by the Data, Scheduler and Settings pages, so switching between them never loses anything. **Save** in the header (or Ctrl+S, from anywhere) writes the whole file. An "Unsaved changes" dot next to the schedule name shows when the working copy differs from the file. Leaving the schedule (Home, or closing the window) asks first.

A run also lives in `ScheduleProvider` (`startRun`, `cancelRun`, `activeRun`), so it keeps going while you switch pages. The Scheduler tab shows a spinner meanwhile. When the run finishes it becomes the schedule's last run. Leaving the schedule during a run asks first, then cancels the job on the backend.

### Data Entry (`/data`)

The tabs (Locations, Timeslots, Groups, Trainers, and Group Rules when that setting is on) each show an `EditableTable`. Every edit updates the working copy. You can paste rows straight from a spreadsheet. Each table's `parsePaste` callback reads the columns.

- **Availability** and **location** columns are bitmask arrays: one bit for each timeslot or location, where 1 means active. They show as checkbox grids. Pasting `1,0,1,0` or a tab-separated row of `TRUE` and `FALSE` values works too.
- **Member Of**: each trainer can belong to one group, chosen from a dropdown of the groups. When a request is sent, the group name becomes the group's generated ID.
- **Spaces**: a space's identity is "location + name" (`expandLocations` in `lib/types.ts`). Unnamed spaces keep their number ("Club A 3", shown as "Space 3").
- **Renames carry over** (`carryRenames` in the Data page). Renaming a group updates trainers' Member Of and Training Groups and any group rules. Renaming a space or location updates the timeslots' space ticks.

Two checks block a run until they pass, both in `lib/settings.ts`. `timeslotClashes()` lists timeslots that overlap on the same space, since timeslots may only overlap on different spaces. `spaceNameProblems()` lists space names that are missing (with space-specific timeslots) or used twice at one location.

**Columns follow the Scheduler Settings.** Hidden values are kept, not deleted.

- *Gendered Groups* off: Groups have no Gender column, and Trainers have a single **Level** column (stored as the female level).
- *Assign Trainers to Groups* on: Trainers lose their level columns and gain **Training Groups**, with one dropdown for each unit of capacity. Each dropdown lists only the groups no other trainer trains. Groups lose their **Level** column too, unless a reward that uses levels is on.
- *Group Rules* on: a **Group Rules** tab appears after Trainers. Each rule picks groups on two sides, "Members Of" and "Can Attend", and whether it is **Required** (off means preferred, scored by the Group Rules reward). A rule works in one direction: the minutes counted are those of the "Can Attend" sessions that members of the first groups would miss. With the setting off, the rules are kept but not sent, and the reward is unavailable.
- *Name Spaces* on (always on with space-specific timeslots): the Locations tab gains **Space Names**, with one box for each space.
- *Space-Specific Timeslots* on: the Timeslots tab's **Locations** column becomes **Spaces**, with a checkbox for each space, grouped by location. Spaces are stored by name, and all ticked is stored as "no limit".

`applySettings()` in `lib/settings.ts` produces the data as the solver sees it under the settings: one gender when groups aren't gendered, and level 1 when levels aren't used. The API calls, the score breakdown and the schedule views all use it.

### ID Generation (`lib/api.ts`)

The frontend stores data without IDs to keep the saved file clean. `withIDs()` generates IDs in order (`g0, g1, ...`, `t0, t1, ...`, `0, 1, ...`) just before a request goes to the backend. It also:

- Expands each location into its spaces ("Club A" with 3 spaces becomes "Club A 1", "Club A 2", "Club A 3").
- Turns each trainer's group name into the generated group ID.

### Scheduler Settings (`/settings`)

Each schedule has its own settings (`settings` in the file). The types are in `lib/types.ts`, and the defaults and reward descriptions are in `lib/settings.ts`. The page has:

- **Max Solve Time**: a dropdown of set choices (`SOLVE_TIME_OPTIONS`).
- **Rewards**: the reward mode (Priority Order or Points), and each reward's switch, points and place in the order. Rewards that need a setting or more data are listed under Unavailable with what they need.
- **Groups and Trainers**: Gendered Groups, Assign Trainers to Groups, Group Rules.
- **Locations and Timeslots**: Name Spaces, Space-Specific Timeslots.
- **Delete Schedule**: deletes the schedule's file after asking. The file goes to the Recycle Bin in the Windows app and is deleted for good in Docker.

Settings are saved with **Save** in the header, like everything else. A run sends `reward_config` (`{ REWARD_KEY: points }`, with `0` for rewards that are off or unavailable) and `max_solve_seconds`. Each run keeps a copy of the settings it used, so changing the settings later doesn't affect how that run is scored or verified.

### Running the Scheduler (`/run`)

The page lists anything still missing before a run can start. **Run** then calls `POST /api/solve` and polls `GET /api/status/{job_id}` every second. The schedule updates as better ones are found. When the run finishes, it becomes the schedule's last run.

The two reward modes show progress differently:

- **Points**: the score is the plain sum of points. The gap shows how far the score could still be from the best possible.
- **Priority Order** (`hierarchical` in the code): there is no single score or gap. During a run, the stats show which reward is being optimised (stage *n* of *m*).

In both modes the **Score Breakdown** shows how each reward did.

### Viewing the Schedule

A switch above the schedule chooses between two views:

- **Calendar** (`ScheduleGrid`): a week view. Each session is placed by its real times, with spaces as columns under each day. As many whole days as fit sit side by side (space columns are at least 110px wide), spread evenly over rows. Every day panel has the same width and time range, so they line up. Only a day too wide for the screen scrolls sideways.
- **Table** (`ScheduleTable`): one row for each session, in time order. **Copy Table** puts it on the clipboard as tab-separated text, which pastes into separate cells in a spreadsheet.

### Editing a Schedule

**Edit Schedule** starts edit mode, which always uses the calendar. In edit mode:

- Drag a session to an empty cell to move it, or onto another session to swap the two.
- Use the dropdown on a session to change its trainer.
- **Verify** sends the edited schedule to `POST /api/verify`. The backend checks every hard constraint and returns any violations and a score.
- **Apply Changes** is only enabled after a clean verify. It makes the edits the schedule's last run. **Save** in the header then writes them to the file.

Ctrl+S always saves the whole file, including in edit mode. Edits that haven't been applied yet aren't included.

### Score Breakdown

`computeScoreBreakdown()` in `lib/scoreBreakdown.ts` works out how the schedule did on each reward in the browser, mirroring the backend's scoring. `ScoreBreakdownPanel` shows the result: Same Day and wait time for each trainer, No Travel trainer-days, and the adjacent group figures.

## Notes for Contributors

- There is no state library. State lives in `useState` and `useRef` in each page, and the open schedule is shared through `ScheduleProvider`.
- `runRewardConfigRef` in `run/page.tsx` is a ref, not state, so the polling callback always reads the current value.
- `scoreBreakdown.ts` must stay in step with `_compute_score()` in the backend's `verify.py`. If you add or change a reward in the backend, update both.