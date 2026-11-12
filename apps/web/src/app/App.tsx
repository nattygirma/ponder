import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { PwaUpdateNotice } from "@/components/PwaUpdateNotice";
import { PwaInstallProvider } from "@/components/PwaInstallContext";
import { PwaIosPrompt } from "@/components/PwaIosPrompt";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  api,
  clearCachedDesktopSession,
  getConfiguredDesktopApiBaseUrl,
  getWorkspaceSession,
} from "@/lib/api";
import { classifyLoginError, getLoginProblemMessageKey } from "@/lib/login-error";
import { EVERNOTE_MIGRATION_PATH } from "@/lib/routes";
import { syncPublishedNoteBodyFont } from "@/lib/published-note-body-font";
import { getNoteWindowMemoId } from "@/lib/desktop-note-windows";
import type { AuthSession } from "@ponder/shared";

const EvernoteImportGuidePane = lazy(() =>
  import("@/components/EvernoteImportGuidePane").then((module) => ({ default: module.EvernoteImportGuidePane }))
);
const WorkspaceApp = lazy(() => import("@/components/WorkspaceApp").then((module) => ({ default: module.WorkspaceApp })));
const PublicNotebookSharePage = lazy(() => import("@/components/PublicNotebookSharePage").then(module => ({ default: module.PublicNotebookSharePage })));
const PublicSharePage = lazy(() => import("@/components/PublicSharePage").then((module) => ({ default: module.PublicSharePage })));
const PublicDatabaseFormPage = lazy(() => import("@/components/PublicDatabaseFormPage").then((module) => ({ default: module.PublicDatabaseFormPage })));
const PublicTableFormPage = lazy(() => import("@/components/PublicTableFormPage").then((module) => ({ default: module.PublicTableFormPage })));
const NoteWindowApp = lazy(() => import("@/components/NoteWindowApp").then((module) => ({ default: module.NoteWindowApp })));
const NotebookSiteManagementPage = lazy(() => import("@/components/NotebookSiteManagementPage").then((module) => ({ default: module.NotebookSiteManagementPage })));

const AuthLoadingScreen = ({ title = "Ponder", detail }: { title?: string; detail?: string }) => (
  <div className="flex h-[100dvh] items-center justify-center bg-slate-50 px-6 text-center text-slate-700">
    <div role="status" aria-live="polite">
      <div className="text-sm font-semibold">{title}</div>
      {detail && <div className="mt-2 text-xs text-slate-500">{detail}</div>}
    </div>
  </div>
);

const EvernoteMigrationRoute = () => {
  const navigate = useNavigate();

  return (
    <Suspense fallback={<AuthLoadingScreen />}>
      <EvernoteImportGuidePane
        onClose={() => {
          if (window.opener) {
            window.close();
            return;
          }

          navigate("/");
        }}
      />
    </Suspense>
  );
};

