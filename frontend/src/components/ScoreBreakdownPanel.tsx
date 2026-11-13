'use client';
import { XCircle } from 'lucide-react';
import { TrainerBreakdownItem } from '@/lib/scoreBreakdown';
import { rewardLabel, rewardPoints } from '@/lib/settings';
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
  trainerCount,
  groupRuleClashes,
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
  trainerCount: number;
  groupRuleClashes: { groups: [string, string]; minutes: number }[];
  settings: ScheduleSettings;
  data: ScheduleData;
}) {
  const rSameDay    = rewardPoints(settings, data, 'REWARD_SAME_DAY');
  const rWait       = rewardPoints(settings, data, 'PENALTY_WAIT_TIME');
  const rGroupRules = rewardPoints(settings, data, 'PENALTY_GROUP_RULES');
  const rNoTravel   = rewardPoints(settings, data, 'REWARD_NO_TRAVEL');
  const rSameGender  = rewardPoints(settings, data, 'REWARD_SAME_GENDER_B2B');
  const rAdjB2b     = rewardPoints(settings, data, 'REWARD_ADJ_GROUP_B2B');
  const rAdjSameDay = rewardPoints(settings, data, 'REWARD_ADJ_GROUP_SAME_DAY');
  const rPenBlocked = rewardPoints(settings, data, 'PENALTY_ADJ_BLOCKED');
  // Points only mean something in Points mode. Priority Order shows just how each reward did.
  const showPoints = settings.rewardMode === 'points';

  if (items.length === 0) {
    return (
      <p className="text-sm italic text-gray-500">This schedule has no sessions yet.</p>
    );
  }

  // Same Day counts every trainer; only those training a group can be spread over several days.
  const spreadOut    = items.filter(it => it.days.length > 1);
  const sameDayCount = trainerCount - spreadOut.length;
  const sameDayScore = sameDayCount * rSameDay;

  const waiting     = items.filter(it => it.waitMinutes > 0);
  const waitMinutes = items.reduce((sum, it) => sum + it.waitMinutes, 0);
  const waitPenalty = waitMinutes * rWait;

  const ruleMinutes = groupRuleClashes.reduce((sum, c) => sum + c.minutes, 0);
  const rulePenalty = ruleMinutes * rGroupRules;

  const adjSameDayScore = adjGroupSameDayCount * rAdjSameDay;
  const adjB2bScore     = adjGroupB2bCount * rAdjB2b;
  const adjPenaltyTotal = adjGroupB2bPenaltyCount * rPenBlocked;

  const sameGenderScore = genderConsecCount * rSameGender;
  const grandTotal = sameDayScore - waitPenalty - rulePenalty + noTravelDays * rNoTravel + sameGenderScore + adjSameDayScore + adjB2bScore - adjPenaltyTotal;

  return (
    <div className="text-sm divide-y divide-gray-100">
      {rSameDay > 0 && (
        <RewardSection
          label={rewardLabel('REWARD_SAME_DAY')}
          summary={`${sameDayCount} of ${trainerCount} trainers`}
          score={showPoints ? sameDayScore : null}
          missed={spreadOut.map(it => ({ name: it.name, detail: `on ${it.days.join(', ')}` }))}
        />
      )}

      {rWait > 0 && (
        <RewardSection
          label={rewardLabel('PENALTY_WAIT_TIME')}
          summary={`${waitMinutes} minutes of waiting in total`}
          score={showPoints ? -waitPenalty : null}
          missed={waiting.map(it => ({ name: it.name, detail: `waits ${it.waitMinutes} minutes` }))}
        />
      )}

      {rGroupRules > 0 && (
        <RewardSection
          label={rewardLabel('PENALTY_GROUP_RULES')}
          summary={`${ruleMinutes} minutes missed in total`}
          score={showPoints ? -rulePenalty : null}
          missed={groupRuleClashes.map(c => ({ name: c.groups[0], detail: `misses ${c.minutes} minutes of ${c.groups[1]}` }))}
        />
      )}

      {rNoTravel > 0 && noTravelPossibleDays > 0 && (
        <RewardSection
          label={rewardLabel('REWARD_NO_TRAVEL')}
          summary={`${noTravelDays} of ${noTravelPossibleDays} days with two or more sessions`}
          score={showPoints ? noTravelDays * rNoTravel : null}
          missed={noTravelMissed.map(name => {
            const item = items.find(it => it.name === name);
            const parts: string[] = [];
            if (item?.coachingGroups.length) parts.push(`trains ${item.coachingGroups.join(', ')}`);
            if (item?.playingGroup) parts.push(`member of ${item.playingGroup}`);
            return { name, detail: parts.join(', ') || 'travels between locations' };
          })}
        />
      )}

      {adjGroupB2bPossible > 0 && (rAdjSameDay > 0 || rAdjB2b > 0 || rPenBlocked > 0) && (
        <>
          {rAdjSameDay > 0 && (
            <div className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-3">
                  <span className="font-medium text-gray-700">{rewardLabel('REWARD_ADJ_GROUP_SAME_DAY')}</span>
                  <span className="text-xs text-gray-400">{adjGroupSameDayCount} of {adjGroupB2bPossible} pairs of groups</span>
                </div>
                {showPoints && <span className={`tabular-nums font-medium ${adjSameDayScore > 0 ? 'text-green-700' : 'text-gray-400'}`}>{fmtRaw(adjSameDayScore)}</span>}
              </div>
            </div>
          )}
          {rAdjB2b > 0 && (
            <div className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-3">
                  <span className="font-medium text-gray-700">{rewardLabel('REWARD_ADJ_GROUP_B2B')}</span>
                  <span className="text-xs text-gray-400">{adjGroupB2bCount} of {adjGroupB2bPossible} pairs of groups</span>
                </div>
                {showPoints && <span className={`tabular-nums font-medium ${adjB2bScore > 0 ? 'text-green-700' : 'text-gray-400'}`}>{fmtRaw(adjB2bScore)}</span>}
              </div>
            </div>
          )}
          {rPenBlocked > 0 && adjGroupB2bPenaltyCount > 0 && (
            <div className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-3">
                  <span className="font-medium text-red-700">{rewardLabel('PENALTY_ADJ_BLOCKED')}</span>
                  <span className="text-xs text-gray-400">
                    missed {adjGroupB2bPenaltyCount} {adjGroupB2bPenaltyCount === 1 ? 'time' : 'times'}
                  </span>
                </div>
                {showPoints && <span className="tabular-nums font-medium text-red-600">{fmtRaw(-adjPenaltyTotal)}</span>}
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

      {rSameGender > 0 && (
        <div className="flex items-center justify-between py-3">
          <div className="flex items-baseline gap-3">
            <span className="font-medium text-gray-700">{rewardLabel('REWARD_SAME_GENDER_B2B')}</span>
            <span className="text-xs text-gray-400">{genderConsecCount} of {genderPossibleCount} back-to-back sessions</span>
          </div>
          {showPoints && <span className={`tabular-nums font-medium ${sameGenderScore > 0 ? 'text-green-700' : 'text-gray-400'}`}>{fmtRaw(sameGenderScore)}</span>}
        </div>
      )}

      {/* Only Points mode has a total: Priority Order compares rewards one at a time. */}
      {showPoints && (
        <div className="flex items-center justify-between pt-3">
          <span className="font-semibold text-gray-700">Total</span>
          <span className="font-semibold tabular-nums text-gray-800">{grandTotal.toLocaleString()}</span>
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
  score: number | null; // null hides the points (Priority Order mode)
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
          <span className={`tabular-nums font-medium ${score > 0 ? 'text-green-700' : 'text-gray-400'}`}>{fmtRaw(score)}</span>
        )}
      </div>
      {missed.length > 0 && (
        <div className="mt-2 space-y-1 pl-1">
          {missed.map(it => (
            <div key={it.name} className="flex items-center gap-1.5 text-orange-500 text-xs">
              <XCircle size={12} className="shrink-0" />
              <span className="font-medium text-orange-600">{it.name}</span>
              <span className="text-orange-400">{it.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
