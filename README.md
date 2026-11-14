# DoubleShift: Training Scheduler

DoubleShift builds a training schedule for a sports association, club or school. You tell it which groups need a session, who can train them, and where and when sessions can happen. It then finds the best schedule it can, and you decide what "best" means. It works either way you organise your trainers. If you already know who trains each group, DoubleShift picks the day, time and space for each session. If you don't, it also chooses a suitable trainer for each group.

## How It Works

1. **Add your data.** Enter your locations, timeslots, groups and trainers on the Data page.
2. **Run the scheduler.** You see the best schedule so far while it works.
3. **Make it yours.** Drag sessions, swap trainers, and verify your changes before you keep them.

New to the app? Open **Simple Example** or **Complex Example** under Recently Opened on the home page. Both are already filled in. Or choose **Read the Guide** for a walkthrough.

Each schedule is saved as one `.doubleshift` file, holding its data, its settings and the last run. You can back it up or share it like any document.

## Getting DoubleShift

There are three ways to get the app. All of them run the same scheduler, and all of them keep your schedules on your own computer.

### Microsoft Store

Search for **DoubleShift: Training Scheduler** in the Microsoft Store on Windows 10 or 11. This is the easiest way: Windows installs the app, keeps it up to date, and opens `.doubleshift` files with it.

### Docker

Use this on macOS or Linux, or to run DoubleShift on a server.

```bash
git clone https://github.com/RossMackay365/doubleshift.git
cd doubleshift
docker compose up
```

Then open http://localhost:8000 in your browser. Your schedules are saved in the `schedules` folder next to `docker-compose.yml`.

### Build It Yourself