const AuthenticatedWorkspace = ({ siteManagement = false }: { siteManagement?: boolean }) => {
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const desktopBridge = window.ponderDesktop;
  const [desktopScopeReady, setDesktopScopeReady] = useState(() => !desktopBridge?.isAvailable);
  const [desktopScopeError, setDesktopScopeError] = useState<Error | null>(null);
  const [desktopScopeAttempt, setDesktopScopeAttempt] = useState(0);
  const configuredDesktopApiBaseUrl = getConfiguredDesktopApiBaseUrl();

  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: getWorkspaceSession,
    enabled: !desktopBridge?.isAvailable || Boolean(configuredDesktopApiBaseUrl),
    retry: false,
  });

  const desktopAccountId = sessionQuery.data?.authenticated ? sessionQuery.data.user?.id ?? null : null;

  useEffect(() => {
    if (!desktopAccountId) return;
    void syncPublishedNoteBodyFont();
  }, [desktopAccountId]);

  useEffect(() => {
    if (!desktopBridge?.isAvailable || sessionQuery.isLoading) return;
    let active = true;
    setDesktopScopeReady(false);
    setDesktopScopeError(null);
    void desktopBridge.setAccountScope(desktopAccountId).then(
      () => {
        if (active) setDesktopScopeReady(true);
      },
      (error) => {
        console.error("Failed to switch desktop account scope", error);
        if (active) setDesktopScopeError(error instanceof Error ? error : new Error(String(error)));
      },
    );
    return () => {
      active = false;
    };
  }, [desktopAccountId, desktopBridge, desktopScopeAttempt, sessionQuery.isLoading]);

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      clearCachedDesktopSession();
      const platformSignIn = sessionQuery.data?.platformSignIn;
      if (platformSignIn) {
        // The platform sends us back to "/", where a still-valid AppKeep session would sign
        // straight back in. Remember the choice for this tab so we stop at the signed-out screen.
        rememberSignedOut(true);
        window.location.assign(platformSignIn.logoutUrl);
        return;
      }
      queryClient.clear();
      queryClient.setQueryData<AuthSession>(["auth", "session"], {
        authRequired: true,
        authenticated: false,
        demoMode: sessionQuery.data?.demoMode ?? false,
        user: null,
      });
    },
  });

  useEffect(() => {
    const handleUnauthorized = () => {
      const current = queryClient.getQueryData<AuthSession>(["auth", "session"]);
      clearCachedDesktopSession();
      // Keep the observed session query alive so this transition is delivered
      // even when a background request discovers that the session was revoked.
      queryClient.removeQueries({
        predicate: ({ queryKey }) => queryKey[0] !== "auth" || queryKey[1] !== "session",
      });
      queryClient.setQueryData<AuthSession>(["auth", "session"], {
        authRequired: current?.authRequired ?? true,
        authenticated: false,
        demoMode: current?.demoMode ?? false,
        user: null,
        platformSignIn: current?.platformSignIn,
      });
    };

    window.addEventListener("ponder:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("ponder:unauthorized", handleUnauthorized);
  }, [queryClient]);

  const platformLoginUrl = sessionQuery.data && !sessionQuery.data.authenticated
    ? sessionQuery.data.platformSignIn?.loginUrl
    : undefined;
  const justSignedOut = Boolean(platformLoginUrl) && hasSignedOut();
  useEffect(() => {
    if (sessionQuery.data?.authenticated) rememberSignedOut(false);
  }, [sessionQuery.data?.authenticated]);
  useEffect(() => {
    if (!platformLoginUrl || justSignedOut) return;
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`${platformLoginUrl}?next=${encodeURIComponent(next)}`);
  }, [platformLoginUrl, justSignedOut]);

  if (sessionQuery.isLoading) {
    return desktopBridge?.isAvailable
      ? <AuthLoadingScreen title={t("login.desktopStarting")} detail={t("login.desktopStartingDescription")} />
      : <AuthLoadingScreen />;
  }

  const session = sessionQuery.data;
  const problem = sessionQuery.error ? classifyLoginError(sessionQuery.error, "session") : null;
  const sessionError = problem
    ? t(getLoginProblemMessageKey(problem), "status" in problem ? { status: problem.status } : undefined)
    : null;

  if (desktopBridge?.isAvailable && !desktopScopeReady) {
    if (desktopScopeError) {
      return (
        <main className="flex h-[100dvh] items-center justify-center bg-slate-50 px-4 text-slate-900">
          <section className="w-full max-w-md rounded-xl border border-rose-200 bg-card p-6 shadow-sm">
            <p className="text-sm leading-6 text-rose-800">{t("login.desktopScopeUnavailable")}</p>
            <Button className="mt-4" variant="outline" onClick={() => setDesktopScopeAttempt((value) => value + 1)}>
              {t("login.desktopScopeRetry")}
            </Button>
          </section>
        </main>
      );
    }
    return <AuthLoadingScreen title={t("login.desktopPreparingData")} detail={t("login.desktopPreparingDataDescription")} />;
  }

  if (!session?.authenticated) {
    if (session?.platformSignIn && justSignedOut) {
      return (
        <main className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-background px-6 text-center text-slate-900">
          <p className="text-sm">{t("pages.signedOut.title")}</p>
          <Button
            variant="outline"
            onClick={() => {
              rememberSignedOut(false);
              window.location.assign(`${session.platformSignIn!.loginUrl}?next=${encodeURIComponent("/")}`);
            }}
          >
            {t("pages.signedOut.signIn")}
          </Button>
        </main>
      );
    }
    if (session?.platformSignIn) return <AuthLoadingScreen />;
    return (
      <main className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-background px-6 text-center text-slate-900">
        <p className="text-sm">{sessionError ?? t("pages.signedOut.title")}</p>
        <a className="text-sm underline underline-offset-2" href="https://appkeep.io">{t("pages.signedOut.action")}</a>
      </main>
    );
  }

  return (
    <Suspense fallback={<AuthLoadingScreen />}>
      {siteManagement ? <NotebookSiteManagementPage /> : <WorkspaceApp
        authRequired={session.authRequired}
        demoMode={session.demoMode}
        isLoggingOut={logoutMutation.isPending}
        user={session.user}
        onLogout={() => logoutMutation.mutate()}
      />}
    </Suspense>
  );
};

