'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  Play, Square, AlertCircle, CheckCircle2, Loader2, Clock,
  Pencil, X, ShieldCheck, RotateCcw, Save, BarChart2, CalendarDays, Table2,
} from 'lucide-react';
import { verifySchedule } from '@/lib/api';
import { ScheduleEntry, VerifyResult, expandLocations, Space } from '@/lib/types';
import ScheduleGrid from '@/components/ScheduleGrid';
import ScheduleTable from '@/components/ScheduleTable';
import ScoreBreakdownPanel from '@/components/ScoreBreakdownPanel';
import InfoHint from '@/components/InfoHint';
import { useSchedule } from '@/components/ScheduleProvider';
import { computeScoreBreakdown } from '@/lib/scoreBreakdown';
import { applySettings, spaceNameProblems, rewardLabel, timeslotClashes } from '@/lib/settings';

// Overlay the optimality gap onto a verify result using the solver's best_bound,
// which the client already holds. Keeps Verify independent of any server-side
// job state: the backend only returns feasibility + score.
function withGap(result: VerifyResult, bound: number | null): VerifyResult {
  if (!result.feasible || bound == null || result.score == null) return result;
  const absolute_gap = Math.round((bound - result.score) * 10000) / 10000;
  const gap_percent = bound !== 0 ? Math.round((absolute_gap / bound) * 10000) / 100 : 0;
  return { ...result, best_bound: bound, absolute_gap, gap_percent };
}

