'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { version } from '../../package.json';

// The user guide: a window over the page, so reading it never leaves the schedule you have
// open. A list of sections on the left, one section shown at a time, with Previous and Next
// links to read it in order. Opened from the home page and from the header.

// Where the app's source code lives. The AGPL asks that users can find it, so anyone who
// shares a changed version should point this at their own source.
export const SOURCE_URL = 'https://github.com/RossMackay365/doubleshift';
const LINK_CLASS = 'font-medium text-blue-600 hover:text-blue-700';

const SECTIONS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: 'quick-start',
    title: 'Quick Start',
    body: (
      <>
        <p>
          DoubleShift builds a training schedule for you. You tell it who needs to train, who can
          train them, and where and when sessions can happen. It finds a schedule that works for
          everyone.
        </p>
        <p>
          There are usually many schedules that work, so DoubleShift also looks for the best one.
          You decide what &quot;best&quot; means by choosing rewards in ‘Scheduler Settings’, such as
          keeping each trainer&apos;s sessions on one day or keeping them at one location. You can
          switch rewards on and off and put them in the order that matters to you.
        </p>
        <ol>
          <li><strong>Create a schedule</strong> on the home page and give it a name.</li>
          <li><strong>Add your data</strong> on the ‘Data’ page: locations, timeslots, groups and trainers.</li>
          <li><strong>Press ‘Run’</strong> on the ‘Scheduler’ page. You see the best schedule so far while it works.</li>
          <li><strong>Adjust it</strong> if you like. Press ‘Edit Schedule’ to move sessions or swap trainers.</li>
          <li><strong>Save</strong> with the button in the header, or press Ctrl+S.</li>
        </ol>
        <h4>Example Schedules</h4>
        <p>
          Open one of the examples under ‘Recently Opened’ on the home page. They are already
          filled in, so you can press ‘Run’ straight away and see how everything fits together.
          They are in your DoubleShift folder, so you can change them freely.
        </p>
        <ul>
          <li><strong>Simple Example</strong>: one location and no trainers, so the scheduler only places the groups. Some groups can only make a few timeslots.</li>
          <li><strong>Intermediate Example</strong>: two locations, with each group&apos;s trainer chosen by you, and ‘Substitutions’ switched on.</li>
          <li><strong>Complex Example</strong>: three locations, with some trainers chosen by you and the rest by the scheduler. It uses gendered groups, substitutions, group rules, and two sessions for some groups.</li>
        </ul>
        <p>
          Try switching settings on and off to see how the schedule changes.
        </p>
      </>
    ),
  },
  {
    id: 'data',
    title: 'Data',
    body: (
      <>
        <p>The Data page has a tab for each kind of information. Work through them from left to right.</p>
        <h4>Locations</h4>
        <p>
          A location is a place where sessions happen. Each location has a number of spaces, such
          as halls, pitches, pools or rooms, and a space holds one session at a time. If you have more than one location, you can also enter
          the travel time between them. The scheduler then gives trainers enough time to get from
          one to the other.
        </p>
        <h4>Timeslots</h4>
        <p>
          A timeslot is a day and a time when sessions can happen, such as Monday 18:00 to 19:30.
          Enter times in 24-hour form. Each session takes one timeslot.
        </p>
        <h4>Groups</h4>
        <p>
          A group is a set of people who train together. Each group gets one session, or more with
          the ‘Multiple Sessions’ setting. For each group you choose where it can train and which
          timeslots it can make.
        </p>
        <h4>Trainers</h4>
        <p>
          A trainer leads a group&apos;s session. For each trainer you choose the timeslots they can
          make and their capacity, which is the most groups they can train. A trainer can also be a
          member of a group. They never train their own group, and the scheduler keeps them free to
          attend its session.
        </p>
        <h4>Levels</h4>
        <p>
          When the scheduler chooses trainers, levels decide which trainers can train which groups. Level 1 is the most advanced. A
          trainer can train any group at their own level or a less advanced one. For example, a
          trainer with level 2 can train groups at level 2, 3 and 4, but not level 1. Give a trainer
          level 0 to keep them in your list without giving them any groups to train.
        </p>
        <h4>Filling in tables quickly</h4>
        <p>
          You can copy rows from a spreadsheet and paste them into any table. Click the first cell
          you want to fill, then paste.
        </p>
      </>
    ),
  },
  {
    id: 'settings',
    title: 'Settings',
    body: (
      <>
        <p>
          Open ‘Scheduler Settings’ with the settings icon in the header. Each schedule has its own
          settings. Switching a setting off never deletes what you entered, so you can switch it back
          on later.
        </p>
        <p>
          A new schedule starts with ‘Trainers’ switched on, ‘Choosing Trainers’ set to ‘Automatic (Level-Based)’,
          and a ‘Max Solve Time’ of 2 minutes. Every other setting starts switched off. Every reward
          starts switched on, and is used once the setting or data it needs is there. For example,
          ‘Same Gender Back-to-Back’ is used once ‘Gendered Groups’ is on, and ‘Minimise Travel’ once
          you have two or more locations.
        </p>
        <h4>Max Solve Time</h4>
        <p>
          How long the scheduler keeps looking for a better schedule. When the time is up, you get
          the best schedule it found. It stops sooner if it finds the best possible one.
        </p>
        <h4>Gendered Groups</h4>
        <p>
          Switch this on if your groups are split into female and male groups. Each group gets a
          gender, and each trainer gets a separate level for female and male groups. A trainer can
          then train one gender at a higher level than the other, or only one gender. The ‘Same
          Gender Back-to-Back’ reward becomes available.
        </p>
        <h4>Substitutions</h4>
        <p>
          Use this when people fill in for the group one level above their own, such as a player
          from the second team joining the first team&apos;s session. Switching it on makes
          three rewards available: ‘Adjacent Groups Back-to-Back’ and ‘Adjacent Groups Same Day’ keep groups
          one level apart close together, and ‘Trainer Available to Sub in Higher Group’ keeps
          trainers free when the group above their own trains. Every group then needs a level on
          the ‘Groups’ tab, and the scheduler won&apos;t run until there are two groups one level
          apart.
        </p>
        <h4>Trainers</h4>
        <p>
          Switch this off if you only need to place your groups, without trainers. The ‘Trainers’
          tab is then hidden, sessions show no trainer, and the rewards about trainers are
          unavailable.
        </p>
        <h4>Choosing Trainers</h4>
        <p>This decides who chooses the trainer for each group.</p>
        <ul>
          <li><strong>Manual</strong>: On the ‘Trainers’ tab you choose each trainer&apos;s ‘Training Groups’ yourself, and the scheduler only chooses the day, time and space for each session. Levels are not needed, unless ‘Substitutions’ is on.</li>
          <li><strong>Automatic (Level-Based)</strong>: The scheduler decides which trainer takes each group, using their levels.</li>
          <li><strong>Mixed</strong>: You choose the trainers for some groups, and the scheduler chooses the rest. A trainer with spare capacity can still be given other groups, using their levels. Once every ‘Training Groups’ box for a trainer has a group, their levels are greyed out.</li>
        </ul>
        <h4>Multiple Sessions</h4>
        <p>
          Switch this on when some groups train more than once. Each group then has a ‘Sessions’
          number on the ‘Groups’ tab. A trainer&apos;s capacity still counts groups, not sessions.
          Two more settings appear:
        </p>
        <ul>
          <li><strong>Same Day</strong>: Whether a group can have more than one session on the same day. When it is off, each of a group&apos;s sessions is on a different day.</li>
          <li><strong>Same Trainer</strong>: Whether one trainer takes all of a group&apos;s sessions. When it is off, each session can have a different trainer.</li>
        </ul>
        <h4>Group Rules</h4>
        <p>
          Use this when people in one group also need to attend another group&apos;s session. For
          example, members of the Juniors might also help at the Beginners session, so those two
          sessions mustn&apos;t overlap.
        </p>
        <p>
          Switching this on adds a ‘Group Rules’ tab to the ‘Data’ page. Each rule names the groups
          whose members want to attend, and the groups whose sessions they want to attend. The
          scheduler then keeps those sessions apart, allowing for travel between locations. Mark a
          rule as ‘Required’ if the sessions must never overlap. Otherwise it is preferred: the
          scheduler avoids overlaps where it can, using the ‘Group Rules’ reward.
        </p>
        <h4>Space-Specific Timeslots</h4>
        <p>
          Normally a timeslot applies to every space at the locations you choose. Switch this on
          when spaces at the same location are available at different times. You then choose the
          exact spaces each timeslot runs in.
        </p>
        <h4>Space Names</h4>
        <p>
          Give each space its own name, such as Hall A or Pool 2, instead of a number. The names
          appear on the schedule.
        </p>
      </>
    ),
  },
  {
    id: 'rewards',
    title: 'Rewards',
    body: (
      <>
        <p>
          Every schedule DoubleShift makes follows your data: nobody is in two places at once, and
          everyone is available. There are usually many schedules like that. Rewards tell the
          scheduler which of them you prefer.
        </p>
        <p>
          Each reward works by adding to the schedule&apos;s score whenever something you&apos;d rather
          avoid happens, such as an extra day for a trainer or a minute spent waiting. The
          scheduler keeps that score as low as it can.
        </p>
        <p>
          Switch on the rewards that matter to you in ‘Scheduler Settings’. For example, ‘Minimise Days’ keeps
          each trainer&apos;s sessions on as few days as it can, and ‘Minimise Wait Time’ keeps those sessions
          close together. The settings page describes every reward.
        </p>
        <p>
          Some rewards are only available when a particular setting is on, or when your data allows
          them. For example, ‘Minimise Travel’ needs two or more locations. The settings page lists these
          under ‘Unavailable’, with what each one needs.
        </p>
        <p>
          The rewards can work in two ways. Choose one with ‘Reward Mode’ in ‘Scheduler Settings’.
        </p>
        <h4>Priority Order</h4>
        <p>
          The scheduler works through your rewards from the top of the list. It never gives up a
          higher reward to improve a lower one. Drag the rewards into the order that suits you. This
          is the easiest mode to use.
        </p>
        <h4>Points</h4>
        <p>
          Each reward has a number of points. Every time something a reward counts happens, its
          points are added to the schedule&apos;s score, and the schedule with the lowest score wins.
          Use this mode when you want to trade rewards off against each other, for example when
          two smaller rewards together should outweigh a bigger one.
        </p>
      </>
    ),
  },
  {
    id: 'results',
    title: 'Reading the Result',
    body: (
      <>
        <p>
          The ‘Scheduler’ page shows the schedule as a calendar, with a column for each space. While
          the scheduler runs, the calendar shows the best schedule found so far.
        </p>
        <ul>
          <li><strong>Optimal</strong> means no better schedule exists for your data and rewards.</li>
          <li><strong>Time Limit Reached</strong> means the scheduler stopped at ‘Max Solve Time’. The schedule works, but a better one may exist. Give it more time if you want it to keep looking.</li>
          <li><strong>Gap</strong> (Points mode) shows how far the score could still be from the best possible. A gap of 0% means the schedule is optimal.</li>
          <li><strong>Score Breakdown</strong> shows how the schedule did on each reward, and who missed out.</li>
        </ul>
        <p>You can press ‘Cancel’ at any time. You keep the best schedule found so far.</p>
      </>
    ),
  },
  {
    id: 'editing',
    title: 'Editing and Verifying',
    body: (
      <>
        <p>Sometimes you know something the scheduler doesn&apos;t. You can change any schedule by hand.</p>
        <ol>
          <li>Press ‘Edit Schedule’.</li>
          <li>Drag a session to another space or timeslot. Drop it on another session to swap the two. Use the dropdown on a session to change its trainer.</li>
          <li>Press ‘Verify’. DoubleShift checks your changes and tells you about anything that doesn&apos;t work, such as a trainer in two places at once.</li>
          <li>Press ‘Apply Changes’ to keep your edits, then ‘Save’ in the header.</li>
        </ol>
      </>
    ),
  },
  {
    id: 'no-schedule',
    title: 'No Schedule Found',
    body: (
      <>
        <p>
          Sometimes no schedule can fit your data. When that happens, DoubleShift lists what to
          check, such as a group that no trainer can train. These are the most common fixes:
        </p>
        <ul>
          <li>Give groups and trainers more availability.</li>
          <li>Add timeslots or spaces.</li>
          <li>Raise a trainer&apos;s capacity, or add a trainer.</li>
          <li>Check that every group has a trainer with a suitable level.</li>
          <li>Change some required group rules to preferred.</li>
        </ul>
        <p>
          If the scheduler runs out of time before it finds any schedule, raise ‘Max Solve Time’ in
          ‘Scheduler Settings’ and run it again.
        </p>
      </>
    ),
  },
  {
    id: 'files',
    title: 'Files and Sharing',
    body: (
      <>
        <p>
          Each schedule is one file ending in .doubleshift, kept in the DoubleShift folder in your
          Documents. The file holds your data, your settings and the last schedule you made.
        </p>
        <p>
          To share a schedule, send the file to someone else. They can open it from the home page
          with ‘Open Existing Schedule’.
        </p>
        <p>
          DoubleShift only saves when you press ‘Save’. It asks before you leave a schedule with
          changes you haven&apos;t saved.
        </p>
        <p>
          To delete a schedule, open it and choose ‘Delete Schedule’ at the bottom of
          ‘Scheduler Settings’. Its file goes to the Recycle Bin, so you can restore it from there.
        </p>
      </>
    ),
  },
  {
    id: 'about',
    title: 'About',
    body: (
      <>
        <p>
          DoubleShift is free and open source. You can use it, change it and share it under
          the{' '}
          <a href={`${SOURCE_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
            GNU Affero General Public License v3.0
          </a>
          . The source code is available on{' '}
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
            GitHub
          </a>
          .
        </p>
        <p>
          Found a problem or have an idea? Tell us on{' '}
          <a href={`${SOURCE_URL}/issues`} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
            GitHub Issues
          </a>
          .
        </p>
        <p className="text-sm text-gray-500">Version {version}</p>
      </>
    ),
  },
];

// `section` is the id of the section to open at (the one for the page the guide was
// opened from); without it the guide opens at Quick Start.
export default function Guide({ section, onClose }: { section?: string; onClose: () => void }) {
  const [index, setIndex] = useState(() => Math.max(0, SECTIONS.findIndex(s => s.id === section)));
  const current = SECTIONS[index];
  const previous = SECTIONS[index - 1];
  const next = SECTIONS[index + 1];

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Guide"
        className="fixed left-1/2 top-1/2 z-50 flex h-[min(44rem,calc(100vh-4rem))] w-[min(60rem,calc(100vw-4rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Guide</h2>
          <button onClick={onClose} aria-label="Close guide" className="text-gray-400 transition-colors hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav className="w-60 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 p-3">
            {SECTIONS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setIndex(i)}
                aria-current={i === index ? 'page' : undefined}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  i === index ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {s.title}
              </button>
            ))}
          </nav>
          {/* Keyed by section, so each section opens scrolled to the top. */}
          <div key={current.id} className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 py-6">
            <section className="guide flex-1">
              <h3 className="mb-3 text-2xl font-semibold text-gray-900">{current.title}</h3>
              {current.body}
            </section>
            <div className="mt-6 flex justify-between gap-4 border-t border-gray-100 pt-4 text-sm font-medium">
              {previous ? (
                <button onClick={() => setIndex(index - 1)} className="flex items-center gap-1 text-gray-500 hover:text-blue-600">
                  <ChevronLeft size={16} />
                  {previous.title}
                </button>
              ) : <span />}
              {next && (
                <button onClick={() => setIndex(index + 1)} className="flex items-center gap-1 text-blue-600 hover:text-blue-700">
                  {next.title}
                  <ChevronRight size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
