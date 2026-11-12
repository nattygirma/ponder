import { z } from "zod";
import type { DatabaseOptionColor, DatabasePropertyType } from "./database";

/**
 * Notion's GitHub "Database sync": a one-way copy of a repository's pull requests and issues into a
 * database whose GitHub properties are read only. People add their own properties beside them.
 */

export const DATABASE_SYNC_PROVIDERS = ["github"] as const;
export type DatabaseSyncProvider = (typeof DATABASE_SYNC_PROVIDERS)[number];

export const GITHUB_SYNC_KINDS = ["pull_requests", "issues"] as const;
export type GitHubSyncKind = (typeof GITHUB_SYNC_KINDS)[number];

/** Notion's history choices: all, or the last 30, 90 or 365 days of Updated At. */
export const GITHUB_SYNC_HISTORY = ["all", "30", "90", "365"] as const;
export type GitHubSyncHistory = (typeof GITHUB_SYNC_HISTORY)[number];

export const GITHUB_SYNC_REPOSITORY_LIMIT = 10;
/** Notion checks GitHub "regularly"; Ponder checks every 15 minutes, on the 5-minute cron. */
export const GITHUB_SYNC_INTERVAL_MINUTES = 15;

/** owner/repo, as GitHub allows them. */
export const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export type GitHubSyncField =
  | "title" | "number" | "state" | "kind" | "repository" | "author" | "assignees" | "labels"
  | "base_branch" | "head_branch" | "created_at" | "updated_at" | "closed_at" | "merged_at" | "url" | "description";

/** The synced properties, in Notion's order and with Notion's names. The title keeps Ponder's fixed id. */
export const GITHUB_SYNC_PROPERTIES: readonly { field: GitHubSyncField; id: string; name: string; type: DatabasePropertyType }[] = [
  { field: "title", id: "title", name: "Title", type: "title" },
  { field: "number", id: "gh_number", name: "Number", type: "number" },
  { field: "state", id: "gh_state", name: "State", type: "select" },
  { field: "kind", id: "gh_kind", name: "Type", type: "select" },
  { field: "repository", id: "gh_repository", name: "Repository", type: "select" },
  { field: "author", id: "gh_author", name: "Author (GitHub)", type: "text" },
  { field: "assignees", id: "gh_assignees", name: "Assignees", type: "multi_select" },
  { field: "labels", id: "gh_labels", name: "Labels", type: "multi_select" },
  { field: "base_branch", id: "gh_base_branch", name: "Base Branch", type: "text" },
  { field: "head_branch", id: "gh_head_branch", name: "Head Branch", type: "text" },
  { field: "created_at", id: "gh_created_at", name: "Created At", type: "date" },
  { field: "updated_at", id: "gh_updated_at", name: "Updated At", type: "date" },
  { field: "closed_at", id: "gh_closed_at", name: "Closed At", type: "date" },
  { field: "merged_at", id: "gh_merged_at", name: "Merged At", type: "date" },
  { field: "url", id: "gh_url", name: "GitHub URL", type: "url" },
  { field: "description", id: "gh_description", name: "Description", type: "text" },
];

/** Notion's four pull request states, plus the two an issue has. */
export const GITHUB_STATE_OPTIONS: readonly { id: string; name: string; color: DatabaseOptionColor }[] = [
  { id: "open", name: "Open", color: "green" },
  { id: "draft", name: "Draft", color: "gray" },
  { id: "merged", name: "Merged", color: "purple" },
  { id: "closed", name: "Closed", color: "red" },
];

export const GITHUB_KIND_OPTIONS: readonly { id: string; name: string; color: DatabaseOptionColor }[] = [
  { id: "pull_request", name: "Pull request", color: "blue" },
  { id: "issue", name: "Issue", color: "orange" },
];

export const SyncedPropertySchema = z.object({
  provider: z.enum(DATABASE_SYNC_PROVIDERS),
  field: z.string().min(1).max(40),
});

export const DatabaseSyncCreateSchema = z.object({
  connectionId: z.string().trim().min(1).max(200),
  repositories: z.array(z.string().trim().regex(GITHUB_REPOSITORY_PATTERN)).min(1).max(GITHUB_SYNC_REPOSITORY_LIMIT),
  include: z.array(z.enum(GITHUB_SYNC_KINDS)).min(1).max(2),
  history: z.enum(GITHUB_SYNC_HISTORY).default("all"),
  name: z.string().trim().max(160).optional(),
  notebookId: z.string().trim().min(1).max(200).optional(),
});
export type DatabaseSyncCreateInput = z.infer<typeof DatabaseSyncCreateSchema>;

export const DatabaseSyncUpdateSchema = z.object({
  repositories: z.array(z.string().trim().regex(GITHUB_REPOSITORY_PATTERN)).min(1).max(GITHUB_SYNC_REPOSITORY_LIMIT).optional(),
  include: z.array(z.enum(GITHUB_SYNC_KINDS)).min(1).max(2).optional(),
  history: z.enum(GITHUB_SYNC_HISTORY).optional(),
  /** Notion's "Pause sync" and "Resume sync". */
  paused: z.boolean().optional(),
}).refine((input) => Object.values(input).some((value) => value !== undefined), { message: "Nothing to update" });
export type DatabaseSyncUpdateInput = z.infer<typeof DatabaseSyncUpdateSchema>;

/** What went wrong on the last run, in words the owner can act on. */
export const DATABASE_SYNC_ERROR_CODES = ["connection_lost", "repository_unavailable", "rate_limited", "unavailable", "database_full"] as const;
export type DatabaseSyncErrorCode = (typeof DATABASE_SYNC_ERROR_CODES)[number];

export type DatabaseSyncInfo = {
  databaseId: string;
  provider: DatabaseSyncProvider;
  /** The database's title, for lists of syncs. */
  name: string;
  connectionId: string;
  /** The GitHub login the sync reads with. */
  accountName: string;
  repositories: string[];
  include: GitHubSyncKind[];
  history: GitHubSyncHistory;
  paused: boolean;
  /** "importing" until the first full pass has finished. */
  state: "importing" | "synced" | "paused" | "error";
  lastSyncedAt: string | null;
  lastError: { code: DatabaseSyncErrorCode; message: string } | null;
  nextRunAt: string | null;
  itemCount: number;
  createdAt: string;
};
