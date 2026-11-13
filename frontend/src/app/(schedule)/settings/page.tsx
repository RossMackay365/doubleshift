'use client';
import { useState } from 'react';
import { GripVertical } from 'lucide-react';
import { useSchedule } from '@/components/ScheduleProvider';
import { REWARDS, SOLVE_TIME_OPTIONS, spacesNamed, isRewardActive, rankedRewards, unavailableReason } from '@/lib/settings';
import { RewardSetting, ScheduleData, ScheduleSettings } from '@/lib/types';

// The open schedule's Scheduler Settings. Changes go into the schedule's working copy
// and are written to the file by the header's Save, like everything else.
export default function SettingsPage() {
  const { data, settings, setSettings } = useSchedule();
  const update = (changes: Partial<ScheduleSettings>) => setSettings({ ...settings, ...changes });

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-gray-900">Scheduler Settings</h1>

      <div className="mt-6">
        <SettingRow
          name="Max Solve Time"
          description="How long the scheduler looks for a better schedule. When the time is up, it gives you the best one it found. It stops sooner if it finds the best possible schedule."
        >
          <select
            value={settings.maxSolveSeconds}
            onChange={e => update({ maxSolveSeconds: Number(e.target.value) })}
            aria-label="Max Solve Time"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 focus:border-blue-500 focus:outline-none"
          >
            {SOLVE_TIME_OPTIONS.map(o => <option key={o.seconds} value={o.seconds}>{o.label}</option>)}
          </select>
        </SettingRow>
      </div>

      <Section
        title="Rewards"
        intro="Every schedule follows your data. Rewards tell the scheduler which of those schedules you prefer."
      >
        <SettingRow
          name="Reward Mode"
          description={'Priority Order: The scheduler works through your rewards from the top. It never gives up a higher reward to improve a lower one.\n'
            + 'Points: Each reward adds its points every time the schedule achieves it, and a penalty takes its points away each time it happens. The schedule with the most points wins.'}
        >
          <ModeToggle mode={settings.rewardMode} onChange={rewardMode => update({ rewardMode })} />
        </SettingRow>
        <RewardList settings={settings} data={data} onChange={rewards => update({ rewards })} />
      </Section>

      <Section title="Groups and Trainers">
        <SettingRow
          name="Gendered Groups"
          description={'On: Each group is female or male, and trainers have a level for each.\nOff: All groups and trainers share one set of levels.'}
        >
          <Switch checked={settings.genderedTeams} onChange={genderedTeams => update({ genderedTeams })} />
        </SettingRow>
        <SettingRow
          name="Assign Trainers to Groups"
          description={'On: You choose which groups each trainer trains, and the scheduler picks the times and spaces.\nOff: The scheduler also chooses the trainers, using their levels.'}
        >
          <Switch checked={settings.assignTrainers} onChange={assignTrainers => update({ assignTrainers })} />
        </SettingRow>
        <SettingRow
          name="Group Rules"
          description={"On: The Data page gets a Group Rules tab, where you can let members of some groups attend other groups' sessions. Each rule is either required, or preferred and scored by the Group Rules reward above.\nOff: Sessions are scheduled without group rules."}
        >
          <Switch checked={settings.groupRules} onChange={groupRules => update({ groupRules })} />
        </SettingRow>
      </Section>

      <Section title="Locations and Timeslots">
        <SettingRow
          name="Name Spaces"
          description={settings.spaceTimeslots
            ? 'Always on while Space-Specific Timeslots is on. Give every space a name on the Locations tab.'
            : 'On: You name each space on the Locations tab, such as Hall A or Pool 2. Two spaces at one location need different names.\nOff: Spaces are numbered.'}
        >
          <Switch
            checked={spacesNamed(settings)}
            disabled={settings.spaceTimeslots}
            onChange={nameSpaces => update({ nameSpaces })}
          />
        </SettingRow>
        <SettingRow
          name="Space-Specific Timeslots"
          description={'On: You choose the spaces each timeslot runs in, so spaces at one location can have different times.\nOff: You choose the locations each timeslot runs at.'}
        >
          <Switch checked={settings.spaceTimeslots} onChange={spaceTimeslots => update({ spaceTimeslots })} />
        </SettingRow>
      </Section>
    </div>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-gray-200 pt-6">
      <h2 className="mb-2 text-lg font-semibold text-gray-800">{title}</h2>
      {intro && <p className="mb-2 max-w-lg text-sm text-gray-500">{intro}</p>}
      <div className="divide-y divide-gray-100">{children}</div>
    </section>
  );
}

function SettingRow({ name, description, children }: { name: string; description: string; children: React.ReactNode }) {
  return (
    <div className="py-4">
      <div className="flex items-center justify-between gap-6">
        <span className="font-medium text-gray-800">{name}</span>
        <div className="shrink-0">{children}</div>
      </div>
      <p className="mt-1 max-w-lg whitespace-pre-line text-sm text-gray-500">{description}</p>
    </div>
  );
}

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-blue-600' : 'bg-gray-300'
      }`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-5.5' : 'left-0.5'}`} />
    </button>
  );
}

