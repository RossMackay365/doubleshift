'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FilePlus, FolderOpen, Upload, X } from 'lucide-react';
import { listSchedules, listRecentSchedules, createSchedule, importSchedule } from '@/lib/api';
import { ScheduleSummary } from '@/lib/types';

export default function Home() {
  const router = useRouter();
  const [recent, setRecent] = useState<ScheduleSummary[]>([]);
  const [dialog, setDialog] = useState<'create' | 'open' | null>(null);
  const [folder, setFolder] = useState('');
  const [allSchedules, setAllSchedules] = useState<ScheduleSummary[]>([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRecentSchedules()
      .then(setRecent)
      .catch(e => setError(`Could not load recent schedules: ${e.message}`));
  }, []);

  function openSchedule(path: string) {
    router.push(`/data?file=${encodeURIComponent(path)}`);
  }

  async function showOpenDialog() {
    try {
      const { folder, schedules } = await listSchedules();
      setFolder(folder);
      setAllSchedules(schedules);
      setDialog('open');
    } catch (e) {
      setError(`Could not list schedules: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const schedule = await createSchedule(newName.trim());
      openSchedule(schedule.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDialog(null);
    }
  }

  // Browser mode: copy a file from elsewhere into the schedules folder, then open it.
  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (!file) return;
    try {
      const schedule = await importSchedule(file);
      openSchedule(schedule.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDialog(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-8 py-20">
      <h1 className="text-4xl font-semibold text-gray-900 tracking-tight">DoubleShift</h1>
      <p className="mt-2 text-xl text-gray-500">Training Scheduler</p>

      <div className="mt-10 flex flex-wrap gap-4">
        <button
          onClick={() => { setNewName(''); setDialog('create'); }}
          className="flex items-center gap-2 rounded-md bg-blue-600 px-6 py-3 text-lg font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <FilePlus size={20} />
          Create New Schedule
        </button>
        <button
          onClick={showOpenDialog}
          className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-6 py-3 text-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <FolderOpen size={20} />
          Open Existing Schedule
        </button>
      </div>

      {error && (
        <div className="mt-6 flex items-start justify-between gap-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X size={16} /></button>
        </div>
      )}

      <h2 className="mt-14 mb-4 text-base font-semibold text-gray-700">Recently Viewed</h2>
      {recent.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-400">
          No recently viewed schedules yet.
        </div>
      ) : (
        <ScheduleList schedules={recent} onOpen={openSchedule} />
      )}

      {dialog === 'create' && (
        <Dialog title="Create New Schedule" onClose={() => setDialog(null)}>
          <form onSubmit={handleCreate} className="px-5 py-4">
            <label htmlFor="schedule-name" className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input
              id="schedule-name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Winter Term"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none"
              autoFocus
            />
            <div className="mt-5 flex justify-end">
              <button
                type="submit"
                disabled={!newName.trim()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                Create
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {dialog === 'open' && (
        <Dialog title="Open Existing Schedule" onClose={() => setDialog(null)}>
          <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
            <p className="mb-4 break-all text-sm text-gray-500">Schedules saved in {folder}</p>
            {allSchedules.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">No saved schedules yet.</p>
            ) : (
              <ScheduleList schedules={allSchedules} onOpen={openSchedule} />
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Upload size={16} />
              Open a file from elsewhere…
            </button>
          </div>
        </Dialog>
      )}

      <input ref={fileInputRef} type="file" accept=".doubleshift" onChange={handleImport} className="hidden" />
    </main>
  );
}

function ScheduleList({ schedules, onOpen }: { schedules: ScheduleSummary[]; onOpen: (path: string) => void }) {
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {schedules.map(s => (
        <li key={s.path}>
          <button
            onClick={() => onOpen(s.path)}
            title={s.path}
            className="block w-full truncate px-5 py-3 text-left font-medium text-gray-800 hover:bg-gray-50"
          >
            {s.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 transition-colors hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
