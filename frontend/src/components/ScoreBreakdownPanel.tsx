'use client';
import { XCircle } from 'lucide-react';
import { ScoreBreakdown } from '@/lib/scoreBreakdown';
import { rankedRewards, rewardLabel, rewardPoints } from '@/lib/settings';
import { ScheduleData, ScheduleSettings } from '@/lib/types';

interface MissedItem { name: string; detail?: string }

const plural = (n: number, word: string) => `${n.toLocaleString()} ${n === 1 ? word : `${word}s`}`;

// How the schedule did on each reward in use: what it counted, who or what it counted, and
// (in Points mode) the penalty points. Lower is better.
export default function ScoreBreakdownPanel({ breakdown, settings, data }: {
  breakdown: ScoreBreakdown | null;
  settings: ScheduleSettings;
  data: ScheduleData;
}) {
  // Every session has a trainer (a placeholder one without trainers), so no trainer items means no sessions.
  if (!breakdown || breakdown.trainerItems.length === 0) {
    return <p className="text-sm italic text-gray-500">This schedule has no sessions yet.</p>;
  }
  const { trainerItems: items } = breakdown;
  const points = (key: string) => rewardPoints(settings, data, key);
  const inUse = new Set(rankedRewards(settings, data).map(r => r.key));
  // Points only mean something in Points mode. Priority Order shows just how each reward did.
  const showPoints = settings.rewardMode === 'points';

  // Each day a trainer has sessions on after their first is an extra day.
  const spreadOut   = items.filter(it => it.days.length > 1);
  const extraDays   = spreadOut.reduce((sum, it) => sum + it.days.length - 1, 0);
  const waiting     = items.filter(it => it.waitMinutes > 0);
  const waitMinutes = items.reduce((sum, it) => sum + it.waitMinutes, 0);
  const ruleMinutes = breakdown.groupRuleClashes.reduce((sum, c) => sum + c.minutes, 0);

  // The groups a trainer trains and belongs to, for the rewards that list trainers.
  const trainerGroups = (name: string) => {
    const item = items.find(it => it.name === name);
    const parts: string[] = [];
    if (item?.coachingGroups.length) parts.push(`trains ${[...new Set(item.coachingGroups)].join(', ')}`);
    if (item?.playingGroup) parts.push(`member of ${item.playingGroup}`);
    return parts.join(', ');
  };

  const sections: { key: string; count: number; summary: string; missed: MissedItem[] }[] = [
    {
      key: 'PENALTY_EXTRA_DAYS', count: extraDays, summary: plural(extraDays, 'extra day'),
      missed: spreadOut.map(it => ({ name: it.name, detail: `on ${it.days.join(', ')}` })),
    },
    {
      key: 'PENALTY_TRAVEL_DAYS', count: breakdown.travelDays, summary: plural(breakdown.travelDays, 'day') + ' with travel',
      missed: breakdown.travelTrainers.map(name => ({ name, detail: trainerGroups(name) })),
    },
    {
      key: 'PENALTY_WAIT_TIME', count: waitMinutes, summary: plural(waitMinutes, 'minute') + ' of waiting',
      missed: waiting.map(it => ({ name: it.name, detail: `waits ${plural(it.waitMinutes, 'minute')}` })),
    },
    {
      key: 'PENALTY_GROUP_RULES', count: ruleMinutes, summary: plural(ruleMinutes, 'minute') + ' missed',
      missed: breakdown.groupRuleClashes.map(c => ({ name: c.groups[0], detail: `misses ${plural(c.minutes, 'minute')} of ${c.groups[1]}` })),
    },
    {
      key: 'PENALTY_ADJ_BLOCKED', count: breakdown.adjBlockedCount, summary: `missed ${plural(breakdown.adjBlockedCount, 'time')}`,
      missed: breakdown.adjBlockedTrainers.map(name => ({ name, detail: trainerGroups(name) })),
    },
    {
      key: 'PENALTY_ADJ_NOT_B2B', count: breakdown.adjNotB2b.length,
      summary: `${breakdown.adjNotB2b.length} of ${plural(breakdown.adjPairCount, 'pair')} never back-to-back`,
      missed: breakdown.adjNotB2b.map(name => ({ name })),
    },
    {
      key: 'PENALTY_ADJ_NOT_SAME_DAY', count: breakdown.adjNotSameDay.length,
      summary: `${breakdown.adjNotSameDay.length} of ${plural(breakdown.adjPairCount, 'pair')} never on the same day`,
      missed: breakdown.adjNotSameDay.map(name => ({ name })),
    },
    {
      key: 'PENALTY_GENDER_CHANGES', count: breakdown.genderChanges,
      summary: `${plural(breakdown.genderChanges, 'change')} in ${plural(breakdown.genderPossibleCount, 'back-to-back session')}`,
      missed: [],
    },
  ].filter(section => inUse.has(section.key)); // every reward in use, even when it counted nothing

  if (sections.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        This schedule has no score, because no rewards are in use. Switch rewards on in Scheduler
        Settings to tell the scheduler which schedules you prefer.
      </p>
    );
  }

  const total = sections.reduce((sum, section) => sum + section.count * points(section.key), 0);

  return (
    <div className="text-sm divide-y divide-gray-100">
      {sections.map(section => (
        <RewardSection
          key={section.key}
          label={rewardLabel(section.key)}
          summary={section.summary}
          score={showPoints ? section.count * points(section.key) : null}
          missed={section.missed}
        />
      ))}

      {/* Only Points mode has a total: Priority Order compares rewards one at a time. */}
      {showPoints && (
        <div className="flex items-center justify-between pt-3">
          <span className="font-semibold text-gray-700">Total</span>
          <span className="font-semibold tabular-nums text-gray-800">{total.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

function RewardSection({
  label,
  summary,
  score,
  missed,
}: {
  label: string;
  summary: string;
  score: number | null; // penalty points; null hides them (Priority Order mode)
  missed: MissedItem[];
}) {
  return (
    <div className="py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="font-medium text-gray-700">{label}</span>
          <span className="text-xs text-gray-400">{summary}</span>
        </div>
        {score !== null && (
          <span className={`tabular-nums font-medium ${score > 0 ? 'text-orange-600' : 'text-gray-400'}`}>{score.toLocaleString()}</span>
        )}
      </div>
      {missed.length > 0 && (
        <div className="mt-2 space-y-1 pl-1">
          {missed.map(it => (
            <div key={it.name} className="flex items-center gap-1.5 text-orange-500 text-xs">
              <XCircle size={12} className="shrink-0" />
              <span className="font-medium text-orange-600">{it.name}</span>
              {it.detail && <span className="text-orange-400">{it.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