function ModeToggle({ mode, onChange }: { mode: ScheduleSettings['rewardMode']; onChange: (mode: ScheduleSettings['rewardMode']) => void }) {
  const options = [
    { value: 'hierarchical', label: 'Priority Order' },
    { value: 'points', label: 'Points' },
  ] as const;
  return (
    <div className="flex rounded-md border border-gray-300 p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
            mode === o.value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Rewards that count are listed first (in priority order for Priority Order mode, where
// they can be dragged to reorder). Then, greyed out: rewards switched off ("Off"), and
// rewards that can't apply with the current settings ("Unavailable").
function RewardList({ settings, data, onChange }: {
  settings: ScheduleSettings;
  data: ScheduleData | null;
  onChange: (rewards: RewardSetting[]) => void;
}) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const hierarchical = settings.rewardMode === 'hierarchical';
  const active = rankedRewards(settings, data);
  const inactive = settings.rewards.filter(r => !isRewardActive(settings, data, r));
  const off = inactive.filter(r => !unavailableReason(settings, data, r));
  const unavailable = inactive.filter(r => unavailableReason(settings, data, r));

  function setReward(key: string, changes: Partial<RewardSetting>) {
    onChange(settings.rewards.map(r => (r.key === key ? { ...r, ...changes } : r)));
  }

  // Switching a reward on puts it at the bottom of the priority order.
  function setEnabled(reward: RewardSetting, enabled: boolean) {
    if (enabled) {
      onChange([...settings.rewards.filter(r => r.key !== reward.key), { ...reward, enabled }]);
    } else {
      setReward(reward.key, { enabled });
    }
  }

  function drop(targetKey: string) {
    const order = [...active];
    const from = order.findIndex(r => r.key === dragKey);
    const to = order.findIndex(r => r.key === targetKey);
    if (from !== -1 && to !== -1 && from !== to) {
      order.splice(to, 0, order.splice(from, 1)[0]);
      onChange([...order, ...inactive]);
    }
    setDragKey(null);
    setOverKey(null);
  }

  function row(reward: RewardSetting, priority: number | null) {
    const def = REWARDS.find(r => r.key === reward.key)!;
    const reason = unavailableReason(settings, data, reward);
    const draggable = hierarchical && priority !== null;
    return (
      <li
        key={reward.key}
        draggable={draggable}
        onDragStart={() => setDragKey(reward.key)}
        onDragOver={e => { if (draggable && dragKey) { e.preventDefault(); setOverKey(reward.key); } }}
        onDragLeave={() => setOverKey(k => (k === reward.key ? null : k))}
        onDrop={() => drop(reward.key)}
        onDragEnd={() => { setDragKey(null); setOverKey(null); }}
        className={`flex items-start gap-4 px-4 py-4 ${priority === null ? 'opacity-60' : ''} ${
          overKey === reward.key && dragKey !== reward.key ? 'bg-blue-50' : ''
        } ${dragKey === reward.key ? 'opacity-40' : ''}`}
      >
        {hierarchical && (
          <div className={`flex w-12 shrink-0 items-center gap-1 pt-0.5 text-gray-400 ${draggable ? 'cursor-grab' : 'invisible'}`}>
            <GripVertical size={16} />
            <span className="text-sm font-semibold text-gray-500">{priority}</span>
          </div>
        )}
        <div className="min-w-0 flex-1 pr-6">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-800">{def.label}</span>
            {def.isPenalty && (
              <span title="In Points mode, these points are taken away each time it happens" className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-600">Penalty</span>
            )}
            {reason && (
              <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-600">{reason}</span>
            )}
          </div>
          <p className="mt-1 max-w-lg text-sm text-gray-500">{def.description}</p>
        </div>
        {!hierarchical && (
          <div className="flex shrink-0 items-center gap-1.5 text-sm text-gray-500">
            <input
              type="number"
              min={0}
              value={reward.points}
              disabled={priority === null}
              onChange={e => setReward(reward.key, { points: Math.max(0, Number(e.target.value) || 0) })}
              aria-label={`${def.label} points`}
              className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-right text-sm text-gray-900 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
            />
            {def.perMinute && <span>/ min</span>}
          </div>
        )}
        <div className="shrink-0 pt-0.5">
          <Switch checked={reward.enabled} disabled={!!reason} onChange={enabled => setEnabled(reward, enabled)} />
        </div>
      </li>
    );
  }

  // Each group gets its own heading and box: white for the rewards in use, grey and
  // dashed for the ones that aren't.
  function group(title: string, note: string, items: React.ReactNode[], inUse: boolean) {
    return (
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-gray-800">
          {title} <span className="font-normal text-gray-400">({items.length})</span>
        </h3>
        <p className="mb-2 text-sm text-gray-500">{note}</p>
        <ul className={`divide-y rounded-lg border ${
          inUse ? 'divide-gray-100 border-gray-200 bg-white' : 'divide-gray-200 border-dashed border-gray-300 bg-gray-50'
        }`}>
          {items}
        </ul>
      </div>
    );
  }

  return (
    <div className="pt-2">
      {active.length > 0 && group(
        'In Use',
        hierarchical
          ? 'The scheduler works through these from the top. Drag one to move it.'
          : 'Each reward adds its points every time the schedule achieves it. A penalty takes its points away instead.',
        active.map((r, i) => row(r, i + 1)),
        true,
      )}
      {off.length > 0 && group('Off', 'Switch one on to add it to the bottom of the list above.', off.map(r => row(r, null)), false)}
      {unavailable.length > 0 && group('Unavailable', "These need a setting or data that this schedule doesn't have yet.", unavailable.map(r => row(r, null)), false)}
    </div>
  );
}
