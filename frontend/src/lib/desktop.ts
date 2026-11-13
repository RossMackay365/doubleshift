// In the desktop app, the launcher (backend/desktop.py) gives the page these functions as
// window.pywebview.api. In a browser (Docker or `npm run dev`) there are none, and the
// app uses its in-page alternatives instead.
interface DesktopApi {
  // Shows the Windows Open dialog in the schedules folder. Returns the chosen file's path,
  // or null if the user cancels.
  choose_schedule(): Promise<string | null>;
  // What to ask before the window closes ('' to close without asking).
  set_leave_warning(warning: string): Promise<void>;
  // The window has no Windows title bar, so WindowControls draws these buttons.
  minimize(): Promise<void>;
  toggle_maximize(): Promise<boolean>; // whether it's now maximised
  is_maximized(): Promise<boolean>;
  close(): Promise<void>;
}

export function desktopApi(): DesktopApi | null {
  return (window as { pywebview?: { api?: DesktopApi } }).pywebview?.api ?? null;
}

// The API arrives shortly after the page loads, with a 'pywebviewready' event.
export function onDesktopReady(callback: () => void): () => void {
  if (desktopApi()) {
    callback();
    return () => {};
  }
  window.addEventListener('pywebviewready', callback);
  return () => window.removeEventListener('pywebviewready', callback);
}
