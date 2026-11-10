/** Links to apps that can be connected by login, and how to tell which item one points at. */
export type ConnectedLink =
  | { provider: "github"; kind: "repo"; owner: string; repo: string; url: string }
  | { provider: "github"; kind: "issue"; owner: string; repo: string; number: string; url: string }
  | { provider: "slack"; channel: string; ts: string; threadTs: string | null; url: string }
  | { provider: "drive"; fileId: string; url: string };

export type ConnectedLinkProvider = ConnectedLink["provider"];

export type LinkPreviewData = {
  url: string;
  provider: ConnectedLinkProvider;
  title: string;
  subtitle: string;
};

const GITHUB_NAME = /^[\w.-]+$/;
const DOCS_APPS = new Set(["document", "spreadsheets", "presentation", "forms"]);

const parseGitHub = (url: URL): ConnectedLink | null => {
  const [owner, repo, section, number, extra] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repo || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) return null;
  if (!section) return { provider: "github", kind: "repo", owner, repo, url: url.href };
  if ((section === "issues" || section === "pull") && number && /^\d+$/.test(number) && (section === "pull" || !extra)) {
    return { provider: "github", kind: "issue", owner, repo, number, url: url.href };
  }
  return null;
};

const parseSlack = (url: URL): ConnectedLink | null => {
  const match = /^\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})\/?$/.exec(url.pathname);
  if (!match) return null;
  const threadTs = url.searchParams.get("thread_ts");
  return {
    provider: "slack",
    channel: match[1],
    ts: `${match[2]}.${match[3]}`,
    threadTs: threadTs && /^\d+\.\d+$/.test(threadTs) ? threadTs : null,
    url: url.href,
  };
};

const parseDrive = (url: URL): ConnectedLink | null => {
  const parts = url.pathname.split("/").filter(Boolean);
  // Workspace accounts get /a/<domain>/ in front of the usual path.
  const path = parts[0] === "a" ? parts.slice(2) : parts;
  let fileId: string | null = null;
  if (url.hostname === "drive.google.com") {
    if (path[0] === "file" && path[1] === "d") fileId = path[2] ?? null;
    else if (path[0] === "open") fileId = url.searchParams.get("id");
  } else if (DOCS_APPS.has(path[0] ?? "") && path[1] === "d") {
    fileId = path[2] ?? null;
  }
  return fileId && /^[\w-]+$/.test(fileId) ? { provider: "drive", fileId, url: url.href } : null;
};

/** Recognises GitHub, Slack and Google Drive links. Anything else, or a non-https address, is null. */
export const parseConnectedLink = (raw: string): ConnectedLink | null => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.hostname === "github.com") return parseGitHub(url);
  if (url.hostname.endsWith(".slack.com")) return parseSlack(url);
  if (url.hostname === "drive.google.com" || url.hostname === "docs.google.com") return parseDrive(url);
  return null;
};
