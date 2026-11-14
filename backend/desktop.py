"""The DoubleShift Desktop App.

Runs the backend (which also serves the frontend's static build) on 127.0.0.1, and shows it
in a window (pywebview, using Windows' built-in WebView2). Run it with `python desktop.py`
after building the frontend, or build DoubleShift.exe with `pyinstaller doubleshift.spec`.

A .doubleshift file path given on the command line (double-clicking a schedule in Explorer)
opens that schedule straight away.
"""
import multiprocessing


class DesktopApi:
    """Functions the page can call as window.pywebview.api (see frontend/src/lib/desktop.ts)."""

    def choose_schedule(self):
        import webview
        from app import schedules

        paths = webview.windows[0].create_file_dialog(
            webview.FileDialog.OPEN,
            directory=schedules.SCHEDULES_DIR,
            file_types=("DoubleShift schedules (*.doubleshift)",),
        )
        return paths[0] if paths else None

    def set_leave_warning(self, warning):
        self._leave_warning = warning

    # Minimise, Maximise and Close Buttons - Custom Window Bar
    def minimize(self):
        import webview

        webview.windows[0].minimize()

    def toggle_maximize(self):
        import webview

        window = webview.windows[0]
        if self.is_maximized():
            window.restore()
        else:
            _fit_maximised_to_screen(window)
            window.maximize()
        return self.is_maximized()

    def is_maximized(self):
        import webview

        return str(webview.windows[0].native.WindowState) == "Maximized"

    def close(self):
        import webview

        webview.windows[0].destroy()

    def _confirm_close(self, window):
        """Runs as the window starts to close. Returning False keeps it open."""
        warning = getattr(self, "_leave_warning", "")
        if warning:
            return window.create_confirmation_dialog("DoubleShift", warning)


def _fit_maximised_to_screen(window):
    from System import Func, Type
    from System.Windows.Forms import Screen

    form = window.native

    def fit():
        form.MaximizedBounds = Screen.FromHandle(form.Handle).WorkingArea

    form.Invoke(Func[Type](fit))


def _start_maximised(window):
    _fit_maximised_to_screen(window)
    window.maximize()


def main():
    import logging
    import os
    import socket
    import sys
    import threading
    import time
    from urllib.parse import quote

    import uvicorn
    import webview

    from app import schedules

    # Setup Log File
    os.makedirs(schedules.DATA_DIR, exist_ok=True)
    log_file = open(os.path.join(schedules.DATA_DIR, "doubleshift.log"), "w", encoding="utf-8")
    if sys.stdout is None:
        sys.stdout = log_file
    if sys.stderr is None:
        sys.stderr = log_file
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        stream=log_file,
    )

    from app.main import app

    # Setup Port
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]

    # Start Server
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_config=None))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        if not thread.is_alive():
            raise SystemExit("The DoubleShift backend didn't start. See doubleshift.log.")
        time.sleep(0.05)

    url = f"http://127.0.0.1:{port}/"
    opened = sys.argv[1] if len(sys.argv) > 1 else ""
    if opened.lower().endswith(".doubleshift") and os.path.isfile(opened):
        url += f"data/?file={quote(os.path.abspath(opened))}"

    api = DesktopApi()
    window = webview.create_window(
        "DoubleShift: Training Scheduler",
        url,
        js_api=api,
        frameless=True,
        easy_drag=False,
        width=1440,
        height=900,
        min_size=(1024, 700),
        text_select=True,
    )
    window.events.closing += api._confirm_close
    window.events.shown += _start_maximised
    webview.start()

    for child in multiprocessing.active_children():
        child.terminate()
    server.should_exit = True
    thread.join(timeout=5)


if __name__ == "__main__":
    # Allow Freezing of Child Processes (to support exit during a solver run)
    multiprocessing.freeze_support()
    main()
