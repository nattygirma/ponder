import { z } from "zod";

export type MemoComment = {
  id: string;
  memoId: string;
  threadId: string;
  /** The text the thread is attached to; null for a comment on the whole page. */
  quote: string | null;
  quoteOccurrence: number;
  body: string;
  mentions: string[];
  authorId: string | null;
  authorName: string;
  /** Set on the first comment of a resolved thread. */
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AppNotification = {
  id: string;
  /** "comment" and "edit" come from following a page with Notify me. */
  kind: "mention" | "reply" | "comment" | "edit" | "automation";
  memoId: string;
  notebookId: string | null;
  memoTitle: string | null;
  commentId: string | null;
  actorName: string;
  excerpt: string;
  readAt: string | null;
  createdAt: string;
};

export type WorkspaceMember = {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  role: "owner" | "member" | "viewer";
};

export const CommentCreateSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  threadId: z.string().min(1).max(64).optional(),
  quote: z.string().max(2000).optional(),
  quoteOccurrence: z.number().int().min(0).max(100000).optional(),
  mentions: z.array(z.string().min(1).max(64)).max(50).optional(),
});

export const CommentUpdateSchema = z.object({
  body: z.string().trim().min(1).max(10000).optional(),
  resolved: z.boolean().optional(),
  mentions: z.array(z.string().min(1).max(64)).max(50).optional(),
}).refine((input) => input.body !== undefined || input.resolved !== undefined, { message: "Nothing to update" });

export const NotificationsReadSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).max(100).optional(),
  all: z.boolean().optional(),
}).refine((input) => input.all || (input.ids && input.ids.length > 0), { message: "Nothing to mark" });

/** What Notify me is set to on a page. "default" means replies and mentions only. */
export type PageSubscriptionLevel = "all" | "comments" | "default";

export const PageSubscriptionSchema = z.object({
  level: z.enum(["all", "comments", "default"]),
});

export type PageAnalytics = {
  days: number;
  createdAt: string;
  totalViews: number;
  uniqueViewers: number;
  daily: { day: string; views: number; viewers: number }[];
  viewers: { userId: string; name: string | null; views: number; lastViewedAt: string }[];
  /** Saved versions of the page, newest first. */
  updates: { at: string; name: string | null; system: boolean }[];
};
