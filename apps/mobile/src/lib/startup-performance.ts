type StartupMark = "index-ready" | "workspace-first-commit" | "workspace-data-ready" | "workspace-interactive";

type NativeStartupTiming = {
  endTime?: number | null;
  executeJavaScriptBundleEntryPointStart?: number | null;
  initializeRuntimeStart?: number | null;
  startTime?: number | null;
};

const marks = new Map<StartupMark, number>();
let latestEditorStartupMs: number | null = null;
let editorOpenStartedAt: number | null = null;

const logPerformance = (metric: string, durationMs: number) => {
  console.info(`[PonderPerformance] ${metric}=${Math.max(0, durationMs).toFixed(0)}ms`);
};

export const markStartup = (name: StartupMark) => {
  if (!marks.has(name)) {
    const now = performance.now();
    marks.set(name, now);
    const nativeStart = (performance as Performance & { rnStartupTiming?: NativeStartupTiming }).rnStartupTiming?.startTime ?? 0;
    logPerformance(name, now - nativeStart);
  }
};

export const beginEditorStartup = () => {
  editorOpenStartedAt = performance.now();
};

export const recordEditorStartup = (durationMs: number) => {
  if (Number.isFinite(durationMs) && durationMs >= 0) {
    latestEditorStartupMs = durationMs;
    logPerformance("local-editor-ready", durationMs);
    if (editorOpenStartedAt !== null) {
      logPerformance("editor-open-to-ready", performance.now() - editorOpenStartedAt);
      editorOpenStartedAt = null;
    }
  }
};

export const getStartupPerformanceItems = () => {
  const nativeTiming = (performance as Performance & { rnStartupTiming?: NativeStartupTiming }).rnStartupTiming;
  const nativeStart = nativeTiming?.startTime ?? 0;
  const duration = (end?: number | null, start?: number | null) =>
    typeof end === "number" && typeof start === "number" ? `${Math.max(0, end - start).toFixed(0)} ms` : "Unavailable";
  const sinceNativeStart = (name: StartupMark) => {
    const value = marks.get(name);
    return typeof value === "number" ? `${Math.max(0, value - nativeStart).toFixed(0)} ms` : "Not recorded";
  };

  return [
    { label: "Native runtime startup", value: duration(nativeTiming?.endTime, nativeTiming?.startTime) },
    { label: "Launch to JavaScript execution", value: duration(nativeTiming?.executeJavaScriptBundleEntryPointStart, nativeTiming?.startTime) },
    { label: "Launch to session/cache ready", value: sinceNativeStart("index-ready") },
    { label: "Launch to workspace first frame", value: sinceNativeStart("workspace-first-commit") },
    { label: "Launch to list data ready", value: sinceNativeStart("workspace-data-ready") },
    { label: "Launch to interaction idle", value: sinceNativeStart("workspace-interactive") },
    { label: "Latest local editor startup", value: latestEditorStartupMs === null ? "Not recorded" : `${latestEditorStartupMs.toFixed(0)} ms` },
  ];
};
