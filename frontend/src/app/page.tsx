'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { BookOpen, FilePlus, FolderOpen, Upload, X } from 'lucide-react';
import Guide, { SOURCE_URL } from '@/components/Guide';
import { listSchedules, listRecentSchedules, createSchedule, importSchedule } from '@/lib/api';
import { desktopApi } from '@/lib/desktop';
import art from './home-art.png';
import { ScheduleSummary } from '@/lib/types';

export default function Home() {
  const router = useRouter();
  const [recent, setRecent] = useState<ScheduleSummary[]>([]);
  const [dialog, setDialog] = useState<'create' | 'open' | null>(null);
  const [folder, setFolder] = useState('');
  const [allSchedules, setAllSchedules] = useState<ScheduleSummary[]>([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRecentSchedules()
      .then(setRecent)
      .catch(e => setError(`Your recent schedules couldn't be loaded. ${e.message}`));
  }, []);

  function openSchedule(path: string) {
    router.push(`/data?file=${encodeURIComponent(path)}`);
  }

  async function showOpenDialog() {
    try {
      // Desktop app: the Windows Open dialog, starting in the schedules folder.
      const desktop = desktopApi();
      if (desktop) {
        const path = await desktop.choose_schedule();
        if (path) openSchedule(path);
        return;
      }
      // Browser: a list of the files in the schedules folder.
      const { folder, schedules } = await listSchedules();
      setFolder(folder);
      setAllSchedules(schedules);
      setDialog('open');
    } catch (e) {
      setError(`Your schedules couldn't be loaded. ${e instanceof Error ? e.message : e}`);
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
    // The art (logo and name) fills 60% on the left; everything you do is in a centred column
    // on the right, with the licence line at the very bottom. Narrow browser windows show only
    // the right side. The page is exactly the window's height, so the art (which scales to
    // fill its panel) never grows past the window; if the right side runs out of room, only
    // it scrolls.
    <main className="flex h-dvh">
      <div className="relative hidden w-[60%] shrink-0 lg:block">
        <Image src={art} alt="DoubleShift: Training Scheduler" fill priority sizes="60vw" className="object-cover" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 py-8 lg:px-10">
        {/* my-auto centres the column, and still lets it scroll from the top when it's taller
            than the window (items-center would cut off its top). */}
        <div className="flex flex-1 justify-center">
          <div className="my-auto w-full max-w-md">
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Welcome to DoubleShift!</h1>
            <p className="mt-2 text-base text-gray-600">
              Build a training schedule that works for your groups, your trainers and your spaces.
            </p>

            {/* One button per row, all the same width. */}
            <div className="mt-6 flex flex-col gap-3">
              <button
                onClick={() => { setNewName(''); setDialog('create'); }}
                className="flex items-center justify-center gap-2 rounded-md bg-blue-600 px-6 py-3 text-lg font-medium text-white hover:bg-blue-700 transition-colors"
              >
                <FilePlus size={20} />
                Create New Schedule
              </button>
              <button
                onClick={showOpenDialog}
                className="flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-6 py-3 text-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors"
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

            <h2 className="mt-8 mb-3 text-base font-semibold text-gray-800">Recently Opened</h2>
            {recent.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-8 text-center text-sm text-gray-500">
                Schedules you open will appear here.
              </div>
            ) : (
              <ScheduleList schedules={recent} onOpen={openSchedule} />
            )}

            {/* Help for first-timers comes last, out of the way of people who know the app. */}
            <div className="mt-8 border-t border-gray-200 pt-6">
              <h2 className="text-base font-semibold text-gray-800">First Time?</h2>
              <button
                onClick={() => setShowGuide(true)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-6 py-3 text-lg font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <BookOpen size={20} />
                Read the Guide
              </button>
            </div>
          </div>
        </div>

        <footer className="pt-6 text-center text-sm text-gray-400">
          DoubleShift is free and open source under the AGPL-3.0 license.
          <br />
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-500 underline hover:text-gray-700">
            View the source code
          </a>
        </footer>
      </div>

      {dialog === 'create' && (
        <Dialog title="Create New Schedule" onClose={() => setDialog(null)}>
          <form onSubmit={handleCreate} className="px-5 py-4">
            <label htmlFor="schedule-name" className="mb-1 block text-sm font-medium text-gray-700">Name</label>
            <input
              id="schedule-name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Winter Term"
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
            <p className="mb-4 break-all text-sm text-gray-500">Your schedules are saved in {folder}</p>
            {allSchedules.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">You have no saved schedules yet.</p>
            ) : (
              <ScheduleList schedules={allSchedules} onOpen={openSchedule} />
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Upload size={16} />
              Open a File from Elsewhere
            </button>
          </div>
        </Dialog>
      )}

      <input ref={fileInputRef} type="file" accept=".doubleshift" onChange={handleImport} className="hidden" />
      {showGuide && <Guide onClose={() => setShowGuide(false)} />}
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
