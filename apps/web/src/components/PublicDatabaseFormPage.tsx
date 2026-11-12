import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { ApiRequestError, api } from "@/lib/api";
import { withEnvironmentTitlePrefix } from "@/lib/environment-title";
import { FormFill } from "@/components/database/FormFill";

const Message = ({ children }: { children: string }) => (
  <div className="grid min-h-[100dvh] place-items-center bg-background px-6 text-center text-base text-slate-600" role="status">{children}</div>
);

/** `/f/<token>`: a database form as a signed-out visitor (or a member) fills it in. No Ponder branding, like Notion Plus. */
export const PublicDatabaseFormPage = () => {
  const { token = "" } = useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const queryKey = ["public-database-form", token] as const;
  const formQuery = useQuery({ queryKey, queryFn: () => api.getPublicDatabaseForm(token), enabled: Boolean(token), retry: false });
  const form = formQuery.data?.form;
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!form || form.passwordRequired) return;
    document.title = withEnvironmentTitlePrefix(form.title || t("pages.form.titlePlaceholder"), {
      development: import.meta.env.DEV,
      profile: __PONDER_DEVELOPMENT_PROFILE__,
    });
  }, [form, t]);

  const unlock = useMutation({
    mutationFn: () => api.unlockPublicDatabaseForm(token, password),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (reason: Error) => setError(reason.message),
  });

  if (formQuery.isLoading) {
    return <div className="grid min-h-[100dvh] place-items-center bg-background"><LoaderCircle className="h-6 w-6 animate-spin text-slate-400" aria-label={t("pages.db.loading")} /></div>;
  }
  if (formQuery.isError || !form) {
    const code = formQuery.error instanceof ApiRequestError ? formQuery.error.code : undefined;
    return <Message>{code === "form_closed" ? t("pages.form.closed") : code === "form_members_only" ? t("pages.form.membersOnly") : t("pages.form.notFound")}</Message>;
  }
  if (form.passwordRequired) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
        <form
          className="w-full max-w-sm space-y-4"
          onSubmit={(event) => { event.preventDefault(); if (password) unlock.mutate(); }}
        >
          <Lock className="h-6 w-6 text-slate-400" aria-hidden="true" />
          <h1 className="text-xl font-semibold text-slate-900">{t("pages.form.passwordTitle")}</h1>
          <input
            type="password"
            autoComplete="off"
            aria-label={t("pages.form.passwordLabel")}
            placeholder={t("pages.form.passwordLabel")}
            className="w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-base outline-none focus-visible:border-[#2383e2] focus-visible:ring-2 focus-visible:ring-[#2383e2]/25"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
          <button type="submit" disabled={!password || unlock.isPending} className="h-10 w-full rounded-md bg-[#2383e2] text-sm font-medium text-white hover:bg-[#0077d4] disabled:opacity-60">
            {t("pages.form.unlock")}
          </button>
        </form>
      </div>
    );
  }
  return (
    <div className="min-h-[100dvh] bg-background">
      <FormFill form={form} token={token} />
    </div>
  );
};