const SIGNED_OUT_KEY = "ponder:signed-out";

const hasSignedOut = () => {
  try {
    return window.sessionStorage.getItem(SIGNED_OUT_KEY) === "1";
  } catch {
    return false;
  }
};

const rememberSignedOut = (signedOut: boolean) => {
  try {
    if (signedOut) window.sessionStorage.setItem(SIGNED_OUT_KEY, "1");
    else window.sessionStorage.removeItem(SIGNED_OUT_KEY);
  } catch {
    // Without storage, signing out simply returns to AppKeep's sign-in.
  }
};

export const App = () => {
  const [noteWindowMemoId] = useState(() => getNoteWindowMemoId());
  useEffect(() => {
    const bridge = window.ponderDesktop;
    const baseUrl = getConfiguredDesktopApiBaseUrl();
    // The main window owns the instance; a note window only edits its note.
    if (bridge?.isAvailable && baseUrl && !noteWindowMemoId) void bridge.setApiBaseUrl(baseUrl);
  }, [noteWindowMemoId]);

  if (noteWindowMemoId) {
    return (
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <Suspense fallback={<AuthLoadingScreen />}>
          <NoteWindowApp memoId={noteWindowMemoId} />
        </Suspense>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <PwaInstallProvider>
        <Routes>
          <Route path="/share/notebook/:token/:memoId?" element={<Suspense fallback={<AuthLoadingScreen />}><PublicNotebookSharePage /></Suspense>} />
          <Route path="/s/:slug/:memoId?" element={<Suspense fallback={<AuthLoadingScreen />}><PublicNotebookSharePage /></Suspense>} />
          <Route path="/share/:token" element={<Suspense fallback={<AuthLoadingScreen />}><PublicSharePage /></Suspense>} />
          <Route path="/form/:token" element={<Suspense fallback={<AuthLoadingScreen />}><PublicTableFormPage /></Suspense>} />
          <Route path="/f/:token" element={<Suspense fallback={<AuthLoadingScreen />}><PublicDatabaseFormPage /></Suspense>} />
          <Route path={EVERNOTE_MIGRATION_PATH} element={<EvernoteMigrationRoute />} />
          <Route path="/" element={<AuthenticatedWorkspace />} />
          <Route path="/settings" element={<AuthenticatedWorkspace />} />
          <Route path="/notebooks/:notebookId/site" element={<AuthenticatedWorkspace siteManagement />} />
          <Route path="/plugins" element={<AuthenticatedWorkspace />} />
          <Route path="/connections" element={<AuthenticatedWorkspace />} />
          <Route path="/plugins/:pluginId" element={<AuthenticatedWorkspace />} />
          <Route path="/templates" element={<AuthenticatedWorkspace />} />
          <Route path="/ai-prompts" element={<AuthenticatedWorkspace />} />
          <Route path="/execution-center" element={<AuthenticatedWorkspace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <PwaUpdateNotice />
        <PwaIosPrompt />
      </PwaInstallProvider>
    </TooltipProvider>
  );
};
