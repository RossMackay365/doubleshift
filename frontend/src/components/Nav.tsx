'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function Nav() {
  const path = usePathname();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(!!sessionStorage.getItem('auth_token'));
  }, [path]);

  const links = [
    { href: '/data', label: 'Data' },
    { href: '/run', label: 'Run Scheduler' },
  ];

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-7xl px-10 flex h-24 items-center justify-between">
        <span className="text-2xl font-semibold text-gray-800 tracking-tight">Schedule Optimiser</span>
        {authed && (
          <div className="flex gap-2">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`rounded-md px-5 py-3 text-lg font-medium transition-colors ${
                  path.startsWith(href)
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
