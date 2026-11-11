'use client';
import { XCircle } from 'lucide-react';
import { TrainerBreakdownItem } from '@/lib/scoreBreakdown';
import { rewardPoints } from '@/lib/settings';
import { ScheduleData, ScheduleSettings } from '@/lib/types';

interface MissedItem { name: string; detail: string }

function fmtRaw(n: number): string {
  if (n > 0) return `+${n.toLocaleString()}`;
  if (n < 0) return n.toLocaleString();
  return '0';
}

export default function ScoreBreakdownPanel({
  items,
  genderConsecCount,
  genderPossibleCount,
  noTravelDays,
  noTravelPossibleDays,
  noTravelMissed,
  adjGroupB2bCount,
  adjGroupB2bPossible,
  adjGroupSameDayCount,
  adjGroupB2bPenaltyCount,
  adjGroupB2bPenaltyTrainers = [],
  settings,
  data,
}: {
  items: TrainerBreakdownItem[];
  genderConsecCount: number;
  genderPossibleCount: number;
  noTravelDays: number;
  noTravelPossibleDays: number;
  noTravelMissed: string[];
  adjGroupB2bCount: number;
  adjGroupB2bPossible: number;
  adjGroupSameDayCount: number;
  adjGroupB2bPenaltyCount: number;
  adjGroupB2bPenaltyTrainers?: string[];
  settings: ScheduleSettings;
  data: ScheduleData;
}) {
  const rB2b        = rewardPoints(settings, data, 'REWARD_B2B');
  const rNoTravel   = rewardPoints(settings, data, 'REWARD_NO_TRAVEL');
  const rNetHeight  = rewardPoints(settings, data, 'REWARD_NET_HEIGHT');
  const rAdjB2b     = rewardPoints(settings, data, 'REWARD_ADJ_GROUP_B2B');
  const rAdjSameDay = rewardPoints(settings, data, 'REWARD_ADJ_GROUP_SAME_DAY');
  const rPenBlocked = rewardPoints(settings, data, 'PENALTY_ADJ_BLOCKED');

  if (items.length === 0) {
    return (
      <p className="text-sm italic text-gray-500">No coaching assignments in this schedule.</p>
    );
  }

  const players = items.filter(it => it.playingGroup !== '');

  // Back-to-Back: player-trainers only.
  const b2bWinners  = players.filter(it => it.b2bCount > 0);
  const b2bMissed   = players.filter(it => it.b2bCount === 0);
  const b2bScore    = items.reduce((s, it) => s + it.b2bCount * rB2b, 0);

  const adjSameDayScore = adjGroupSameDayCount * rAdjSameDay;
  const adjB2bScore     = adjGroupB2bCount * rAdjB2b;
  const adjPenaltyTotal = adjGroupB2bPenaltyCount * rPenBlocked;

  const netHeightScore = genderConsecCount * rNetHeight;
  const grandTotal = b2bScore + noTravelDays * rNoTravel + netHeightScore + adjSameDayScore + adjB2bScore - adjPenaltyTotal;

  return (
    <div className="text-sm divide-y divide-gray-100">
      {rB2b > 0 && (
        <RewardSection
          label="Back-to-Back"
          summary={
            players.length > 0 ? `${b2bWinners.length} of ${players.length} trainers` : 'No trainers are players'
          }
          score={b2bScore}
          missed={b2bMissed.map(it => ({ name: it.name, detail: `plays in ${it.playingGroup}` }))}
        />
      )}

      {rNoTravel > 0 && noTravelPossibleDays > 0 && (
        <RewardSection
          label="No Travel"
          summary={`${noTravelDays} of ${noTravelPossibleDays} trainer-days`}
          score={noTravelDays * rNoTravel}
          missed={noTravelMissed.map(name => {
            const item = items.find(it => it.name === name);
            const parts: string[] = [];
            if (item?.coachingGroups.length) parts.push(`coaches ${item.coachingGroups.join(', ')}`);
            if (item?.playingGroup) parts.push(`plays in ${item.playingGroup}`);
            return { name, detail: parts.join(' · ') || 'travels between venues' };
          })}
        />
      )}

      {adjGroupB2bPossible > 0 && (rAdjSameDay > 0 || rAdjB2b > 0 || rPenBlocked > 0) && (
        <>
          {rAdjSameDay > 0 && (
            <div className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-3">
                  <span className="font-medium text-gray-700">Adjacent Groups Same Day</span>
                  <span className="text-xs text-gray-400">{adjGroupSameDayCount} of {adjGroupB2bPossible} pairs</span>
                </div>
                <span className={`tabular-nums font-medium ${adjSameDayScore > 0 ? 'text-green-700' : 'text-gray-400'}`}>{fmtRaw(adjSameDayScore)}</span>
              </div>
            </div>
          )}
          {rAdjB2b > 0 && (
            <div className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-3">
                  <span className="font-medium text-gray-700">Adjacent Groups Back-to-Back</span>
                  <span className="text-xs text-gray-400">{adjGroupB2bCount} of {adjGroupB2bPossible} pairs</span>
                </div>
                <span className={`tabular-nums font-medium ${adjB2bScore > 0 ? 'text-green-700' : 'text-gray-400'}`}>{fmtRaw(adjB2bScore)}</span>
              </div>
            </div>
          )}
          {rPenBlocked > 0 && adjGroupB2bPenaltyCount > 0 && (
            <div className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-3">
                  <span className="font-medium text-red-700">Trainer Cannot Sub Up (Penalty)</span>
                  <span className="text-xs text-gray-400">{adjGroupB2bPenaltyCount} {adjGroupB2bPenaltyCount === 1 ? 'occurrence' : 'occurrences'}</span>
                </div>
                <span className="tabular-nums font-medium text-red-600">{fmtRaw(-adjPenaltyTotal)}</span>
              </div>
              {adjGroupB2bPenaltyTrainers.length > 0 && (
                <div className="mt-2 space-y-1 pl-1">
                  {adjGroupB2bPenaltyTrainers.map(name => (
                    <div key={name} className="flex items-center gap-1.5 text-xs text-orange-500">
                      <XCircle size={12} className="shrink-0" />
                      <span className="font-medium text-orange-600">{name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {rNetHeight > 0 && (
        <div className="flex items-center justify-between py-3">
          <div className="flex items-baseline gap-3">
            <span className="font-medium text-gray-700">No Net Height Changes</span>
            <span className="text-xs text-gray-400">{genderConsecCount} of {genderPossibleCount} court transitions</span>
          </div>
          <span className={`tabular-nums font-medium ${netHeightScore > 0 ? 'text-green-700' : 'text-gray-400'}`}>{fmtRaw(netHeightScore)}</span>
        </div>
      )}

      <div className="flex items-center justify-between pt-3">
        <span className="font-semibold text-gray-700">Total</span>
        <div className="text-right">
          <div className="font-semibold tabular-nums text-gray-800">{(grandTotal / 10000).toFixed(2)}</div>
          <div className="text-xs text-gray-400">Scaling Factor: /10,000</div>
        </div>
      </div>
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
  score: number;
  missed: MissedItem[];
}) {
  return (
    <div className="py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="font-medium text-gray-700">{label}</span>
          <span className="text-xs text-gray-400">{summary}</span>
        </div>
        <span className={`tabular-nums font-medium ${score > 0 ? 'text-green-700' : 'text-gray-400'}`}>{fmtRaw(score)}</span>
      </div>
      {missed.length > 0 && (
        <div className="mt-2 space-y-1 pl-1">
          {missed.map(it => (
            <div key={it.name} className="flex items-center gap-1.5 text-orange-500 text-xs">
              <XCircle size={12} className="shrink-0" />
              <span className="font-medium text-orange-600">{it.name}</span>
              <span className="text-orange-400">· {it.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
