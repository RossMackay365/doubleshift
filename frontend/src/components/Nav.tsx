'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CheckCircle, House, Loader2, Play, Save, Settings, Table2 } from 'lucide-react';
import { useSchedule } from '@/components/ScheduleProvider';

// Header for an open schedule: its name (with an unsaved-changes dot), the Data /
// Scheduler tabs, Save, Settings and Home. Status indicators never change the width of the
// buttons, so nothing on the right shifts.
export default function Nav() {
  const path = usePathname();
  const { path: filePath, name, isModified, save, running } = useSchedule();
  const query = `?file=${encodeURIComponent(filePath)}`;

  const links = [
    { href: '/data', label: 'Data', icon: <Table2 size={20} /> },
    {
      href: '/run',
      label: 'Scheduler',
      // Spinner while a run is in progress, so it's visible from the Data tab too.
      icon: running ? <Loader2 size={20} className="animate-spin" /> : <Play size={20} />,
    },
  ];

  const tabClass = (href: string) =>
    `flex items-center gap-2 rounded-md py-3 text-lg font-medium transition-colors ${
      path.startsWith(href)
        ? 'bg-blue-50 text-blue-700'
        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
    }`;

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-7xl px-8 flex h-24 items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="text-2xl leading-none font-semibold text-gray-800 tracking-tight">DoubleShift</Link>
          <span className="truncate text-lg leading-none text-gray-500">{name}</span>
          {isModified && (
            <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-amber-600">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
              Unsaved changes
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {links.map(({ href, label, icon }) => (
            <Link key={href} href={href + query} className={`${tabClass(href)} px-5`}>
              {icon}
              {label}
            </Link>
          ))}
          <div className="mx-3 h-8 w-px bg-gray-200" />
          <button
            onClick={save}
            title="Save (Ctrl+S)"
            className={`flex w-32 items-center justify-center gap-2 rounded-md py-2.5 text-base font-medium transition-colors ${
              isModified ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-green-50 text-green-700'
            }`}
          >
            {isModified ? <Save size={17} /> : <CheckCircle size={17} />}
            {isModified ? 'Save' : 'Saved'}
          </button>
          <Link href={'/settings' + query} title="Scheduler Settings" className={`${tabClass('/settings')} px-3`}>
            <Settings size={20} />
          </Link>
          <Link
            href="/"
            title="Home"
            className="rounded-md px-3 py-3 text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <House size={20} />
          </Link>
        </div>
      </div>
    </nav>
  );
}
