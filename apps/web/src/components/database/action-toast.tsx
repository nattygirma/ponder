import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { X } from "lucide-react";
import type { ActionOutcome } from "@ponder/shared";

/**
 * The small message a button leaves after it runs, like Notion's "Created 1 page and edited 1 page".
 * It mounts its own root, so a button inside a table cell or an editor block can show it.
 */
type Toast = { id: number; text: string; tone: "info" | "error"; dismissLabel: string };

let root: Root | null = null;
let push: ((toast: Toast) => void) | null = null;
let queued: Toast[] = [];
let counter = 0;

const Toaster = () => {
  const [toasts, setToasts] = useState<Toast[]>(queued);
  useEffect(() => {
    push = (toast) => setToasts((current) => [...current.slice(-2), toast]);
    queued = [];
    return () => { push = null; };
  }, []);
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => setToasts((current) => current.slice(1)), 5000);
    return () => window.clearTimeout(timer);
  }, [toasts]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          data-action-toast
          className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-lg px-3 py-2 text-sm shadow-lg ${toast.tone === "error" ? "bg-red-600 text-white" : "bg-slate-900 text-white"}`}
        >
          <span>{toast.text}</span>
          <button
            type="button"
            aria-label={toast.dismissLabel}
            className="rounded p-0.5 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
};

export const showActionToast = (text: string, options: { tone?: "info" | "error"; dismissLabel: string }) => {
  const toast: Toast = { id: (counter += 1), text, tone: options.tone ?? "info", dismissLabel: options.dismissLabel };
  if (typeof document === "undefined") return;
  if (!root) {
    const host = document.createElement("div");
    host.setAttribute("data-action-toaster", "");
    document.body.appendChild(host);
    root = createRoot(host);
    queued.push(toast);
    root.render(<Toaster />);
    return;
  }
  if (push) push(toast);
  else queued.push(toast);
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Created 1 page and edited 1 page", from what the server says it did. */
export const outcomeText = (outcome: ActionOutcome, t: Translate) => {
  const parts: string[] = [];
  if (outcome.createdPages) parts.push(t("pages.db.button.outcome.created", { count: outcome.createdPages }));
  if (outcome.editedPages) {
    parts.push(t(parts.length ? "pages.db.button.outcome.edited" : "pages.db.button.outcome.editedFirst", { count: outcome.editedPages }));
  }
  if (outcome.notified) parts.push(t("pages.db.button.outcome.notified", { count: outcome.notified }));
  if (outcome.emailed) parts.push(t("pages.db.button.outcome.emailed", { count: outcome.emailed }));
  if (outcome.comments) parts.push(t("pages.db.button.outcome.commented"));
  if (outcome.events) parts.push(t("pages.db.button.outcome.webhook"));
  if (parts.length === 0) return t("pages.db.button.outcome.nothing");
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)!.charAt(0).toLowerCase()}${parts.at(-1)!.slice(1)}`;
};
