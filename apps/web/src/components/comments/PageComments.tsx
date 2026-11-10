import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/core";
import { Check, MessageSquare, RotateCcw, Trash2 } from "lucide-react";
import type { MemoComment, WorkspaceMember } from "@ponder/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { locateQuote, refreshCommentHighlights, type CommentAnchor } from "./CommentHighlights";

const commentsKey = (memoId: string) => ["memo-comments", memoId] as const;
export const MEMBERS_QUERY_KEY = ["workspace-members"] as const;

export const useWorkspaceMembers = (enabled = true) =>
  useQuery({
    queryKey: MEMBERS_QUERY_KEY,
    queryFn: async () => (await api.getWorkspaceMembers()).members,
    enabled,
    staleTime: 60_000,
  });

const memberName = (member: WorkspaceMember) => member.displayName || member.username;

const Composer = ({ placeholder, autoFocus, onSubmit, onCancel }: {
  placeholder: string;
  autoFocus?: boolean;
  onSubmit: (body: string, mentions: string[]) => Promise<unknown>;
  onCancel?: () => void;
}) => {
  const { t } = useTranslation();
  const members = useWorkspaceMembers();
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<WorkspaceMember[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  const matches = query === null
    ? []
    : (members.data ?? []).filter((member) => memberName(member).toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const readMentionQuery = (value: string, caret: number) => {
    const match = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    setQuery(match ? match[1]! : null);
  };

  const pick = (member: WorkspaceMember) => {
    const caret = input.current?.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([^\s@]*)$/, `@${memberName(member)} `);
    setBody(before + body.slice(caret));
    setMentions((current) => (current.some((item) => item.id === member.id) ? current : [...current, member]));
    setQuery(null);
    input.current?.focus();
  };

  const submit = async () => {
    const text = body.trim();
    if (!text || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      // A mention removed from the text before sending shouldn't notify anyone.
      await onSubmit(text, mentions.filter((member) => text.includes(`@${memberName(member)}`)).map((member) => member.id));
      setBody("");
      setMentions([]);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative">
      <Textarea
        ref={input}
        rows={1}
        autoFocus={autoFocus}
        value={body}
        placeholder={placeholder}
        className="min-h-8 resize-none py-1.5 text-sm"
        onChange={(event) => {
          setBody(event.target.value);
          readMentionQuery(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={(event) => {
          if (matches.length > 0 && (event.key === "Enter" || event.key === "Tab")) {
            event.preventDefault();
            pick(matches[0]!);
            return;
          }
          if (event.key === "Escape") {
            setQuery(null);
            if (query === null) onCancel?.();
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {matches.length > 0 ? (
        <div className="absolute z-20 mt-1 w-56 rounded-md border border-slate-200 bg-card p-1 shadow-md" role="listbox" aria-label={t("pages.comments.mentionList")}>
          {matches.map((member) => (
            <button key={member.id} type="button" role="option" aria-selected={false} className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-slate-100" onMouseDown={(event) => event.preventDefault()} onClick={() => pick(member)}>
              {memberName(member)}
            </button>
          ))}
        </div>
      ) : null}
      {failed ? <p className="mt-1 text-xs text-rose-700" role="alert">{t("pages.comments.failed")}</p> : null}
      {body.trim() || onCancel ? (
        <div className="mt-1 flex justify-end gap-1">
          {onCancel ? <Button variant="ghost" size="sm" className="h-7" onClick={onCancel}>{t("pages.comments.cancel")}</Button> : null}
          <Button size="sm" className="h-7" disabled={!body.trim() || saving} onClick={() => void submit()}>{t("pages.comments.send")}</Button>
        </div>
      ) : null}
    </div>
  );
};

const CommentLine = ({ comment, canDelete, onDelete }: { comment: MemoComment; canDelete: boolean; onDelete: () => void }) => {
  const { t, i18n } = useTranslation();
  return (
    <div className="group/comment mt-1.5 first:mt-0">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="font-medium text-slate-900">{comment.authorName}</span>
        <time dateTime={comment.createdAt}>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(comment.createdAt))}</time>
        {canDelete ? (
          <button type="button" className="ml-auto rounded p-0.5 opacity-0 hover:bg-slate-100 focus-visible:opacity-100 group-hover/comment:opacity-100" aria-label={t("pages.comments.delete")} onClick={onDelete}>
            <Trash2 className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
    </div>
  );
};

export type PageCommentsController = {
  startThread: (anchor: { quote: string; occurrence: number }) => void;
  openThread: (threadId: string) => void;
  startPageComment: () => void;
  anchors: CommentAnchor[];
};

export const PageComments = ({ memoId, editor, readOnly, controllerRef }: {
  memoId: string;
  editor: Editor | null;
  readOnly: boolean;
  controllerRef: MutableRefObject<PageCommentsController>;
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const key = commentsKey(memoId);
  const session = useQuery({ queryKey: ["auth-session-viewer"], queryFn: () => api.getSession(), staleTime: 300_000 });
  const viewerId = session.data?.user?.id ?? null;
  const viewerIsOwner = session.data?.user?.role === "owner";
  const comments = useQuery({
    queryKey: key,
    queryFn: async () => (await api.getMemoComments(memoId)).comments,
    staleTime: 15_000,
  });
  const [draft, setDraft] = useState<{ quote: string; occurrence: number } | null>(null);
  const [composing, setComposing] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const threads = useMemo(() => {
    const byThread = new Map<string, MemoComment[]>();
    for (const comment of comments.data ?? []) {
      byThread.set(comment.threadId, [...(byThread.get(comment.threadId) ?? []), comment]);
    }
    return [...byThread.values()].map((items) => ({ root: items[0]!, replies: items.slice(1) }));
  }, [comments.data]);
  // Kept stable because a new list repaints the editor, which renders this again.
  const open = useMemo(() => threads.filter((thread) => !thread.root.resolvedAt), [threads]);
  const resolved = threads.filter((thread) => thread.root.resolvedAt);

  const anchors = useMemo<CommentAnchor[]>(() => open.flatMap(({ root }) => (
    root.quote ? [{ threadId: root.threadId, quote: root.quote, occurrence: root.quoteOccurrence }] : []
  )), [open]);

  useEffect(() => {
    controllerRef.current = {
      anchors,
      startThread: (anchor) => {
        setDraft(anchor);
        setComposing(true);
      },
      startPageComment: () => {
        setDraft(null);
        setComposing(true);
        container.current?.scrollIntoView({ block: "nearest" });
      },
      openThread: (threadId) => {
        setFocused(threadId);
        container.current?.querySelector(`[data-thread="${CSS.escape(threadId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      },
    };
    if (editor && !editor.isDestroyed) refreshCommentHighlights(editor);
  }, [anchors, controllerRef, editor]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const create = (payload: Parameters<typeof api.createMemoComment>[1]) => api.createMemoComment(memoId, payload).then(refresh);
  const remove = useMutation({ mutationFn: (id: string) => api.deleteMemoComment(id), onSuccess: refresh });
  const setResolved = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => api.updateMemoComment(id, { resolved: value }),
    onSuccess: refresh,
  });

  const canDelete = (comment: MemoComment) => viewerIsOwner || (viewerId !== null && comment.authorId === viewerId);

  const renderThread = ({ root, replies }: (typeof threads)[number]) => {
    const gone = Boolean(root.quote && editor && !locateQuote(editor.state.doc, root.quote, root.quoteOccurrence));
    return (
      <section key={root.threadId} data-thread={root.threadId} className={cn("rounded-md border border-slate-200 p-2", focused === root.threadId && "ring-1 ring-slate-400", root.resolvedAt && "opacity-70")}>
        {root.quote ? (
          <blockquote className={cn("mb-1.5 truncate border-l-2 border-amber-400 pl-2 text-xs text-slate-500", gone && "line-through")}>
            {root.quote}
          </blockquote>
        ) : null}
        {gone ? <p className="mb-1 text-xs text-slate-400">{t("pages.comments.quoteGone")}</p> : null}
        {[root, ...replies].map((comment) => <CommentLine key={comment.id} comment={comment} canDelete={canDelete(comment)} onDelete={() => remove.mutate(comment.id)} />)}
        <div className="mt-2 flex items-start gap-1">
          {root.resolvedAt ? null : <div className="min-w-0 flex-1"><Composer placeholder={t("pages.comments.replyPlaceholder")} onSubmit={(body, mentions) => create({ body, mentions, threadId: root.threadId })} /></div>}
          <button
            type="button"
            className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label={root.resolvedAt ? t("pages.comments.reopen") : t("pages.comments.resolve")}
            onClick={() => setResolved.mutate({ id: root.id, value: !root.resolvedAt })}
          >
            {root.resolvedAt ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        </div>
      </section>
    );
  };

  const empty = threads.length === 0 && !composing;
  return (
    <div ref={container} className="group/page-comments mb-3 min-h-6" data-page-comments>
      {empty ? (
        <button type="button" className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-400 opacity-0 hover:bg-slate-100 focus-visible:opacity-100 group-hover/page-comments:opacity-100 max-sm:text-sm max-sm:opacity-100" onClick={() => setComposing(true)}>
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.comments.addPlaceholder")}
        </button>
      ) : null}
      {composing ? (
        <div className="mb-2 rounded-md border border-slate-200 p-2">
          {draft ? <blockquote className="mb-1.5 truncate border-l-2 border-amber-400 pl-2 text-xs text-slate-500">{draft.quote}</blockquote> : null}
          <Composer
            autoFocus
            placeholder={t("pages.comments.addPlaceholder")}
            onCancel={() => { setComposing(false); setDraft(null); }}
            onSubmit={async (body, mentions) => {
              await create({ body, mentions, quote: draft?.quote, quoteOccurrence: draft?.occurrence });
              setComposing(false);
              setDraft(null);
            }}
          />
        </div>
      ) : null}
      {threads.length > 0 && !composing && !readOnly ? (
        <button type="button" className="mb-1 flex items-center gap-1 rounded px-1 py-0.5 text-xs text-slate-500 hover:bg-slate-100" onClick={() => setComposing(true)}>
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />{t("pages.comments.addPlaceholder")}
        </button>
      ) : null}
      <div className="space-y-2">{open.map(renderThread)}</div>
      {resolved.length > 0 ? (
        <button type="button" className="mt-1 text-xs text-slate-400 hover:text-slate-700" onClick={() => setShowResolved((value) => !value)}>
          {showResolved ? t("pages.comments.hideResolved") : t("pages.comments.showResolved", { count: resolved.length })}
        </button>
      ) : null}
      {showResolved ? <div className="mt-2 space-y-2">{resolved.map(renderThread)}</div> : null}
    </div>
  );
};
