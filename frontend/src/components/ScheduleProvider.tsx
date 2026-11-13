'use client';
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSchedule, saveSchedule, startSolve, getJobStatus, cancelSolve } from '@/lib/api';
import { DEFAULT_SETTINGS, withDefaults, withUnavailableOff } from '@/lib/settings';
import { JobStatus, ScheduleContents, ScheduleData, ScheduleSettings } from '@/lib/types';
import ScheduleNotFound from '@/components/ScheduleNotFound';

const POLL_MS = 1000;
const DONE = new Set(['completed', 'failed', 'cancelled']);

// The open schedule (?file=<path>), shared by its Data, Run and Settings pages. Pages edit this
// working copy; save() writes all of it to the file, so one Save covers everything and
// switching tabs never loses changes. A solver run also lives here, so it keeps going
// while switching tabs.
interface OpenSchedule {
  path: string;
  name: string;
  data: ScheduleData | null;
  setData: (data: ScheduleData) => void;
  settings: ScheduleSettings;
  setSettings: (settings: ScheduleSettings) => void;
  lastRun: JobStatus | null;
  setLastRun: (run: JobStatus | null) => void;
  isModified: boolean;
  save: () => Promise<void>;
  // The run in progress (null when not running); once finished it becomes lastRun.
  activeRun: JobStatus | null;
  running: boolean;
  cancelling: boolean;
  startedAt: number | null; // wall-clock start, for a live elapsed counter
  runError: string | null;
  clearRunError: () => void;
  startRun: () => Promise<void>;
  cancelRun: () => Promise<void>;
}

const ScheduleContext = createContext<OpenSchedule | null>(null);

export function useSchedule(): OpenSchedule {
  const schedule = useContext(ScheduleContext);
  if (!schedule) throw new Error('useSchedule must be used inside ScheduleProvider');
  return schedule;
}

export default function ScheduleProvider({ children }: { children: React.ReactNode }) {
  const path = useSearchParams().get('file') ?? '';
  const [status, setStatus] = useState<'loading' | 'ready' | 'notFound'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [data, setData] = useState<ScheduleData | null>(null);
  const [settings, setSettings] = useState<ScheduleSettings>(DEFAULT_SETTINGS);
  const [lastRun, setLastRun] = useState<JobStatus | null>(null);
  // The contents as last loaded or saved, to tell whether there are unsaved changes.
  const [savedJson, setSavedJson] = useState('');

  const contents: ScheduleContents = useMemo(
    () => ({ data, settings, last_run: lastRun }),
    [data, settings, lastRun],
  );
  const contentsJson = useMemo(() => JSON.stringify(contents), [contents]);
  const isModified = status === 'ready' && contentsJson !== savedJson;

  useEffect(() => {
    if (!path) {
      startTransition(() => setStatus('notFound'));
      return;
    }
    getSchedule(path)
      .then(schedule => {
        if (!schedule) {
          setStatus('notFound');
          return;
        }
        const loadedSettings = withUnavailableOff(withDefaults(schedule.settings), schedule.data);
        setName(schedule.name);
        setData(schedule.data);
        setSettings(loadedSettings);
        setLastRun(schedule.last_run);
        // Same shape and key order as `contents`, so an untouched schedule isn't "modified".
        setSavedJson(JSON.stringify({ data: schedule.data, settings: loadedSettings, last_run: schedule.last_run }));
        setStatus('ready');
      })
      .catch(e => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [path]);

  const save = useCallback(async () => {
    try {
      await saveSchedule(path, contents);
      setSavedJson(contentsJson);
    } catch (e) {
      alert(`Your schedule couldn't be saved. ${e instanceof Error ? e.message : e}`);
    }
  }, [path, contents, contentsJson]);

  // Changing the data or settings can make a reward unavailable (e.g. removing the second
  // location); it's then switched off, see withUnavailableOff.
  const updateData = useCallback((next: ScheduleData) => {
    setData(next);
    setSettings(current => withUnavailableOff(current, next));
  }, []);
  const updateSettings = useCallback(
    (next: ScheduleSettings) => setSettings(withUnavailableOff(next, data)),
    [data],
  );

  // --- Running the solver ---
  const [activeRun, setActiveRun] = useState<JobStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The job being polled. Responses for any other job (e.g. a late reply from a
  // previous run) are ignored.
  const jobIdRef = useRef<string | null>(null);

  function stopPolling() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function finishRun() {
    stopPolling();
    jobIdRef.current = null;
    setRunning(false);
    setCancelling(false);
  }

  async function poll(jobId: string, runSettings: ScheduleSettings) {
    try {
      const status = await getJobStatus(jobId);
      if (jobIdRef.current !== jobId) return;
      // Remember which settings the run used, for scoring and verifying it later.
      const withSettings = { ...status, settings: runSettings };
      if (DONE.has(status.status)) {
        setLastRun(withSettings);
        setActiveRun(null);
        finishRun();
      } else {
        setActiveRun(withSettings);
      }
    } catch (e) {
      if (jobIdRef.current !== jobId) return;
      setRunError(e instanceof Error ? e.message : String(e));
      finishRun();
    }
  }

  async function startRun() {
    if (!data) return;
    stopPolling();
    setRunError(null);
    setActiveRun(null);
    setRunning(true);
    setCancelling(false);
    setStartedAt(Date.now());
    const runSettings = settings;
    try {
      const { job_id } = await startSolve(data, runSettings);
      jobIdRef.current = job_id;
      setActiveRun({ job_id, status: 'pending', stats: {} as JobStatus['stats'], result: null, settings: runSettings });
      intervalRef.current = setInterval(() => poll(job_id, runSettings), POLL_MS);
      poll(job_id, runSettings);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
      finishRun();
    }
  }

  async function cancelRun() {
    const jobId = jobIdRef.current;
    if (!jobId) {
      // No job on the server yet, so just stop.
      finishRun();
      return;
    }
    setCancelling(true);
    try {
      // Keep polling: the backend marks the job 'cancelled' and the next poll then
      // stores the best schedule found so far as the last run.
      await cancelSolve(jobId);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
      setCancelling(false);
    }
  }

  // Leaving the schedule mid-run: stop polling and cancel the job so it stops using CPU.
  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (jobIdRef.current) cancelSolve(jobIdRef.current).catch(() => {});
  }, []);

  // Ctrl+S saves the whole schedule, from any page.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  // Ask before leaving the schedule with unsaved changes or a run in progress: closing/
  // reloading the window, or clicking a link out of it (Home). Switching tabs is fine.
  useEffect(() => {
    if (!isModified && !running) return;
    const warning = running
      ? 'The scheduler is still running. If you leave now, it stops. Leave anyway?'
      : "You have changes you haven't saved. Leave without saving?";
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    function onLinkClick(e: MouseEvent) {
      const link = (e.target as HTMLElement).closest('a');
      if (!link || ['/data', '/run', '/settings'].includes(link.pathname)) return;
      if (!confirm(warning)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onLinkClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onLinkClick, true);
    };
  }, [isModified, running]);

  if (loadError) return <ScheduleNotFound message={`This schedule couldn't be opened. ${loadError}`} />;
  if (status === 'notFound') return <ScheduleNotFound />;
  if (status === 'loading') return null;

  return (
    <ScheduleContext.Provider value={{
      path, name, data, setData: updateData, settings, setSettings: updateSettings, lastRun, setLastRun, isModified, save,
      activeRun, running, cancelling, startedAt, runError, clearRunError: () => setRunError(null), startRun, cancelRun,
    }}>
      {children}
    </ScheduleContext.Provider>
  );
}
