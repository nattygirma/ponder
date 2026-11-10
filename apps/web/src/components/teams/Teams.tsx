import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, ChevronsUpDown, Lock, Plus, Users } from "lucide-react";
import type { PageAccess, PageShare, TeamRole, WorkspaceInvitation, WorkspaceMember } from "@ponder/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MEMBERS_QUERY_KEY, useWorkspaceMembers } from "@/components/comments/PageComments";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const memberName = (member: WorkspaceMember) => member.displayName || member.username;
const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export const useViewer = () => {
  const session = useQuery({ queryKey: ["auth-session-viewer"], queryFn: () => api.getSession(), staleTime: 300_000 });
  return session.data?.user ?? null;
};

/** Workspaces hold separate data, so switching restarts the app against the new one. */
const reloadInto = async (work: () => Promise<unknown>) => {
  await work();
  window.location.assign("/");
};

const MembersDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const viewer = useViewer();
  const members = useWorkspaceMembers(open);
  const isOwner = viewer?.teamRole === "owner";
  const invitations = useQuery({
    queryKey: ["workspace-invitations"],
    queryFn: async () => (await api.getWorkspaceInvitations()).invitations,
    enabled: open && isOwner,
  });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "viewer">("member");
  const [created, setCreated] = useState<{ invitation: WorkspaceInvitation; emailed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: ["workspace-invitations"] }),
  ]);
  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause, t("pages.teams.genericError")));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t("pages.teams.settings")}</DialogTitle></DialogHeader>
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        {isOwner ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void act(async () => {
                setCreated(await api.createWorkspaceInvitation({ email, role }));
                setEmail("");
              });
            }}
          >
            <Input type="email" required value={email} placeholder={t("pages.teams.invitePlaceholder")} aria-label={t("pages.teams.invite")} onChange={(event) => setEmail(event.target.value)} />
            <Select value={role} onValueChange={(value) => setRole(value as "member" | "viewer")}>
              <SelectTrigger className="w-32" aria-label={t("pages.teams.invite")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{t("pages.teams.roles.member")}</SelectItem>
                <SelectItem value="viewer">{t("pages.teams.roles.viewer")}</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit">{t("pages.teams.send")}</Button>
          </form>
        ) : null}
        {created?.invitation.url ? (
          <div className="rounded-md border border-slate-200 p-2 text-xs">
            <p className="mb-1 text-slate-500">{created.emailed ? t("pages.teams.emailed") : t("pages.teams.linkReady")}</p>
            <code className="block break-all" data-invite-url>{created.invitation.url}</code>
          </div>
        ) : null}
        <h4 className="text-xs font-medium text-slate-500">{t("pages.teams.members")}</h4>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {(members.data ?? []).map((member) => (
            <li key={member.id} className="flex items-center gap-2 text-sm" data-member={member.username}>
              <span className="min-w-0 flex-1 truncate">{memberName(member)}</span>
              {isOwner ? (
                <Select value={member.role} onValueChange={(next) => void act(() => api.updateWorkspaceMember(member.id, next as TeamRole))}>
                  <SelectTrigger className="h-8 w-28" aria-label={memberName(member)}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["owner", "member", "viewer"] as const).map((value) => <SelectItem key={value} value={value}>{t(`pages.teams.roles.${value}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : <span className="text-xs text-slate-500">{t(`pages.teams.roles.${member.role}`)}</span>}
              {member.id === viewer?.id ? (
                <Button variant="ghost" size="sm" onClick={() => void act(async () => { await api.removeWorkspaceMember(member.id); window.location.assign("/"); })}>{t("pages.teams.leave")}</Button>
              ) : isOwner ? (
                <Button variant="ghost" size="sm" onClick={() => void act(() => api.removeWorkspaceMember(member.id))}>{t("pages.teams.remove")}</Button>
              ) : null}
            </li>
          ))}
        </ul>
        {isOwner && (invitations.data?.length ?? 0) > 0 ? (
          <>
            <h4 className="text-xs font-medium text-slate-500">{t("pages.teams.pending")}</h4>
            <ul className="space-y-1">
              {invitations.data!.map((invitation) => (
                <li key={invitation.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{invitation.email}</span>
                  <span className="text-xs text-slate-500">{t(`pages.teams.roles.${invitation.role}`)}</span>
                  <Button variant="ghost" size="sm" onClick={() => void act(() => api.revokeWorkspaceInvitation(invitation.id))}>{t("pages.teams.revoke")}</Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

/** Lets other parts of the sidebar open the members dialog that the switcher owns. */
export const OPEN_MEMBERS_EVENT = "ponder:open-members";

export const WorkspaceSwitcher = ({ placement = "top" }: { placement?: "top" | "bottom" }) => {
  const { t } = useTranslation();
  const viewer = useViewer();
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => (await api.getWorkspaces()).workspaces,
    enabled: Boolean(viewer?.id && viewer.id !== "local"),
    staleTime: 60_000,
  });
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const open = () => setMembersOpen(true);
    window.addEventListener(OPEN_MEMBERS_EVENT, open);
    return () => window.removeEventListener(OPEN_MEMBERS_EVENT, open);
  }, []);
  if (!workspaces.data) return null;
  const active = workspaces.data.find((workspace) => workspace.active);
  const run = (work: () => Promise<unknown>) => {
    setError(null);
    reloadInto(work).catch((cause: unknown) => setError(errorMessage(cause, t("pages.teams.genericError"))));
  };
  return (
    <div className="flex items-center gap-1 px-2 pb-1" data-workspace-switcher>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={t("pages.teams.switcher")} className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-sm hover:bg-slate-50">
            {placement === "bottom" ? (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-200 text-xs font-medium text-slate-700" aria-hidden="true">
                {((active?.isPersonal ? t("pages.teams.personal") : active?.name) ?? "?").slice(0, 1).toUpperCase()}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate font-medium">{active?.isPersonal ? t("pages.teams.personal") : active?.name}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-1" side={placement === "bottom" ? "top" : "bottom"} align="start">
          {workspaces.data.map((workspace) => (
            <button key={workspace.id} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-100" onClick={() => { if (!workspace.active) run(() => api.switchWorkspace(workspace.id)); }}>
              <span className="min-w-0 flex-1 truncate">{workspace.isPersonal ? t("pages.teams.personal") : workspace.name}</span>
              {workspace.active ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            </button>
          ))}
          <div className="mt-1 border-t border-slate-100 pt-1">
            {creating ? (
              <form className="flex gap-1 p-1" onSubmit={(event) => { event.preventDefault(); if (name.trim()) run(() => api.createWorkspace(name.trim())); }}>
                <Input autoFocus className="h-8" value={name} placeholder={t("pages.teams.workspaceName")} aria-label={t("pages.teams.workspaceName")} onChange={(event) => setName(event.target.value)} />
                <Button type="submit" size="sm" className="h-8">{t("pages.teams.create")}</Button>
              </form>
            ) : (
              <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-100" onClick={() => setCreating(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.teams.newWorkspace")}
              </button>
            )}
            {error ? <p className="px-2 py-1 text-xs text-rose-700" role="alert">{error}</p> : null}
          </div>
        </PopoverContent>
      </Popover>
      {active && !active.isPersonal ? (
        <button type="button" aria-label={t("pages.teams.settings")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-50" onClick={() => setMembersOpen(true)}>
          <Users className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      <MembersDialog open={membersOpen} onOpenChange={setMembersOpen} />
    </div>
  );
};

const accessKey = (memoId: string) => ["page-access", memoId] as const;

export const usePageAccess = (memoId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: accessKey(memoId ?? ""),
    queryFn: async () => (await api.getPageAccess(memoId!)).access,
    enabled: Boolean(memoId) && enabled,
    staleTime: 30_000,
  });

export const PageShareButton = ({ memoId, fallback = null }: { memoId: string; fallback?: ReactNode }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const viewer = useViewer();
  const inTeam = Boolean(viewer?.teamRole);
  const access = usePageAccess(memoId, inTeam);
  const members = useWorkspaceMembers(inTeam);
  const [draft, setDraft] = useState<PageAccess | null>(null);
  useEffect(() => { if (access.data) setDraft(access.data); }, [access.data]);
  const save = useMutation({
    mutationFn: (next: { restricted: boolean; shares: PageShare[] }) => api.setPageAccess(memoId, next),
    onSuccess: ({ access: updated }) => {
      queryClient.setQueryData(accessKey(memoId), updated);
      void queryClient.invalidateQueries({ queryKey: ["page-tree"] });
    },
  });
  if (!inTeam || !access.data?.canManage || !draft) return <>{fallback}</>;
  const commit = (restricted: boolean, shares: PageShare[]) => {
    setDraft({ ...draft, restricted, shares });
    save.mutate({ restricted, shares });
  };
  const setLevel = (userId: string, level: PageShare["level"] | "none") => {
    const others = draft.shares.filter((share) => share.userId !== userId);
    commit(draft.restricted, level === "none" ? others : [...others, { userId, level }]);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("flex items-center gap-1 rounded px-1.5 py-1 hover:bg-slate-100")} data-page-share>
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.teams.share")}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2">
        <label className="flex items-center justify-between gap-2 text-sm">
          {t("pages.teams.restrict")}
          <Switch checked={draft.restricted} onCheckedChange={(checked) => commit(checked, draft.shares)} data-page-restrict />
        </label>
        {draft.inheritedFrom && !draft.restricted ? <p className="text-xs text-slate-500">{t("pages.teams.inherited")}</p> : null}
        {save.isError ? <p className="text-xs text-rose-700" role="alert">{t("pages.teams.genericError")}</p> : null}
        {draft.restricted ? (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {(members.data ?? []).map((member) => {
              const share = draft.shares.find((item) => item.userId === member.id);
              return (
                <li key={member.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{memberName(member)}</span>
                  <Select value={share?.level ?? "none"} onValueChange={(level) => setLevel(member.id, level as PageShare["level"] | "none")}>
                    <SelectTrigger className="h-7 w-32" aria-label={memberName(member)}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(["edit", "comment", "view"] as const).map((level) => <SelectItem key={level} value={level}>{t(`pages.teams.levels.${level}`)}</SelectItem>)}
                      <SelectItem value="none">{t("pages.teams.noAccess")}</SelectItem>
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  );
};

export const InvitePage = ({ token }: { token: string }) => {
  const { t } = useTranslation();
  const preview = useQuery({ queryKey: ["invitation", token], queryFn: async () => (await api.previewInvitation(token)).invitation, retry: false });
  const session = useQuery({ queryKey: ["invite-session"], queryFn: () => api.getSession(), retry: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loginUrl = session.data && !session.data.authenticated ? session.data.platformSignIn?.loginUrl : undefined;

  useEffect(() => {
    if (loginUrl) window.location.replace(`${loginUrl}?next=${encodeURIComponent(window.location.pathname)}`);
  }, [loginUrl]);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      window.location.assign("/");
    } catch (cause) {
      setError(errorMessage(cause, t("pages.teams.genericError")));
      setBusy(false);
    }
  };

  const signedIn = Boolean(session.data?.authenticated && session.data.user?.id !== "local");
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-slate-950">
      <div className="w-full max-w-sm space-y-3 rounded-lg border border-slate-200 bg-card p-6" data-invite-page>
        {preview.isError ? <p role="alert">{t("pages.teams.inviteInvalid")}</p> : null}
        {preview.data ? (
          <>
            <h1 className="text-lg font-semibold">{t("pages.teams.joinTitle", { name: preview.data.workspaceName })}</h1>
            <p className="text-sm text-slate-500">{t("pages.teams.joinInvited", { role: t(`pages.teams.roles.${preview.data.role}`), email: preview.data.email })}</p>
            {error ? <p className="text-sm text-rose-700" role="alert">{error}</p> : null}
            {signedIn ? (
              <Button className="w-full" disabled={busy} onClick={() => void run(() => api.acceptInvitation(token))}>{t("pages.teams.joinSignedIn")}</Button>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
};

