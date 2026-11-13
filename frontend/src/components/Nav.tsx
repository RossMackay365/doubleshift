'use client';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle, CircleHelp, House, Loader2, Play, Save, Settings, Table2 } from 'lucide-react';
import Guide from '@/components/Guide';
import { useSchedule } from '@/components/ScheduleProvider';
import logo from '@/app/icon.png';

// Header for an open schedule: its name (with an unsaved-changes dot), the Data /
// Scheduler tabs, Save, Settings, Guide and Home. Status indicators never change the width of the
// buttons, so nothing on the right shifts.
// The guide section for each page, so the guide opens at the help for the page you're on.
const GUIDE_SECTIONS: Record<string, string> = {
  '/data': 'data',
  '/run': 'results',
  '/settings': 'settings',
};

export default function Nav() {
  const path = usePathname();
  const { path: filePath, name, isModified, save, running } = useSchedule();
  const query = `?file=${encodeURIComponent(filePath)}`;
  const [showGuide, setShowGuide] = useState(false);
  const guideSection = Object.entries(GUIDE_SECTIONS).find(([href]) => path.startsWith(href))?.[1];

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
    // In the desktop app the window buttons sit in the top 32px (WindowControls), so the
    // header's content moves down by that much. The header keeps the same room for a
    // scrollbar as the page below it (see the schedule layout), so the two line up.
    <nav className="relative shrink-0 overflow-y-hidden border-b border-gray-200 bg-white [scrollbar-gutter:stable] desktop:pt-8">
      {/* The logo sits in the space left of the content, centred between the window's edge and
          the start of "DoubleShift" (that space is the 2rem padding, plus half of whatever the
          window has beyond the 80rem content width). The name still lines up with the page
          below. Narrow windows leave too little space, so they don't show it. */}
      <Link
        href="/"
        className="absolute bottom-0 hidden h-24 -translate-x-1/2 items-center min-[1328px]:flex"
        style={{ left: 'calc(max(2rem, (100% - 80rem) / 2 + 2rem) / 2)' }}
      >
        <Image src={logo} alt="DoubleShift home" width={32} height={32} />
      </Link>
      <div className="mx-auto max-w-7xl px-8 flex h-24 items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="text-2xl leading-none font-semibold text-gray-800 tracking-tight">
            DoubleShift
          </Link>
          <span className="truncate text-lg leading-none text-gray-500">{name}</span>
          {isModified && (
            <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-amber-600">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
              Unsaved Changes
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
          <button
            onClick={() => setShowGuide(true)}
            title="Guide"
            className="rounded-md px-3 py-3 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <CircleHelp size={20} />
          </button>
          <Link
            href="/"
            title="Home"
            className="rounded-md px-3 py-3 text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <House size={20} />
          </Link>
        </div>
      </div>
      {showGuide && <Guide section={guideSection} onClose={() => setShowGuide(false)} />}
    </nav>
  );
}
