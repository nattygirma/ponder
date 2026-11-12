import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileCheck2, LoaderCircle, Paperclip, X } from "lucide-react";
import { DATABASE_FORM_FILE_BYTES, DATABASE_FORM_FILES_PER_QUESTION, type DatabaseFileValue, type PublicDatabaseForm, type PublicFormQuestion } from "@ponder/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Answer = string | boolean | string[] | DatabaseFileValue[];

const emptyAnswer = (question: PublicFormQuestion): Answer => {
  if (question.type === "checkbox") return false;
  if (question.type === "multi_select" || question.type === "files") return [];
  return "";
};

const isMissing = (value: Answer | undefined) =>
  value === undefined || value === "" || value === false || (Array.isArray(value) && value.length === 0);

const inputClass = "w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-base text-slate-900 outline-none placeholder:text-slate-400 focus-visible:border-[#2383e2] focus-visible:ring-2 focus-visible:ring-[#2383e2]/25 dark:border-slate-600";

const Choice = ({ type, checked, label, onToggle }: { type: "radio" | "checkbox"; checked: boolean; label: string; onToggle: () => void }) => (
  <label className="flex min-h-9 cursor-pointer items-center gap-3 text-base text-slate-800">
    <input
      type={type}
      checked={checked}
      onChange={onToggle}
      className={cn("h-[18px] w-[18px] shrink-0 accent-[#2383e2]", type === "checkbox" && "rounded")}
    />
    <span className="min-w-0 break-words">{label}</span>
  </label>
);

/**
 * A form as a visitor fills it in, like Notion's: big title, one question after another,
 * a plain Submit button, and the thank-you screen once it's sent. Used by the public page
 * and by the builder's Preview, which sends real responses as Notion's does.
 */
