// In the desktop app, the launcher (backend/desktop.py) gives the page these functions as
// window.pywebview.api. In a browser (Docker or `npm run dev`) there are none, and the
// app uses its in-page alternatives instead.
interface DesktopApi {
  // Shows the Windows Open dialog in the schedules folder. Returns the chosen file's path,
  // or null if the user cancels.
  choose_schedule(): Promise<string | null>;
  // What to ask before the window closes ('' to close without asking).
  set_leave_warning(warning: string): Promise<void>;
}

export function desktopApi(): DesktopApi | null {
  return (window as { pywebview?: { api?: DesktopApi } }).pywebview?.api ?? null;
}
