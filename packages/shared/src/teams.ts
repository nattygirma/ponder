import { z } from "zod";

export type TeamRole = "owner" | "member" | "viewer";
export type PageAccessLevel = "none" | "view" | "comment" | "edit";

export type WorkspaceSummary = {
  id: string;
  name: string;
  isPersonal: boolean;
  role: TeamRole;
  active: boolean;
};

export type WorkspaceInvitation = {
  id: string;
  email: string;
  role: "member" | "viewer";
  expiresAt: string;
  createdAt: string;
  /** Present only in the response that created the invitation. */
  url?: string;
};

export type PageShare = { userId: string; level: Exclude<PageAccessLevel, "none"> };

export type PageAccess = {
  level: PageAccessLevel;
  restricted: boolean;
  inheritedFrom: string | null;
  canManage: boolean;
  isTeamWorkspace: boolean;
  shares: PageShare[];
};

export type InvitationPreview = { workspaceName: string; email: string; role: "member" | "viewer" };

export const WorkspaceCreateSchema = z.object({ name: z.string().trim().min(1).max(120) });
export const WorkspaceUpdateSchema = z.object({ name: z.string().trim().min(1).max(120) });
export const MemberUpdateSchema = z.object({ role: z.enum(["owner", "member", "viewer"]) });
export const InvitationCreateSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum(["member", "viewer"]),
});
export const InvitationSignupSchema = z.object({
  username: z.string().trim().min(2).max(64),
  password: z.string().min(8).max(512),
  displayName: z.string().trim().min(1).max(120).optional(),
});
export const PageAccessUpdateSchema = z.object({
  restricted: z.boolean(),
  shares: z.array(z.object({
    userId: z.string().min(1).max(64),
    level: z.enum(["view", "comment", "edit"]),
  })).max(500),
});

export const CollabSyncSchema = z.object({
  clientId: z.string().min(1).max(64),
  cursor: z.number().int().min(0),
  generation: z.number().int().min(1),
  update: z.string().max(4_000_000).optional(),
  awareness: z.string().max(20_000).optional(),
});
export const CollabLeaveSchema = z.object({
  clientId: z.string().min(1).max(64),
  generation: z.number().int().min(1),
  update: z.string().max(4_000_000).optional(),
});