export const FormFill = ({ form, token, className }: { form: PublicDatabaseForm; token: string; className?: string }) => {
  const { t } = useTranslation();
  const initial = useMemo(() => Object.fromEntries(form.questions.map((question) => [question.id, emptyAnswer(question)])), [form.questions]);
  const [answers, setAnswers] = useState<Record<string, Answer>>(initial);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const honeypot = useRef<HTMLInputElement>(null);

  const set = (id: string, value: Answer) => {
    setAnswers((current) => ({ ...current, [id]: value }));
    if (!isMissing(value)) setMissing((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const upload = async (question: PublicFormQuestion, list: FileList | null) => {
    if (!list?.length) return;
    setUploading(question.id);
    setError(null);
    const current = (answers[question.id] as DatabaseFileValue[] | undefined) ?? [];
    const next = [...current];
    try {
      for (const file of Array.from(list)) {
        if (next.length >= DATABASE_FORM_FILES_PER_QUESTION) break;
        if (file.size > DATABASE_FORM_FILE_BYTES) throw new Error(t("pages.form.fileTooLarge", { name: file.name }));
        const { file: stored } = await api.uploadPublicDatabaseFormFile(token, file);
        next.push(stored);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("pages.form.saveFailed"));
    } finally {
      set(question.id, next);
      setUploading(null);
    }
  };

  const submit = async () => {
    const unanswered = new Set(form.questions.filter((question) => question.required && isMissing(answers[question.id])).map((question) => question.id));
    setMissing(unanswered);
    if (unanswered.size > 0) {
      document.getElementById(`form-question-${[...unanswered][0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSending(true);
    setError(null);
    try {
      const payload = Object.fromEntries(form.questions.map((question) => {
        const value = answers[question.id];
        return [question.id, question.type === "files" && Array.isArray(value) ? (value as DatabaseFileValue[]).map((file) => file.id) : value];
      }));
      await api.submitPublicDatabaseForm(token, payload, honeypot.current?.value ?? "");
      setDone(true);
      // The thank-you screen replaces a long form; start it at the top, as Notion does.
      if (!className) window.scrollTo({ top: 0 });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("pages.form.saveFailed"));
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className={cn("flex min-h-[85dvh] flex-col items-center justify-center px-6 text-center", className)} data-form-confirmation>
        <FileCheck2 className="h-12 w-12 text-slate-400" strokeWidth={1.5} aria-hidden="true" />
        <h1 className="mt-6 text-2xl font-bold text-slate-900">{form.confirmationTitle || t("pages.form.thanks")}</h1>
        <p className="mt-3 max-w-md whitespace-pre-wrap text-base text-slate-700">{form.confirmationMessage || t("pages.form.submitted")}</p>
        {form.submitAnother ? (
          <button
            type="button"
            className="mt-8 h-9 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600"
            onClick={() => { setAnswers(initial); setMissing(new Set()); setDone(false); }}
          >
            {t("pages.form.submitAnother")}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className={cn("mx-auto w-full max-w-[708px] px-4 pb-24 pt-16 sm:px-6 sm:pt-28", className)}
      noValidate
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
      data-form-fill
    >
      <h1 className="break-words text-[2.5rem] font-bold leading-tight text-slate-900">{form.title || t("pages.form.titlePlaceholder")}</h1>
      {form.description ? <p className="mt-3 whitespace-pre-wrap text-base text-slate-800">{form.description}</p> : null}
      {form.respondent ? (
        <p className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-sm text-slate-600">
          {t("pages.form.submittingAs")} <span className="font-medium text-slate-800">{form.respondent.name}</span>
        </p>
      ) : null}
      {/* Hidden from people and screen readers; bots that fill in every field give themselves away. */}
      <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-px w-px opacity-0" />
      <div className="mt-10 space-y-11">
        {form.questions.map((question) => {
          const value = answers[question.id] ?? emptyAnswer(question);
          const invalid = missing.has(question.id);
          const fieldId = `form-answer-${question.id}`;
          return (
            <section key={question.id} id={`form-question-${question.id}`} className="space-y-3" data-form-question={question.type}>
              <div>
                <label id={`${fieldId}-label`} htmlFor={fieldId} className="text-xl font-bold text-slate-900 sm:text-[1.625rem]">
                  {question.label}
                  {question.required ? <span className="ml-0.5 text-slate-400" aria-hidden="true">*</span> : null}
                </label>
                {question.description ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-500">{question.description}</p> : null}
              </div>
              {question.type === "select" || question.type === "status" ? (
                <div role="radiogroup" aria-labelledby={`${fieldId}-label`} aria-required={question.required}>
                  {value ? (
                    <button type="button" className="mb-1 text-sm text-[#2383e2] hover:underline" onClick={() => set(question.id, "")}>{t("pages.form.clearSelection")}</button>
                  ) : null}
                  {(question.options ?? []).map((option) => (
                    <Choice key={option.id} type="radio" checked={value === option.id} label={option.name} onToggle={() => set(question.id, option.id)} />
                  ))}
                </div>
              ) : question.type === "multi_select" ? (
                <div role="group" aria-labelledby={`${fieldId}-label`} aria-required={question.required}>
                  {(question.options ?? []).map((option) => {
                    const picked = Array.isArray(value) && (value as string[]).includes(option.id);
                    return (
                      <Choice
                        key={option.id}
                        type="checkbox"
                        checked={picked}
                        label={option.name}
                        onToggle={() => set(question.id, picked ? (value as string[]).filter((id) => id !== option.id) : [...(value as string[]), option.id])}
                      />
                    );
                  })}
                </div>
              ) : question.type === "checkbox" ? (
                <Choice type="checkbox" checked={value === true} label={t("pages.form.checkboxLabel")} onToggle={() => set(question.id, value !== true)} />
              ) : question.type === "files" ? (
                <div className="space-y-2">
                  {(value as DatabaseFileValue[]).map((file) => (
                    <div key={file.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <Paperclip className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <button
                        type="button"
                        className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                        aria-label={t("pages.form.removeFile", { name: file.name })}
                        onClick={() => set(question.id, (value as DatabaseFileValue[]).filter((item) => item.id !== file.id))}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  {(value as DatabaseFileValue[]).length < DATABASE_FORM_FILES_PER_QUESTION ? (
                    <label className={cn("inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600", uploading === question.id && "pointer-events-none opacity-60")}>
                      {uploading === question.id ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Paperclip className="h-4 w-4" aria-hidden="true" />}
                      {uploading === question.id ? t("pages.form.uploading") : t("pages.form.uploadFile")}
                      <input
                        id={fieldId}
                        type="file"
                        multiple
                        className="sr-only"
                        disabled={uploading === question.id}
                        onChange={(event) => { void upload(question, event.target.files); event.target.value = ""; }}
                      />
                    </label>
                  ) : null}
                  <p className="text-xs text-slate-500">{t("pages.form.fileLimit")}</p>
                </div>
              ) : question.longAnswer ? (
                <textarea
                  id={fieldId}
                  rows={4}
                  className={cn(inputClass, "resize-y")}
                  placeholder={t("pages.form.yourAnswer")}
                  value={value as string}
                  aria-required={question.required}
                  aria-invalid={invalid}
                  onChange={(event) => set(question.id, event.target.value)}
                />
              ) : (
                <input
                  id={fieldId}
                  className={inputClass}
                  type={question.type === "number" ? "number" : question.type === "date" ? "date" : question.type === "email" ? "email" : question.type === "url" ? "url" : question.type === "phone" ? "tel" : "text"}
                  inputMode={question.type === "number" ? "decimal" : undefined}
                  placeholder={question.type === "date" ? undefined : t("pages.form.yourAnswer")}
                  value={value as string}
                  aria-required={question.required}
                  aria-invalid={invalid}
                  onChange={(event) => set(question.id, event.target.value)}
                />
              )}
              {invalid ? <p className="text-sm text-red-600" role="alert">{t("pages.form.requiredError")}</p> : null}
            </section>
          );
        })}
      </div>
      {error ? <p className="mt-8 text-sm text-red-600" role="alert">{error}</p> : null}
      <button
        type="submit"
        className="mt-12 inline-flex h-10 items-center gap-2 rounded-md bg-slate-100 px-4 text-base font-medium text-slate-900 hover:bg-slate-200 disabled:opacity-60"
        disabled={sending || Boolean(uploading)}
      >
        {sending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {sending ? t("pages.form.submitting") : form.submitLabel || t("pages.form.submit")}
      </button>
    </form>
  );
};