You can build the Windows app from the source code. You need Node.js, Python 3.12 and the [Windows SDK](https://developer.microsoft.com/windows/downloads/windows-sdk/). In PowerShell:

```powershell
git clone https://github.com/RossMackay365/doubleshift.git
cd doubleshift

cd backend
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements-desktop.txt
cd ..

.\build-msix.ps1
```

When it finishes, run `dist\DoubleShift\DoubleShift.exe`. See the [packaging README](packaging/README.md) for what the build does.

## Rewards

Every schedule follows your data: nobody is in two places at once, and everyone is available. There are usually many schedules like that. Rewards tell the scheduler which of them you prefer. You can switch each reward on or off for each schedule in Scheduler Settings.

Rewards work in one of two modes:

- **Priority Order** (the default): the rewards are ranked. The scheduler works through them from the top and never gives up a higher reward to improve a lower one.
- **Points**: each reward has points, and the schedule with the most points wins. Penalties take points away.

| Reward | Default points | What it does |
|---|---|---|
| Same Day | 10,000 | Gives a reward for each trainer whose sessions are all on one day. This counts the sessions they train and their own group's session |
| No Travel | 100 | Gives a reward for each day a trainer spends at one location, on days when they have two or more sessions. Needs two or more locations |
| Minimise Wait Time (penalty) | 100 per minute | Applies a penalty for each minute a trainer waits between sessions on the same day |
| Group Rules (penalty) | 100 per minute | Applies a penalty for each minute a group's members would miss of a session they want to attend. This covers preferred group rules only. Needs the *Group Rules* setting |
| Available to Sub in Higher Group (penalty) | 10,000 | Applies a penalty each time a trainer can't attend the session of a group one level above their own, because they are training another group at that time |
| Adjacent Groups Back-to-Back | 5,000 | Gives a reward each time two groups one level apart train straight after each other at the same location |
| Adjacent Groups Same Day | 1,000 | Gives a reward each time two groups one level apart train on the same day at the same location, at different times |
| Same Gender Back-to-Back | 1 | Gives a reward each time two sessions for the same gender follow each other in the same space. This is useful when you want to avoid equipment or setup changes. Needs the *Gendered Groups* setting |

## Key Concepts

### Locations and Spaces

A **location** is a place where sessions happen. Each location has one or more **spaces**, such as halls, pitches, pools or rooms. A space holds one session at a time.

### Timeslots

A **timeslot** is a day and a time when sessions can happen, such as Monday 18:00 to 19:30. Each group gets one session in one timeslot.

### Groups and Trainers

- **Group**: a set of people who train together. Each group gets exactly one session.
- **Trainer**: leads a group's session. A trainer's **capacity** is the most groups they can train.
- **Level**: decides which trainers can train which groups. Level 1 is the most advanced, and a trainer can train any group at their own level or a less advanced one. Level 0 means the trainer does not train.
- **Member**: a trainer can also be a member of a group. They never train their own group, and they are never scheduled to train while their own group has its session.

Two settings change this for each schedule. With *Gendered Groups* on, each group is female or male and trainers have a level for each. With *Assign Trainers to Groups* on, you choose each trainer's Training Groups yourself, and the scheduler only picks times and spaces.

### More Than One Location

If you have more than one location, you can:

- Set the travel time between locations. The scheduler always gives trainers enough time to travel.
- Limit groups and timeslots to certain locations.
- Switch on *Space-Specific Timeslots* to choose the exact spaces each timeslot runs in, so spaces at one location can have different times.
- Switch on *Name Spaces* to give each space its own name. Two spaces at one location need different names. This is always on with space-specific timeslots.

### Group Rules

With the *Group Rules* setting on, the Data page gets a **Group Rules** tab. Each rule reads "members of these groups can attend those groups' sessions". Use it when one group's members also want to join another group's session.

A conflict is measured in minutes: how much of the other session they would miss while attending all of their own, including travel between locations. A rule is either **required** (the schedule must follow it) or **preferred** (each minute missed counts against the Group Rules reward).

### Schedule Files

The Windows app keeps your `.doubleshift` files in `Documents\DoubleShift`. Docker keeps them in its `schedules` folder. To share a schedule, send the file. The other person opens it with **Open Existing Schedule** on the home page.

## Architecture

```
doubleshift/
├── backend/            # FastAPI and OR-Tools: the scheduler and the schedule checks
│   └── desktop.py      # The Windows app: the backend plus a window
├── frontend/           # Next.js: data entry, schedule calendar, editing, guide
├── packaging/          # MSIX manifest, logos, third party notices script
├── build-msix.ps1      # Builds the Windows app and its MSIX package
├── Dockerfile          # One image: the frontend build served by the backend
└── docker-compose.yml
```

DoubleShift has two parts. The **frontend** is a static website where you enter data and view schedules. The **backend** is a small web server that serves that website, saves your schedule files, and runs the scheduler. The Windows app and the Docker image both package these same two parts. The Windows app runs the backend on your computer only and shows the website in its own window.

When you press Run, the frontend sends your data to the backend and asks for progress every second until the scheduler finishes or reaches its time limit. A separate check verifies schedules you edit by hand against every rule.

The scheduler is built on [Google OR-Tools CP-SAT](https://developers.google.com/optimization/cp/cp_solver), a constraint solver. Your data becomes rules that every schedule must follow, such as one session per space at a time. The rewards become the goal the solver works towards. The solver runs in its own process, so the app stays responsive, shows the best schedule so far, and can stop a run at any time.

## More Information

- [Backend README](backend/README.md): the API, the solver design and how to run the backend.
- [Frontend README](frontend/README.md): the pages, the components and how to run the frontend.
- [Packaging README](packaging/README.md): how the Docker image and the Windows app are built.

## Feedback

Any feedback is welcome. Found a problem or have an idea? Tell us on the [Issues page](https://github.com/RossMackay365/doubleshift/issues).

## Privacy

DoubleShift doesn't collect, send or share any of your information. See the [Privacy Policy](PRIVACY.md).

## License

DoubleShift is free and open source under the GNU Affero General Public License v3.0 only (AGPL-3.0-only). See [LICENSE](LICENSE).

You can use, change and share it. If you share a changed version, or run one for others over a network, you must release its source code under the same license.
