'use client';
import { useEffect, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { desktopApi, onDesktopReady } from '@/lib/desktop';

// The desktop app's window has no Windows title bar, so this draws its minimise, maximise
// and close buttons in the top right corner, over the page, plus a strip along the top for
// moving the window (when it isn't maximised). It also marks the page with the "desktop"
// class, so the header can leave room for it (the `desktop:` variant in globals.css).
// In a browser it shows nothing.
export default function WindowControls() {
  const [isDesktop, setIsDesktop] = useState(false);
  const [maximized, setMaximized] = useState(true);

  useEffect(() => onDesktopReady(() => {
    setIsDesktop(true);
    document.documentElement.classList.add('desktop');
    desktopApi()?.is_maximized().then(setMaximized);
  }), []);

  if (!isDesktop) return null;

  async function toggleMaximize() {
    const api = desktopApi();
    if (api) setMaximized(await api.toggle_maximize());
  }

  const button = 'flex h-8 w-11 items-center justify-center text-gray-500 transition-colors';

  return (
    <>
      {/* pywebview moves the window when this strip is dragged. A maximised window stays put. */}
      <div
        className={`fixed top-0 left-0 right-33 z-[60] h-8 ${maximized ? '' : 'pywebview-drag-region'}`}
        onDoubleClick={toggleMaximize}
      />
      <div className="fixed top-0 right-0 z-[60] flex">
        <button onClick={() => desktopApi()?.minimize()} title="Minimise" className={`${button} hover:bg-gray-200 hover:text-gray-900`}>
          <Minus size={16} strokeWidth={1.75} />
        </button>
        <button onClick={toggleMaximize} title={maximized ? 'Restore' : 'Maximise'} className={`${button} hover:bg-gray-200 hover:text-gray-900`}>
          {maximized ? <Copy size={14} strokeWidth={1.75} /> : <Square size={14} strokeWidth={1.75} />}
        </button>
        <button onClick={() => desktopApi()?.close()} title="Close" className={`${button} hover:bg-red-600 hover:text-white`}>
          <X size={17} strokeWidth={1.75} />
        </button>
      </div>
    </>
  );
}
