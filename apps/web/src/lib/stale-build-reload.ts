// A tab opened before a release still runs the old build. When it lazily loads a chunk
// that the new release removed, the import fails. Reload once to pick up the new build,
// and not again within a minute, so a chunk that is really missing can't loop.
const RELOAD_KEY = "ponder:stale-build-reload-at";
const RELOAD_WINDOW_MS = 60_000;

type StaleBuildWindow = Pick<Window, "addEventListener" | "sessionStorage"> & { location: Pick<Location, "reload"> };

export const installStaleBuildReload = (target: StaleBuildWindow = window, now: () => number = Date.now) => {
  target.addEventListener("vite:preloadError", (event) => {
    let last = 0;
    try {
      last = Number(target.sessionStorage.getItem(RELOAD_KEY)) || 0;
    } catch {
      return;
    }
    if (now() - last < RELOAD_WINDOW_MS) return;
    try {
      target.sessionStorage.setItem(RELOAD_KEY, String(now()));
    } catch {
      return;
    }
    event.preventDefault();
    target.location.reload();
  });
};
