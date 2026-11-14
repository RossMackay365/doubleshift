'use client';
import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

const WIDTH = 288;

// A small "i" button that opens a short explanation next to it. Click it again, click
// anywhere else, scroll or press Escape to close.
export default function InfoHint({ label, children }: { label: string; children: React.ReactNode }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const onMouseDown = (e: MouseEvent) => {
      if (!buttonRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [position]);

  function toggle() {
    if (position) {
      setPosition(null);
      return;
    }
    const rect = buttonRef.current!.getBoundingClientRect();
    // Keep the box on screen when the button is near the right edge.
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8));
    setPosition({ left, top: rect.bottom + 6 });
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={`About ${label}`}
        aria-expanded={position !== null}
        className={`inline-flex shrink-0 rounded-full align-middle transition-colors ${
          position ? 'text-blue-600' : 'text-gray-400 hover:text-blue-600'
        }`}
      >
        <Info size={15} />
      </button>
      {position && (
        <span
          role="note"
          style={{ left: position.left, top: position.top, width: WIDTH }}
          className="fixed z-50 whitespace-pre-line rounded-md border border-gray-200 bg-white p-3 text-left text-sm font-normal normal-case leading-snug tracking-normal text-gray-600 shadow-lg"
        >
          {children}
        </span>
      )}
    </>
  );
}