export default function RunPage() {
  // Data, reward settings, the last run and any run in progress belong to the open
  // schedule (ScheduleProvider), so a run keeps going while switching tabs.
  const {
    data, settings, lastRun, setLastRun,
    activeRun, running, cancelling, startedAt, runError, clearRunError, startRun, cancelRun,
  } = useSchedule();
  const jobStatus = running ? activeRun : lastRun;
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [editableSchedule, setEditableSchedule] = useState<ScheduleEntry[]>([]);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [view, setView] = useState<ScheduleView>('calendar');


  // Tick a clock while a run is in progress so the live elapsed counter advances.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);

  function handleRun() {
    setError(null);
    setEditMode(false);
    setVerifyResult(null);
    setShowBreakdown(false);
    startRun();
  }

  function handleEnterEdit() {
    const current = jobStatus?.result ?? [];
    setEditableSchedule([...current]);
    setVerifyResult(null);
    setError(null);
    setShowBreakdown(false);
    setEditMode(true);
  }

  function handleExitEdit() {
    setEditMode(false);
    setVerifyResult(null);
  }

  function handleResetEdit() {
    setEditableSchedule([...(jobStatus?.result ?? [])]);
    setVerifyResult(null);
  }

  function handleSaveEdits(withResult?: VerifyResult | null) {
    if (!jobStatus) return;
    const vr = withResult !== undefined ? withResult : verifyResult;
    const newStats = vr?.feasible
      ? {
          ...jobStatus.stats,
          current_score: vr.score,
          best_bound: vr.best_bound,
          absolute_gap: vr.absolute_gap,
          gap_percent: vr.gap_percent,
          optimal: vr.gap_percent === 0,
          reward_counts: vr.reward_counts,
        }
      : jobStatus.stats;
    setLastRun({ ...jobStatus, result: editableSchedule, stats: newStats });
    setEditMode(false);
    setVerifyResult(null);
  }

  // Score and verify a run with the settings it was run with.
  const runSettings = jobStatus?.settings ?? settings;
  // Hierarchical runs have no single score or gap: results are shown per reward instead.
  const hierarchical = runSettings.rewardMode === 'hierarchical';

  async function handleVerify() {
    if (!data) return;
    setVerifying(true);
    setVerifyResult(null);
    setError(null);
    try {
      const knownBound = hierarchical ? null : jobStatus?.stats?.best_bound ?? jobStatus?.stats?.final_score ?? null;
      const result = withGap(await verifySchedule(data, editableSchedule, runSettings), knownBound);
      setVerifyResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setVerifying(false);
    }
  }

  const status    = jobStatus?.status;
  const isModified = useMemo(
    () => editMode && JSON.stringify(editableSchedule) !== JSON.stringify(jobStatus?.result ?? []),
    [editMode, editableSchedule, jobStatus],
  );

  // In edit mode, ask before leaving this page (Data tab, Home, closing the window)
  // with edits that haven't been applied with "Apply Changes".
  useEffect(() => {
    if (!isModified) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    function onLinkClick(e: MouseEvent) {
      const link = (e.target as HTMLElement).closest('a');
      if (!link || link.pathname === window.location.pathname) return;
      if (!confirm("You have edits you haven't applied yet. Leave without applying them?")) {
        e.preventDefault();
        e.stopImmediatePropagation(); // don't also show the schedule's own leave warning
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onLinkClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onLinkClick, true);
    };
  }, [isModified]);

  const breakdownSchedule = useMemo(
    () => (editMode ? editableSchedule : (jobStatus?.result ?? [])),
    [editMode, editableSchedule, jobStatus],
  );
  // Score the data as the solver saw it (e.g. one gender when teams aren't gendered).
  const solverData = useMemo(() => data && applySettings(data, runSettings), [data, runSettings]);
  const spaces = useMemo<Space[]>(() => expandLocations(solverData?.locations ?? []), [solverData]);
  const breakdown = useMemo(
    () => (!showBreakdown || !solverData || breakdownSchedule.length === 0)
      ? null
      : computeScoreBreakdown(breakdownSchedule, solverData, runSettings),
    [showBreakdown, solverData, breakdownSchedule, runSettings],
  );

  // Everything that still needs doing on the Data page before a run can start.
  const todo: string[] = [];
  if (!data || data.locations.length === 0) todo.push('Add at least one location on the Locations tab.');
  if (!data || data.timeslots.length === 0) todo.push('Add at least one timeslot on the Timeslots tab.');
  if (!data || data.groups.length === 0) todo.push('Add at least one group on the Groups tab.');
  if (!data || data.trainers.length === 0) todo.push('Add at least one trainer on the Trainers tab.');
  if (data) {
    for (const clash of timeslotClashes(data, settings)) {
      todo.push(`Change the timeslots that overlap in the same space: ${clash}.`);
    }
    // Space names must be complete and unique (see spaceNameProblems).
    todo.push(...spaceNameProblems(data, settings));
    // With trainers assigned to groups, every group needs a trainer.
    if (settings.assignTrainers) {
      const unassigned = data.groups.filter(g => !data.trainers.some(t => t.trainingGroups?.includes(g.name))).map(g => g.name);
      if (unassigned.length > 0) {
        todo.push(`Choose a trainer for ${unassigned.join(', ')}. Pick each one as a Training Group on the Trainers tab.`);
      }
    }
  }
  const stats     = jobStatus?.stats;
  const result    = jobStatus?.result ?? [];
  const hasResult = result.length > 0;
  const timeLimit = stats?.time_limit_seconds ?? null;
  // Live elapsed while running (wall clock); the solver's reported time once done.
  const liveElapsed = running && startedAt != null
    ? Math.max(0, (nowMs - startedAt) / 1000)
    : stats?.elapsed_seconds ?? null;
  const nearTimeout = running && timeLimit != null && liveElapsed != null && liveElapsed >= timeLimit;
  const inProgress = running && status !== 'completed';
  const canEdit   = hasResult && !running;
  const stageName = stats?.stage_name ? rewardLabel(stats.stage_name) : null;

  return (
    <div>
      {/* Header row */}
      <div className="mb-8 flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Scheduler</h1>
        </div>
        <div className="flex flex-wrap gap-2.5 ml-auto">
          {!editMode && (
            <>
              <button
                onClick={handleRun}
                disabled={running || todo.length > 0}
                className="flex items-center gap-2 rounded-md bg-blue-600 px-5 py-2.5 text-base font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                {running ? <Loader2 size={17} className="animate-spin" /> : <Play size={17} />}
                Run
              </button>
              {running && (
                <button
                  onClick={cancelRun}
                  disabled={cancelling}
                  className="flex items-center gap-2 rounded-md border border-red-200 bg-white px-5 py-2.5 text-base font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                >
                  {cancelling ? <Loader2 size={17} className="animate-spin" /> : <Square size={17} />}
                  {cancelling ? 'Cancelling...' : 'Cancel'}
                </button>
              )}
              {canEdit && (
                <button
                  onClick={handleEnterEdit}
                  className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-5 py-2.5 text-base font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Pencil size={17} />
                  Edit Schedule
                </button>
              )}
            </>
          )}
          {editMode && (
            <>
              <button
                onClick={handleVerify}
                disabled={verifying}
                className="flex items-center gap-2 rounded-md bg-green-600 px-5 py-2.5 text-base font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {verifying ? <Loader2 size={17} className="animate-spin" /> : <ShieldCheck size={17} />}
                Verify
              </button>
              <button
                onClick={() => handleSaveEdits()}
                disabled={!isModified || verifyResult === null}
                title={isModified && verifyResult === null ? 'Press Verify first to check your changes' : undefined}
                className="flex items-center gap-2 rounded-md bg-blue-600 px-5 py-2.5 text-base font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
              >
                <Save size={17} />
                Apply Changes
              </button>
              <button
                onClick={handleResetEdit}
                title="Undo all your edits"
                className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-5 py-2.5 text-base font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <RotateCcw size={17} />
                Reset
              </button>
              <button
                onClick={handleExitEdit}
                className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-5 py-2.5 text-base font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <X size={17} />
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {/* Data To-Do's Before Solver Run */}
      {todo.length > 0 && !editMode && (
        <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-base text-amber-800">
          <div className="mb-1 font-semibold">A few things to finish on the Data page before you can run:</div>
          <ul className="list-disc space-y-1 pl-5">
            {todo.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      )}

      {/* Edit Mode Banner */}
      {editMode && (
        <div className="mb-5 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-base text-blue-700">
          <Pencil size={16} className="shrink-0" />
          <span>
            Drag a session to move it, or pick another trainer from its dropdown. Press <strong>Verify</strong> to
            check your changes, then <strong>Apply Changes</strong> to keep them.
          </span>
          {isModified && (
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-sm font-medium text-amber-600">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
              Changes not applied yet
            </span>
          )}
        </div>
      )}

      {(error || runError) && (
        <div className="mb-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-base text-red-700">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error ?? runError}</span>
          <button onClick={() => { setError(null); clearRunError(); }} className="ml-2 shrink-0 text-red-400 hover:text-red-600 transition-colors">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Solver Stats */}
      {jobStatus && !editMode && (
        <div className="mb-8 rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5 text-base">
              <StatusBadge status={status!} />
              {stats?.solutions_found != null && (
                <Stat
                  label="Schedules found"
                  value={stats.solutions_found}
                  hint="How many times the scheduler has found a better schedule than the one before."
                />
              )}
              {!hierarchical && stats?.current_score != null && (
                <Stat
                  label="Score"
                  value={points(stats.current_score)}
                  hint="The schedule's total reward points. Higher is better. Open Score Breakdown to see where the points come from."
                />
              )}
              {hierarchical && running && stageName && (
                <Stat
                  label="Working on"
                  value={`${stageName} (reward ${stats!.stage} of ${stats!.stage_count})`}
                  hint="The scheduler improves one reward at a time, in your priority order."
                />
              )}
              {liveElapsed != null && (
                <Stat
                  label="Time"
                  value={`${liveElapsed.toFixed(1)}s${timeLimit != null ? ` of ${timeLimit.toFixed(0)}s` : ''}`}
                />
              )}
              {!hierarchical && stats?.gap_percent != null && (
                <Stat
                  label="Gap"
                  value={`${stats.gap_percent.toFixed(1)}%`}
                  hint="How far the score could still be from the best possible. At 0%, no better schedule exists."
                />
              )}
              {nearTimeout && (
                <span className="flex items-center gap-1.5 text-amber-600">
                  <Clock size={16} /> Time Limit Reached. Finishing up...
                </span>
              )}
              {stats?.optimal && (
                <span className="flex items-center gap-1.5 text-green-600">
                  <CheckCircle2 size={16} /> Optimal: No Better Schedule Exists
                </span>
              )}
              {status === 'completed' && !stats?.optimal && stats?.stopped_reason === 'time_limit' && (
                <span className="flex items-center gap-1.5 text-amber-600">
                  <Clock size={16} /> Time Limit Reached
                </span>
              )}
              {status === 'cancelled' && (
                <span className="flex items-center gap-1.5 text-gray-600">
                  <Square size={16} />
                  {hasResult ? 'You cancelled the run. This is the best schedule it found.' : 'You cancelled the run before it found a schedule.'}
                </span>
              )}
              {stats?.error && <span className="text-red-600">{stats.error}</span>}
            </div>
            {stats?.current_score != null && (
              <button
                onClick={() => setShowBreakdown(v => !v)}
                className="shrink-0 flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:border-blue-300 hover:text-blue-600 transition-colors"
              >
                <BarChart2 size={14} />
                {showBreakdown ? 'Hide Breakdown' : 'Score Breakdown'}
              </button>
            )}
          </div>
          {stats?.issues && stats.issues.length > 0 && (
            <div className="mt-4 rounded-md border border-red-100 bg-red-50 p-4">
              <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-700">What to check</div>
              <ul className="list-disc space-y-1.5 pl-5 text-base text-red-800">
                {stats.issues.map((msg, i) => <li key={i}>{msg}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Verify Result Panel */}
      {verifyResult && editMode && (
        <div className={`mb-6 rounded-lg border p-5 ${verifyResult.feasible ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5 text-base">
              {verifyResult.feasible ? (
                <>
                  <span className="flex items-center gap-1.5 font-semibold text-green-700">
                    <CheckCircle2 size={17} /> Your edited schedule still meets every requirement.
                  </span>
                  {!hierarchical && verifyResult.score != null && <Stat label="Score" value={points(verifyResult.score)} />}
                  {!hierarchical && (stats?.final_score ?? stats?.current_score) != null && (
                    <Stat label="Scheduler's score" value={points((stats!.final_score ?? stats!.current_score)!)} />
                  )}
                  {!hierarchical && verifyResult.best_bound != null && <Stat label="Best possible" value={points(verifyResult.best_bound)} />}
                  {!hierarchical && verifyResult.gap_percent != null && (
                    <Stat label="Gap" value={`${verifyResult.gap_percent.toFixed(1)}%`} />
                  )}
                  {verifyResult.gap_percent === 0 && (
                    <span className="flex items-center gap-1.5 text-green-600">
                      <CheckCircle2 size={16} /> Optimal: No Better Schedule Exists
                    </span>
                  )}
                </>
              ) : (
                <span className="flex items-center gap-1.5 font-semibold text-red-700">
                  <AlertCircle size={17} />
                  {verifyResult.violations.length === 1
                    ? "This schedule doesn't work yet. There is 1 thing to fix."
                    : `This schedule doesn't work yet. There are ${verifyResult.violations.length} things to fix.`}
                </span>
              )}
            </div>
            {verifyResult.feasible && verifyResult.score != null && (
              <button
                onClick={() => setShowBreakdown(v => !v)}
                className="shrink-0 flex items-center gap-1.5 rounded-md border border-green-200 px-3 py-1.5 text-sm font-medium text-green-700 hover:border-green-400 transition-colors"
              >
                <BarChart2 size={14} />
                {showBreakdown ? 'Hide Breakdown' : 'Score Breakdown'}
              </button>
            )}
          </div>
          {!verifyResult.feasible && verifyResult.violations.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-700">What to fix</div>
              <ul className="list-disc space-y-1.5 pl-5 text-base text-red-800">
                {verifyResult.violations.map((msg, i) => <li key={i}>{msg}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Score Breakdown Panel */}
      {showBreakdown && solverData && (
        <div className="mb-8 rounded-lg border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-800">Score Breakdown</h2>
            <button
              onClick={() => setShowBreakdown(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <ScoreBreakdownPanel
            items={breakdown?.trainerItems ?? []}
            genderConsecCount={breakdown?.genderConsecCount ?? 0}
            genderPossibleCount={breakdown?.genderPossibleCount ?? 0}
            noTravelDays={breakdown?.noTravelDays ?? 0}
            noTravelPossibleDays={breakdown?.noTravelPossibleDays ?? 0}
            noTravelMissed={breakdown?.noTravelMissed ?? []}
            adjGroupB2bCount={breakdown?.adjGroupB2bCount ?? 0}
            adjGroupB2bPossible={breakdown?.adjGroupB2bPossible ?? 0}
            adjGroupSameDayCount={breakdown?.adjGroupSameDayCount ?? 0}
            adjGroupB2bPenaltyCount={breakdown?.adjGroupB2bPenaltyCount ?? 0}
            adjGroupB2bPenaltyTrainers={breakdown?.adjGroupB2bPenaltyTrainers ?? []}
            trainerCount={breakdown?.trainerCount ?? 0}
            groupRuleClashes={breakdown?.groupRuleClashes ?? []}
            settings={runSettings}
            data={solverData}
          />
        </div>
      )}

      {/* Schedule View (Calendar or Table) */}
      {(hasResult || (editMode && editableSchedule.length > 0)) && data && (
        !editMode && view === 'table' ? (
          <ScheduleTable
            timeslots={solverData!.timeslots}
            spaces={spaces}
            result={result}
            toolbar={<ViewSwitch view={view} onChange={setView} />}
          />
        ) : (
          <>
            {!editMode && <div className="mb-4"><ViewSwitch view={view} onChange={setView} /></div>}
            <ScheduleGrid
              timeslots={solverData!.timeslots /* with the settings applied, e.g. space-specific times */}
              spaces={spaces}
              result={result}
              groups={runSettings.genderedTeams ? data.groups : undefined /* no gender colours */}
              inProgress={inProgress}
              gapPercent={hierarchical ? null : stats?.gap_percent}
              editMode={editMode}
              editableSchedule={editableSchedule}
              trainers={data.trainers}
              onScheduleChange={next => { setEditableSchedule(next); setVerifyResult(null); }}
            />
          </>
        )
      )}

      {!hasResult && !running && todo.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-base text-gray-500">
          {jobStatus
            ? 'There is no schedule to show yet. Adjust your data or settings, then press Run again.'
            : 'Press Run to build your schedule. You will see the best schedule so far while the scheduler works.'}
        </div>
      )}
    </div>
  );
}

// A score in points, e.g. "60,500".
function points(score: number): string {
  return Math.round(score).toLocaleString();
}

type ScheduleView = 'calendar' | 'table';

// Switches the schedule between the calendar and the table.
function ViewSwitch({ view, onChange }: { view: ScheduleView; onChange: (view: ScheduleView) => void }) {
  const option = (value: ScheduleView, label: string, icon: React.ReactNode) => (
    <button
      onClick={() => onChange(value)}
      aria-pressed={view === value}
      className={`flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
        view === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
      }`}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="inline-flex rounded-md bg-gray-100 p-1">
      {option('calendar', 'Calendar', <CalendarDays size={16} />)}
      {option('table', 'Table', <Table2 size={16} />)}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const badges: Record<string, { label: string; style: string }> = {
    pending:    { label: 'Starting',    style: 'bg-gray-100 text-gray-600' },
    processing: { label: 'Starting',    style: 'bg-blue-50 text-blue-600' },
    solving:    { label: 'Running',     style: 'bg-amber-50 text-amber-600' },
    completed:  { label: 'Finished',    style: 'bg-green-50 text-green-700' },
    failed:     { label: 'No Schedule Found', style: 'bg-red-50 text-red-600' },
    cancelled:  { label: 'Cancelled',   style: 'bg-gray-100 text-gray-600' },
  };
  const badge = badges[status] ?? { label: status, style: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${badge.style}`}>
      {badge.label}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <span className="flex items-center gap-1.5 text-gray-500">
      {label}:
      <span className="font-medium text-gray-800">{value}</span>
      {hint && <InfoHint label={label}>{hint}</InfoHint>}
    </span>
  );
}
