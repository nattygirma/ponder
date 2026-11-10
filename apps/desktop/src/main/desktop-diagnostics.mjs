const DESKTOP_REPORT_URL = "https://appkeep.io";
const DESKTOP_CLIENT_BY_PLATFORM = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};
// Keep the prefilled GitHub URL below common browser/server URL limits while
// retaining the first useful frames from renderer stacks.
const MAX_DIAGNOSTIC_TEXT_LENGTH = 1_200;

export const sanitizeDesktopDiagnosticText = (value) => {
  if (typeof value !== "string") return "";
  return value
    .slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH)
    .replace(/file:\/\/\/[^\s)\]}]+/gi, (match) => {
      const asset = match.match(/\/assets\/[^/:\s)\]}]+(?:\.js|\.css)(?::\d+){0,2}$/i);
      return asset ? `file:///[app]${asset[0]}` : "file:///[redacted-path]";
    })
    .replace(/https?:\/\/[^\s)\]}]+/gi, "[redacted-url]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]")
    .replace(/([A-Za-z]:\\Users\\)[^\\\s]+/gi, "$1[redacted]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/((?:["']?(?:token|password|secret|api[_-]?key)["']?)\s*[=:]\s*["']?)[^"',;\s}]+/gi, "$1[redacted]");
};

export const normalizeDesktopDiagnostic = (input = {}) => {
  const source = input && typeof input === "object" ? input : {};
  return {
    kind: sanitizeDesktopDiagnosticText(source.kind) || "unknown",
    message: sanitizeDesktopDiagnosticText(source.message),
    stack: sanitizeDesktopDiagnosticText(source.stack),
    componentStack: sanitizeDesktopDiagnosticText(source.componentStack),
    reason: sanitizeDesktopDiagnosticText(source.reason),
    exitCode: Number.isFinite(source.exitCode) ? source.exitCode : null,
  };
};

// appkeep.io has no report form yet, so crash details are deliberately left out of the link.
export const buildDesktopDiagnosticIssueUrl = () => DESKTOP_REPORT_URL;
