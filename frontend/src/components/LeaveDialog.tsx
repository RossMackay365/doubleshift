'use client';

// Asks before leaving with changes or a run that would be lost, in the app's own style
// (the browser's confirm() box can't be styled).
export default function LeaveDialog({ message, onLeave, onStay }: {
  message: string;
  onLeave: () => void;
  onStay: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onStay} />
      <div
        role="alertdialog"
        aria-label="Leave?"
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white p-6 shadow-xl"
      >
        <p className="text-base text-gray-800">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onStay}
            autoFocus
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Stay
          </button>
          <button
            onClick={onLeave}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Leave
          </button>
        </div>
      </div>
    </>
  );
}
