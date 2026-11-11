'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  Play, Square, AlertCircle, CheckCircle2, Loader2, Clock,
  Pencil, X, ShieldCheck, RotateCcw, Save, BarChart2, Settings,
} from 'lucide-react';
import { verifySchedule } from '@/lib/api';
import { ScheduleEntry, VerifyResult, RewardConfig, expandLocations, Court } from '@/lib/types';
import ScheduleGrid from '@/components/ScheduleGrid';
import ScoreBreakdownPanel from '@/components/ScoreBreakdownPanel';
import ConfigPanel from '@/components/ConfigPanel';
import { useSchedule } from '@/components/ScheduleProvider';
import { computeScoreBreakdown } from '@/lib/scoreBreakdown';

// Overlay the optimality gap onto a verify result using the solver's best_bound,
// which the client already holds. Keeps Verify independent of any server-side
// job state — the backend only returns feasibility + score.
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
    data, rewardConfig, setRewardConfig, lastRun, setLastRun,
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

  // Config panel state
  const [configOpen, setConfigOpen] = useState(false);

  // Tick a clock while a run is in progress so the live elapsed counter advances.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);

  function handleRewardConfigChange(config: RewardConfig) {
    setRewardConfig(config);
  }

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
        }
      : jobStatus.stats;
    setLastRun({ ...jobStatus, result: editableSchedule, stats: newStats });
    setEditMode(false);
    setVerifyResult(null);
  }

  const activeRewardConfig = jobStatus?.rewardConfig ?? rewardConfig;

  async function handleVerify() {
    if (!data) return;
    setVerifying(true);
    setVerifyResult(null);
    setError(null);
    try {
      const knownBound = jobStatus?.stats?.best_bound ?? jobStatus?.stats?.final_score ?? null;
      const result = withGap(await verifySchedule(data, editableSchedule, activeRewardConfig), knownBound);
      setVerifyResult(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setVerifying(false);
    }
  }

  const courts = useMemo<Court[]>(
    () => expandLocations(data?.locations ?? []),
    [data?.locations],
  );

  const status    = jobStatus?.status;
  const isModified = useMemo(
    () => editMode && JSON.stringify(editableSchedule) !== JSON.stringify(jobStatus?.result ?? []),
    [editMode, editableSchedule, jobStatus],
  );

  // In edit mode, ask before leaving this page (Data tab, Home, closing the window)
  // with edits that haven't been applied with "Save changes".
  useEffect(() => {
    if (!isModified) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    function onLinkClick(e: MouseEvent) {
      const link = (e.target as HTMLElement).closest('a');
      if (!link || link.pathname === window.location.pathname) return;
      if (!confirm(`You have edits that haven't been applied with "Save changes". Leave without applying them?`)) {
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
  const breakdownSchedule = editMode ? editableSchedule : (jobStatus?.result ?? []);
  const breakdown = useMemo(
    () => (!showBreakdown || !data || breakdownSchedule.length === 0)
      ? null
      : computeScoreBreakdown(
          breakdownSchedule, data.timeslots, data.trainers, data.groups,
          data.locations, data.travelTimes, activeRewardConfig,
        ),
    [showBreakdown, data, breakdownSchedule, activeRewardConfig],
  );
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
  const configLocked = editMode;

  return (
    <div>
      {/* Header row */}
      <div className="mb-8 flex flex-wrap items-start gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">Run Scheduler</h1>
            <button
              onClick={() => setConfigOpen(true)}
              className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Settings size={13} />
              Reward Settings
            </button>
          </div>
          {data && (
            <p className="mt-1 text-base text-gray-500">
              {data.groups.length} groups · {data.trainers.length} trainers · {courts.length} courts · {data.timeslots.length} timeslots
            </p>
          )}
          {!data && (
            <p className="mt-1 text-base text-amber-600">No data yet. Add it on the Data tab.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2.5 ml-auto">
          {!editMode && (
            <>
              <button
                onClick={handleRun}
                disabled={!data || running}
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
                  {cancelling ? 'Cancelling…' : 'Cancel'}
                </button>
              )}
              {canEdit && (
                <button
                  onClick={handleEnterEdit}
                  className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-5 py-2.5 text-base font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Pencil size={17} />
                  Edit schedule
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
                className="flex items-center gap-2 rounded-md bg-blue-600 px-5 py-2.5 text-base font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
              >
                <Save size={17} />
                Save changes
              </button>
              <button
                onClick={handleResetEdit}
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

      {/* Edit mode banner */}
      {editMode && (
        <div className="mb-5 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-base text-blue-700">
          <Pencil size={16} className="shrink-0" />
          <span>Edit mode — drag sessions to move them, use the dropdown to change a trainer. Click <strong className="mx-1">Verify</strong> first, then <strong className="mx-1">Save changes</strong>.</span>
          {isModified && (
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-sm font-medium text-amber-600">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
              Unsaved changes
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

      {/* Solver stats */}
      {jobStatus && !editMode && (
        <div className="mb-8 rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5 text-base">
              <StatusBadge status={status!} />
              {stats?.solutions_found != null && <Stat label="Solutions found" value={stats.solutions_found} />}
              {stats?.current_score != null && <Stat label="Current score" value={(stats.current_score / 10000).toFixed(2)} />}
              {liveElapsed != null && (
                <Stat
                  label="Elapsed"
                  value={`${liveElapsed.toFixed(1)}s${timeLimit != null ? ` / ${timeLimit.toFixed(0)}s limit` : ''}`}
                />
              )}
              {stats?.gap_percent != null && <Stat label="Gap" value={`${stats.gap_percent.toFixed(1)}%`} />}
              {nearTimeout && (
                <span className="flex items-center gap-1.5 text-amber-600">
                  <Clock size={16} /> Reaching time limit — finishing up…
                </span>
              )}
              {stats?.optimal && (
                <span className="flex items-center gap-1.5 text-green-600">
                  <CheckCircle2 size={16} /> Optimal
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
                  {hasResult ? 'Cancelled' : 'Cancelled - No Solution Found'}
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
                {showBreakdown ? 'Hide breakdown' : 'Score breakdown'}
              </button>
            )}
          </div>
          {stats?.issues && stats.issues.length > 0 && (
            <div className="mt-4 rounded-md border border-red-100 bg-red-50 p-4">
              <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-700">Likely causes</div>
              <ul className="list-disc space-y-1.5 pl-5 text-base text-red-800">
                {stats.issues.map((msg, i) => <li key={i}>{msg}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Verify result panel */}
      {verifyResult && editMode && (
        <div className={`mb-6 rounded-lg border p-5 ${verifyResult.feasible ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5 text-base">
              {verifyResult.feasible ? (
                <>
                  <span className="flex items-center gap-1.5 font-semibold text-green-700">
                    <CheckCircle2 size={17} /> Valid schedule
                  </span>
                  {verifyResult.score != null && <Stat label="Score" value={(verifyResult.score / 10000).toFixed(2)} />}
                  {(stats?.final_score ?? stats?.current_score) != null && (
                    <Stat label="Solver best" value={((stats!.final_score ?? stats!.current_score)! / 10000).toFixed(2)} />
                  )}
                  {verifyResult.best_bound != null && <Stat label="Overall optimum" value={(verifyResult.best_bound / 10000).toFixed(2)} />}
                  {verifyResult.gap_percent != null && (
                    <Stat label="Gap" value={`${verifyResult.gap_percent.toFixed(1)}%`} />
                  )}
                  {verifyResult.gap_percent === 0 && (
                    <span className="flex items-center gap-1.5 text-green-600">
                      <CheckCircle2 size={16} /> Optimal
                    </span>
                  )}
                </>
              ) : (
                <span className="flex items-center gap-1.5 font-semibold text-red-700">
                  <AlertCircle size={17} /> Infeasible schedule
                </span>
              )}
            </div>
            {verifyResult.feasible && verifyResult.score != null && (
              <button
                onClick={() => setShowBreakdown(v => !v)}
                className="shrink-0 flex items-center gap-1.5 rounded-md border border-green-200 px-3 py-1.5 text-sm font-medium text-green-700 hover:border-green-400 transition-colors"
              >
                <BarChart2 size={14} />
                {showBreakdown ? 'Hide breakdown' : 'Score breakdown'}
              </button>
            )}
          </div>
          {!verifyResult.feasible && verifyResult.violations.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-700">Violations</div>
              <ul className="list-disc space-y-1.5 pl-5 text-base text-red-800">
                {verifyResult.violations.map((msg, i) => <li key={i}>{msg}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Score breakdown panel */}
      {showBreakdown && data && (
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
            rewardConfig={activeRewardConfig}
          />
        </div>
      )}

      {/* Schedule grid */}
      {(hasResult || (editMode && editableSchedule.length > 0)) && data && (
        <ScheduleGrid
          timeslots={data.timeslots}
          courts={courts}
          result={result}
          groups={data.groups}
          inProgress={inProgress}
          gapPercent={stats?.gap_percent}
          editMode={editMode}
          editableSchedule={editableSchedule}
          trainers={data.trainers}
          onScheduleChange={next => { setEditableSchedule(next); setVerifyResult(null); }}
        />
      )}

      {!hasResult && jobStatus && !running && (
        <p className="text-base text-gray-500">No schedule produced.</p>
      )}

      <ConfigPanel
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        config={rewardConfig}
        onChange={handleRewardConfigChange}
        locked={configLocked}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending:    'bg-gray-100 text-gray-600',
    processing: 'bg-blue-50 text-blue-600',
    solving:    'bg-amber-50 text-amber-600',
    completed:  'bg-green-50 text-green-700',
    failed:     'bg-red-50 text-red-600',
    cancelled:  'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`rounded-full px-3 py-1 text-sm font-semibold capitalize ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

function Stat({ label, value, onClick }: { label: string; value: string | number; onClick?: () => void }) {
  return (
    <span className="text-gray-500">
      {label}:{' '}
      {onClick ? (
        <button
          onClick={onClick}
          className="font-medium text-gray-800 underline decoration-dashed underline-offset-2 hover:text-blue-600"
          title="Click to see breakdown"
        >
          {value}
        </button>
      ) : (
        <span className="font-medium text-gray-800">{value}</span>
      )}
    </span>
  );
}
