import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, type NavigateOptions } from "react-router";
import { MOBILE_EDITOR_RETURN_PARAM } from "@/lib/mobile-editor";

export const WORKSPACE_SETTINGS_PATH = "/settings";
export const WORKSPACE_PLUGINS_PATH = "/plugins";
export const WORKSPACE_CONNECTIONS_PATH = "/connections";
export const WORKSPACE_TEMPLATES_PATH = "/templates";
export const WORKSPACE_AI_PROMPTS_PATH = "/ai-prompts";
export const WORKSPACE_EXECUTION_CENTER_PATH = "/execution-center";
export const WORKSPACE_TRASH_SEARCH = "?view=trash";

export type WorkspaceRouteState = {
  pathname: string;
  search: string;
  isSettings: boolean;
  isPlugins: boolean;
  isConnections: boolean;
  isTemplates: boolean;
  isAiPrompts: boolean;
  isExecutionCenter: boolean;
  isTrash: boolean;
  mobileEditorReturnMemoId: string | null;
};

export const resolveWorkspaceRoute = (pathname: string, search: string): WorkspaceRouteState => ({
  pathname,
  search,
  isSettings: pathname === WORKSPACE_SETTINGS_PATH,
  isPlugins: pathname === WORKSPACE_PLUGINS_PATH || pathname.startsWith(`${WORKSPACE_PLUGINS_PATH}/`),
  isConnections: pathname === WORKSPACE_CONNECTIONS_PATH,
  isTemplates: pathname === WORKSPACE_TEMPLATES_PATH,
  isAiPrompts: pathname === WORKSPACE_AI_PROMPTS_PATH,
  isExecutionCenter: pathname === WORKSPACE_EXECUTION_CENTER_PATH,
  isTrash: pathname === "/" && search === WORKSPACE_TRASH_SEARCH,
  mobileEditorReturnMemoId: new URLSearchParams(search).get(MOBILE_EDITOR_RETURN_PARAM),
});

export const useWorkspaceRoute = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const route = useMemo(
    () => resolveWorkspaceRoute(location.pathname, location.search),
    [location.pathname, location.search],
  );

  const navigateHome = useCallback((options?: NavigateOptions) => {
    if (route.pathname !== "/" || route.search) navigate("/", options);
  }, [navigate, route.pathname, route.search]);

  const navigateTrash = useCallback(() => {
    if (!route.isTrash) navigate(`/${WORKSPACE_TRASH_SEARCH}`);
  }, [navigate, route.isTrash]);

  const navigateSettings = useCallback((tab?: string) => {
    if (tab) navigate(`${WORKSPACE_SETTINGS_PATH}?tab=${encodeURIComponent(tab)}`);
    else if (!route.isSettings) navigate(WORKSPACE_SETTINGS_PATH);
  }, [navigate, route.isSettings]);

  const navigatePlugins = useCallback(() => {
    if (!route.isPlugins) navigate(WORKSPACE_PLUGINS_PATH);
  }, [navigate, route.isPlugins]);

  const navigateConnections = useCallback(() => {
    if (!route.isConnections) navigate(WORKSPACE_CONNECTIONS_PATH);
  }, [navigate, route.isConnections]);

  const navigateTemplates = useCallback(() => {
    if (!route.isTemplates) navigate(WORKSPACE_TEMPLATES_PATH);
  }, [navigate, route.isTemplates]);

  const navigateAiPrompts = useCallback(() => {
    if (!route.isAiPrompts) navigate(WORKSPACE_AI_PROMPTS_PATH);
  }, [navigate, route.isAiPrompts]);

  const navigateExecutionCenter = useCallback(() => {
    if (!route.isExecutionCenter) navigate(WORKSPACE_EXECUTION_CENTER_PATH);
  }, [navigate, route.isExecutionCenter]);

  return {
    route,
    navigateHome,
    navigateSettings,
    navigatePlugins,
    navigateConnections,
    navigateTemplates,
    navigateAiPrompts,
    navigateExecutionCenter,
    navigateTrash,
  };
};
