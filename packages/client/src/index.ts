import type { ImportMemosInput, ImportMemosResponse } from "@ponder/shared/note-import/types";
import type { DatabaseSyncCreateInput, DatabaseSyncInfo, DatabaseSyncUpdateInput, LinkPreviewData, NotebookUpdateInput, WebBookmarkData } from "@ponder/shared";
import {
  parsePreparedAiGeneration,
  streamDirectAiGeneration,
} from "./ai-direct-stream";
import { throwIfAborted } from "./abort-signal";

import { createPluginCapabilities } from './plugin-capabilities';
import type {
  CompanionMemory,
  CompanionDiscoverySettings,
  CompanionDiscoverySettingsInput,
  CompanionDiscoveryItem,
  CompanionAction,
  CompanionTurn,
  CompanionTurnInput,
  CompanionTurnResume,
  CompanionEvent,
  CompanionToolExecuteResult,
  ApiToken,
  AuthSession,
  LoginInput,
  LoginDeviceSession,
  InstanceUser,
  CreatedApiToken,
  JsonBackupMemo,
  JsonBackupNotebook,
  JsonBackupAiPrompt,
  JsonBackupPages,
  JsonBackupRevision,
  MemoDetail,
  AppNotification,
  PageAnalytics,
  PageSubscriptionLevel,
  InvitationPreview,
  MemoComment,
  PageAccess,
  PageShare,
  TeamRole,
  WorkspaceInvitation,
  WorkspaceSummary,
  WorkspaceMember,
  PageBacklink,
  PageNode,
  DatabaseDetail,
  DatabasePropertyValue,
  DatabaseRow,
  DatabaseSchema,
  DatabaseTemplate,
  DatabaseView,
  DatabaseViewConfig,
  DatabaseViewType,
  MemoEditSession,
  MemoRevision,
  MemoSummary,
  MemoShare,
  NotebookShare,
  PublicNotebookShare,
  NotebookSiteUpdate,
  NotebookSiteSearchResult,
  NotebookSiteExclusions,
  NotebookSiteContents,
  MemoNotebookSite,
  NotebookSiteMemoPreview,
  ManagedMemoShare,
  PublicTableForm,
  TableFormSettings,
  TableFormUpdateInput,
  MemoTemplate,
  ScheduledTask,
  ScheduledTaskRun,
  WorkspaceExtension,
  WorkspaceExtensionUpsertInput,
  Notebook,
  Resource,
  ResourceListItem,
  ResourceStorageSummary,
  ObjectStorageSettings,
  AccountNoteProse,
  NoteProsePatch,
  PublicMemoShare,
  TagSummary,
  TiptapDoc,
  AiSettings,
  AiTranscriptionSettings,
  AiProvider,
  AiTranscriptionStandard,
  AiPromptTemplate,
  AiPromptTemplateCreateInput,
  AiPromptTemplateUpdateInput,
  AiStreamEvent,
  AiGenerateInput,
  InfographicAgentEvent,
  InfographicAgentRequest,
  AiTagSuggestionsRequestInput,
  SyncBootstrapResponse,
  SyncChange,
  SyncChangesResponse,
  DeploymentMetadata,
  PluginAiGenerateRequest,
  PluginPublicFetchRequest,
  PluginPublicFetchResponse,
  ActionOutcome,
  AutomationAction,
  AutomationRun,
  AutomationTrigger,
  DatabaseAutomation,
  DatabaseFileValue,
  DatabaseForm,
  DatabaseFormUpdate,
  PublicDatabaseForm,
} from "@ponder/shared";


/** A synced block as one copy sees it; content and pages are empty when the original is out of reach. */
export type SyncedBlockView = {
  id: string;
  sourceMemoId: string;
  canRead: boolean;
  canEdit: boolean;
  generation: number;
  version: number;
  state: string | null;
  pages: Array<{ memoId: string; title: string; isOriginal: boolean }>;
  pageCount: number;
};
export type SyncedBlockSyncResult =
  | { reset: true; generation: number; version: number; state: string; canEdit: boolean }
  | { reset?: false; generation: number; version: number; update: string | null; canEdit: boolean };

type DatabaseTemplateInput = Partial<Pick<DatabaseTemplate, "name" | "icon" | "title" | "properties" | "content" | "isDefault" | "position" | "repeat">>;
type AutomationInput = { name?: string; enabled?: boolean; trigger?: AutomationTrigger; actions?: AutomationAction[] };
/** The browser's time zone, so "today" in a button's action is the clicker's today. */
const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export const MAX_SINGLE_REQUEST_UPLOAD_BYTES = 5 * 1024 * 1024;

export type PonderClientRequestContext = {
  path: string;
  token?: string;
};

export type PonderClientOptions = {
  baseUrl?: string | (() => string);
  token?: string | null | (() => string | null | undefined);
  fetch?: typeof fetch;
  /** @deprecated All AI generation now uses client-direct transport. */
  directAiGeneration?: boolean;
  /** @deprecated Use allowAiServerFallback for browser transports. */
  tryDirectAiGeneration?: boolean;
  /** Web only: retry initial network/CORS failures through the instance. */
  allowAiServerFallback?: boolean;
  /** Used only for the model provider request; defaults to `fetch`. */
  providerFetch?: typeof fetch;
  beforeRequest?: (context: PonderClientRequestContext) => void | Promise<void>;
  shouldAttachToken?: (path: string) => boolean;
  onUnauthorized?: (context: PonderClientRequestContext) => void | Promise<void>;
};

export type MultipartResourceUploadSource = {
  filename: string;
  mimeType: string;
  byteSize: number;
  readPart: (start: number, end: number) => Promise<Blob | Uint8Array<ArrayBuffer>>;
  /** Importers use this to distinguish an uncertain commit from a failed part. */
  onBeforeComplete?: () => void | Promise<void>;
  onPartUploaded?: (byteSize: number) => void;
};

export type InstanceHealth = {
  ok: true;
  name: string;
  runtime?: string | null;
  containerImageSource?: "official-ghcr" | "official-cn-mirror" | "custom" | "unknown" | string | null;
  authMode?: string | null;
  build?: string | null;
  deployment?: DeploymentMetadata | null;
  deploymentVersionCreatedAt?: string | null;
  /** Self-hosted images only: when the container image was built. */
  buildCreatedAt?: string | null;
  /** Self-hosted images only: how the container image was built, not how it was deployed. */
  buildProvenance?: DeploymentMetadata | null;
  migration?: string | null;
  storage?: {
    database?: "d1" | "sqlite" | string | null;
    resources?: "r2" | "filesystem" | "s3" | string | null;
  } | null;
  objectStorageProvider?: "builtin" | "s3" | "unknown" | string | null;
};

export type InstanceRelease = {
  version: string;
  changes: Record<string, readonly string[]>;
};

export type MemoFilterMode = "all" | "tagged" | "untagged" | "pinned";
export type MemoSortMode = "updated-desc" | "created-desc" | "title-asc" | "title-desc";

export type ListNotebooksResponse = {
  notebooks: Notebook[];
};

export type ListMemosResponse = {
  memos: MemoSummary[];
  totalCount?: number;
  nextCursor: string | null;
};

export type ListMemoRevisionsResponse = {
  revisions: MemoRevision[];
};

export type ListResourcesResponse = {
  resources: ResourceListItem[];
  summary: ResourceStorageSummary;
};

export type ListTagsResponse = {
  tags: TagSummary[];
};

export type ListApiTokensResponse = {
  apiTokens: ApiToken[];
  availableScopes: string[];
};

export type InstanceStorageUsageResponse = {
  summary: ResourceStorageSummary;
  users: { userId: string; summary: ResourceStorageSummary }[];
};

export type ListUsersResponse = {
  users: InstanceUser[];
};

export type UserResponse = {
  user: InstanceUser;
};

export type ListLoginDeviceSessionsResponse = {
  sessions: LoginDeviceSession[];
};

export type ObjectStorageSettingsResponse = {
  settings: ObjectStorageSettings;
  externalSettings?: ObjectStorageSettings | null;
};

export type MemoResponse = {
  memo: MemoDetail;
};

export type ListTemplatesResponse = {
  templates: MemoTemplate[];
};

export type TemplateResponse = {
  template: MemoTemplate;
};

export type ListScheduledTasksResponse = {
  tasks: ScheduledTask[];
};

export type ListWorkspaceExtensionsResponse = {
  extensions: WorkspaceExtension[];
};

export type WorkspaceExtensionResponse = {
  extension: WorkspaceExtension;
};

export type ScheduledTaskResponse = {
  task: ScheduledTask;
};

export type ScheduledTaskRunResponse = {
  run: ScheduledTaskRun;
};

export type ScheduledTaskRunsResponse = {
  runs: ScheduledTaskRun[];
  totalCount: number;
  nextOffset: number | null;
};

export type ScheduledTaskRunHistoryItem = ScheduledTaskRun & {
  taskName: string;
  pluginId: string;
  ownerPluginId: string | null;
  pluginScheduleKey: string | null;
};

export type ScheduledTaskRunHistoryResponse = {
  runs: ScheduledTaskRunHistoryItem[];
  totalCount: number;
  nextOffset: number | null;
};

export type MemoShareResponse = {
  share: MemoShare | null;
};

export type ListMemoSharesResponse = {
  shares: ManagedMemoShare[];
  nextOffset: number | null;
};

export type PublicMemoShareResponse = {
  share: PublicMemoShare;
};

export type NotebookResponse = {
  notebook: Notebook;
};

export type ResourceResponse = {
  resource: Resource;
};

export type ResourceUploadResponse = {
  upload: {
    id: string;
    resourceId: string;
    partSize: number;
    partCount: number;
    byteSize: number;
    expiresAt: string;
  };
};

export type MarkdownExportPage = {
  memos: MemoDetail[];
  resources: Resource[];
  totalCount?: number;
  nextOffset: number | null;
  nextCursor?: string | null;
};

export type JsonBackupPage = MarkdownExportPage & {
  revisions: JsonBackupRevision[];
};

export type AiProviderCreatePayload = {
  provider: AiProvider;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  isEnabled: boolean;
  initialModelId?: string;
};

export type AiProviderUpdatePayload = {
  provider: AiProvider;
  displayName: string;
  baseUrl: string;
  apiKey?: string;
  isEnabled: boolean;
};

export type AiTranscriptionProviderCreatePayload = {
  provider: AiTranscriptionStandard;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  isEnabled: boolean;
  initialModelId?: string;
};

export type AiTranscriptionProviderUpdatePayload = {
  provider: AiTranscriptionStandard;
  displayName: string;
  baseUrl: string;
  apiKey?: string;
  isEnabled: boolean;
};

/** @deprecated Use SyncBootstrapResponse; kept for mobile source compatibility. */
export type MobileSyncBootstrapPage = SyncBootstrapResponse;

/** @deprecated Use SyncChange; kept for mobile source compatibility. */
export type MobileSyncChange = SyncChange;

/** @deprecated Use SyncChangesResponse; kept for mobile source compatibility. */
export type MobileSyncChangesPage = SyncChangesResponse;

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  responseDiagnostics?: ApiResponseDiagnostics;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
    responseDiagnostics?: ApiResponseDiagnostics,
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.responseDiagnostics = responseDiagnostics;
  }
}

export type ApiResponseDiagnostics = {
  cloudflareMitigated: boolean;
  isPonderApiError: boolean;
  rayId?: string;
};

export type { SyncBootstrapResponse, SyncChangesResponse };

export const createPonderClient = (options: PonderClientOptions = {}) => {
  const getFetch = () => options.fetch ?? globalThis.fetch;
  const providerFetch = (): typeof fetch => async (url, init) => {
    const directFetch = options.providerFetch ?? getFetch();
    if (!options.allowAiServerFallback) return directFetch(url, { ...init, credentials: "omit", redirect: "error" });
    const { fetchAiWithServerFallback } = await import("./ai-provider-relay");
    return fetchAiWithServerFallback(url, init, directFetch, async target => {
      const { response } = await send("/api/v1/ai/provider-relay", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-ponder-ai-target": target.url,
          "x-ponder-ai-method": target.method,
          "x-ponder-ai-headers": JSON.stringify(Object.fromEntries(target.headers)),
        },
        body: target.method === "GET" ? undefined : await target.arrayBuffer(),
        signal: target.signal,
      });
      return response;
    });
  };
  const getBaseUrl = () => normalizeBaseUrl(
    typeof options.baseUrl === "function" ? options.baseUrl() : options.baseUrl,
  );
  const getToken = () => {
    const token = typeof options.token === "function" ? options.token() : options.token;
    return token || undefined;
  };

  const send = async (
    path: string,
    init?: RequestInit,
    requestOptions?: { attachToken?: boolean; setJsonContentType?: boolean },
  ) => {
    const token = getToken();
    const context: PonderClientRequestContext = { path, ...(token ? { token } : {}) };
    await options.beforeRequest?.(context);

    const headers = new Headers(init?.headers);
    const attachToken = requestOptions?.attachToken
      ?? options.shouldAttachToken?.(path)
      ?? true;

    if (token && attachToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    // Writes to Ponder carry the browser's time zone, so an automation they set off
    // ("Set Date to Today") uses the writer's today rather than UTC's.
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD" && !isAbsoluteHttpUrl(path) && !headers.has("x-ponder-time-zone")) {
      headers.set("x-ponder-time-zone", browserTimeZone());
    }

    if (
      requestOptions?.setJsonContentType !== false
      && !(init?.body instanceof FormData)
      && !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }

    const requestUrl = isAbsoluteHttpUrl(path) ? path : `${getBaseUrl()}${path}`;
    const response = await getFetch()(requestUrl, {
      credentials: "include",
      ...init,
      headers,
    });

    return { context, response };
  };

  const throwRequestError = async (
    context: PonderClientRequestContext,
    response: Response,
    fallbackMessage = "Request failed",
  ): Promise<never> => {
    const body = await response.json().catch(() => null);
    const rayId = response.headers.get("cf-ray")?.trim();
    const error =
      body && typeof body === "object" && "error" in body
        ? (body as { error?: { code?: string; message?: string; details?: unknown } }).error
        : undefined;
    const responseDiagnostics: ApiResponseDiagnostics = {
      cloudflareMitigated: response.headers.get("cf-mitigated") === "challenge",
      isPonderApiError: Boolean(error && typeof error === "object"),
      ...(rayId ? { rayId } : {}),
    };

    if (response.status === 401) {
      void options.onUnauthorized?.(context);
    }

    throw new ApiRequestError(
      error?.message || response.statusText || fallbackMessage,
      response.status,
      error?.code,
      error?.details,
      responseDiagnostics,
    );
  };

  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const { context, response } = await send(path, init);

    if (!response.ok) {
      await throwRequestError(context, response);
    }

    return response.json() as Promise<T>;
  };

  const requestPluginPublic = async (input: PluginPublicFetchRequest, signal?: AbortSignal): Promise<PluginPublicFetchResponse> => {
    const { context, response } = await send("/api/v1/plugins/network/fetch", {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    });
    const upstreamStatus = response.headers.get("x-ponder-upstream-status");
    if (!response.ok || !upstreamStatus) await throwRequestError(context, response, "Public network request failed");
    const status = Number(upstreamStatus);
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error("Invalid public network response status");
    const headers: Record<string, string> = {};
    for (const [key, value] of response.headers) {
      const prefix = "x-ponder-upstream-header-";
      if (key.startsWith(prefix)) headers[key.slice(prefix.length)] = value;
    }
    return {
      url: input.url,
      status,
      statusText: decodeURIComponent(response.headers.get("x-ponder-upstream-status-text") ?? ""),
      headers,
      body: await response.arrayBuffer(),
    };
  };

  const requestResourceResponse = async (path: string, init?: RequestInit) => {
    const isAbsolute = isAbsoluteHttpUrl(path);
    const { context, response } = await send(path, init, {
      attachToken: !isAbsolute,
      setJsonContentType: false,
    });
    if (!response.ok) await throwRequestError(context, response, "Resource download failed");
    return response;
  };

  const requestBlob = async (path: string) => (await requestResourceResponse(path)).blob();

  const requestArrayBuffer = async (path: string) => {
    const { context, response } = await send(path, undefined, { setJsonContentType: false });
    if (!response.ok) await throwRequestError(context, response, "Binary download failed");
    return response.arrayBuffer();
  };

  const uploadMemoResourceParts = async (memoId: string, source: MultipartResourceUploadSource) => {
    const filename = source.filename.trim() || "attachment";
    const mimeType = source.mimeType || "application/octet-stream";
    const { upload } = await request<ResourceUploadResponse>(
      `/api/v1/memos/${encodeURIComponent(memoId)}/resource-uploads`,
      {
        method: "POST",
        body: JSON.stringify({ filename, mimeType, byteSize: source.byteSize }),
      },
    );

    try {
      for (let partNumber = 1; partNumber <= upload.partCount; partNumber += 1) {
        const start = (partNumber - 1) * upload.partSize;
        const chunk = await source.readPart(start, Math.min(start + upload.partSize, source.byteSize));
        let attempt = 0;
        while (true) {
          try {
            await request<{ part: { partNumber: number; byteSize: number } }>(
              `/api/v1/resource-uploads/${encodeURIComponent(upload.id)}/parts/${partNumber}`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/octet-stream" },
                body: chunk,
              },
            );
            source.onPartUploaded?.(Math.min(partNumber * upload.partSize, source.byteSize));
            break;
          } catch (error) {
            attempt += 1;
            const retryable = !(error instanceof ApiRequestError)
              || error.status === 408
              || error.status === 429
              || error.status >= 500;
            if (!retryable || attempt >= 3) throw error;
            await new Promise((resolve) => setTimeout(resolve, attempt * 250));
          }
        }
      }
      await source.onBeforeComplete?.();
      return await request<ResourceResponse>(
        `/api/v1/resource-uploads/${encodeURIComponent(upload.id)}/complete`,
        { method: "POST", body: JSON.stringify({}) },
      );
    } catch (error) {
      await request<{ ok: true }>(`/api/v1/resource-uploads/${encodeURIComponent(upload.id)}`, {
        method: "DELETE",
      }).catch(() => undefined);
      throw error;
    }
  };

  const uploadMemoResourceMultipart = (memoId: string, file: Blob) =>
    uploadMemoResourceParts(memoId, {
      filename: "name" in file && typeof file.name === "string" && file.name.trim()
        ? file.name
        : "attachment",
      mimeType: file.type || "application/octet-stream",
      byteSize: file.size,
      readPart: async (start, end) => file.slice(start, end),
    });

  const createResourceMultipartSink = (upload: ResourceUploadResponse["upload"]) => {
    let partNumber = 1;
    let bufferedBytes = 0;
    let receivedBytes = 0;
    let chunks: ArrayBuffer[] = [];
    let closed = false;

    const abort = async () => {
      if (closed) return;
      closed = true;
      chunks = [];
      bufferedBytes = 0;
      await request<{ ok: true }>(`/api/v1/resource-uploads/${encodeURIComponent(upload.id)}`, {
        method: "DELETE",
      }).catch(() => undefined);
    };

    const sendPart = async () => {
      if (bufferedBytes === 0) return;
      const body = new Blob(chunks, { type: "application/octet-stream" });
      const currentPart = partNumber;
      chunks = [];
      bufferedBytes = 0;
      let attempt = 0;
      while (true) {
        try {
          await request<{ part: { partNumber: number; byteSize: number } }>(
            `/api/v1/resource-uploads/${encodeURIComponent(upload.id)}/parts/${currentPart}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body,
            },
          );
          partNumber += 1;
          return;
        } catch (error) {
          attempt += 1;
          const retryable = !(error instanceof ApiRequestError)
            || error.status === 408
            || error.status === 429
            || error.status >= 500;
          if (!retryable || attempt >= 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        }
      }
    };

    return {
      write: async (chunk: Uint8Array) => {
        if (closed) throw new Error("Resource restore upload is closed");
        let offset = 0;
        while (offset < chunk.byteLength) {
          const available = upload.partSize - bufferedBytes;
          const length = Math.min(available, chunk.byteLength - offset);
          const copy = new Uint8Array(length);
          copy.set(chunk.subarray(offset, offset + length));
          chunks.push(copy.buffer);
          bufferedBytes += length;
          receivedBytes += length;
          offset += length;
          if (bufferedBytes === upload.partSize) await sendPart();
        }
      },
      close: async () => {
        if (closed) throw new Error("Resource restore upload is closed");
        if (receivedBytes !== upload.byteSize) {
          await abort();
          throw new Error(`Resource restore size mismatch: expected ${upload.byteSize}, received ${receivedBytes}`);
        }
        try {
          await sendPart();
          const result = await request<ResourceResponse>(
            `/api/v1/resource-uploads/${encodeURIComponent(upload.id)}/complete`,
            { method: "POST", body: JSON.stringify({}) },
          );
          closed = true;
          return result;
        } catch (error) {
          await abort();
          throw error;
        }
      },
      abort,
    };
  };

  const createJsonResourceRestoreSink = async (
    resourceId: string,
    metadata: JsonBackupMemo["resources"][number],
  ) => {
    const { upload } = await request<ResourceUploadResponse>(
      `/api/v1/restores/json/resources/${encodeURIComponent(resourceId)}/uploads`,
      { method: "POST", body: JSON.stringify(metadata) },
    );
    return createResourceMultipartSink(upload);
  };

  const runPreparedCompanion = async (
    prepared: import("@ponder/shared").CompanionPreparedTurn,
    streamOptions: { signal?: AbortSignal; onEvent: (event: CompanionEvent) => void },
  ) => {
    const { streamDirectCompanion } = await import("./companion-direct-stream");
    const turnId = prepared.turn.id;
    await streamDirectCompanion(prepared, {
      fetch: providerFetch(),
      signal: streamOptions.signal,
      onEvent: streamOptions.onEvent,
      executeTool: (body) => request<CompanionToolExecuteResult>(
        `/api/v1/companion/turns/${encodeURIComponent(turnId)}/tools`,
        { method: "POST", body: JSON.stringify(body), signal: streamOptions.signal },
      ),
      checkpoint: (body) => request(
        `/api/v1/companion/turns/${encodeURIComponent(turnId)}/checkpoint`,
        { method: "POST", body: JSON.stringify(body), signal: streamOptions.signal },
      ),
      complete: (body) => request<{ turn: CompanionTurn }>(
        `/api/v1/companion/turns/${encodeURIComponent(turnId)}/complete`,
        { method: "POST", body: JSON.stringify(body), signal: streamOptions.signal },
      ),
    });
  };

  const directAiUnavailable = () => new ApiRequestError(
    "This instance does not support direct AI preparation. Update the instance before using AI.",
    409,
    "ai_direct_unavailable",
  );

  const runCompanionDirect = async (
    preparePath: string,
    payload: unknown,
    streamOptions: { signal?: AbortSignal; onEvent: (event: CompanionEvent) => void },
  ) => {
    throwIfAborted(streamOptions.signal);
    const { context, response } = await send(preparePath, {
      method: "POST", body: JSON.stringify(payload), signal: streamOptions.signal,
    });
    if (response.status === 404 || response.status === 410) throw directAiUnavailable();
    if (!response.ok) await throwRequestError(context, response);
    const { parsePreparedCompanion } = await import("./companion-direct-stream");
    const prepared = parsePreparedCompanion(await response.json());
    if (!prepared) throw new ApiRequestError("The companion prepare response is invalid", 502, "companion_failed");
    await runPreparedCompanion(prepared, streamOptions);
  };

  const runDirectAi = async <T, P>(args: {
    signal?: AbortSignal;
    prepare: () => Promise<P | null>;
    run: (prepared: P) => Promise<T>;
  }): Promise<T> => {
    throwIfAborted(args.signal);
    const prepared = await args.prepare();
    if (prepared == null) throw directAiUnavailable();
    throwIfAborted(args.signal);
    return args.run(prepared);
  };

  const pluginCapabilities = createPluginCapabilities(request, requestPluginPublic);

  return {
    fetchAiProvider: providerFetch(),
    getInstanceHealth: () => request<InstanceHealth>("/api/health"),
    ...pluginCapabilities,
    pluginAi: {
      status: pluginCapabilities.pluginAi.status,
      generate: async (input: PluginAiGenerateRequest & { signal?: AbortSignal }) => {
        const { signal, ...payload } = input;
        return runDirectAi({
          signal,
          prepare: async () => {
            const { context, response } = await send("/api/v1/plugins/ai/generate/prepare", {
              method: "POST", body: JSON.stringify(payload), signal,
            });
            if (response.ok) {
              const { parsePreparedAiText } = await import("./ai-direct-generate");
              const prepared = parsePreparedAiText(await response.json());
              if (!prepared) throw new ApiRequestError("The AI prepare response is invalid", 502, "plugin_ai_failed");
              return prepared;
            }
            if (response.status !== 404) await throwRequestError(context, response);
            return null;
          },
          run: async (prepared) => {
            const { generateDirectAiText } = await import("./ai-direct-generate");
            return { text: await generateDirectAiText(prepared, { fetch: providerFetch(), signal }) };
          },
        });
      },
    },

    getInstanceRelease: () => request<InstanceRelease>("/api/release"),

    getSession: () => request<AuthSession>("/api/v1/auth/session"),

    getPublicNotebookShare: (token: string) =>
      request<{ share: PublicNotebookShare }>(`/api/public/notebook-shares/${encodeURIComponent(token)}`),
    resolveNotebookSite: (slug: string) => request<{ token: string }>(`/api/public/notebook-sites/${encodeURIComponent(slug)}/resolve`),
    searchPublicNotebook: (token: string, input: { q?: string; tag?: string; cursor?: string | null }) => {
      const params = new URLSearchParams();
      if (input.q) params.set("q", input.q);
      if (input.tag) params.set("tag", input.tag);
      if (input.cursor) params.set("cursor", input.cursor);
      return request<NotebookSiteSearchResult>(`/api/public/notebook-shares/${encodeURIComponent(token)}/search?${params}`);
    },
    previewPublicNotebookMemo: (token: string, memoId: string) => request<{ memo: NotebookSiteMemoPreview }>(`/api/public/notebook-shares/${encodeURIComponent(token)}/memos/${encodeURIComponent(memoId)}/preview`),
    updateNotebookSite: (id: string, input: NotebookSiteUpdate) => request<{ share: NotebookShare }>(`/api/v1/notebooks/${encodeURIComponent(id)}/share/site`, { method: "PATCH", body: JSON.stringify(input) }),
    getMemoNotebookSites: (memoId: string) => request<{ sites: MemoNotebookSite[] }>(`/api/v1/memos/${encodeURIComponent(memoId)}/notebook-sites`),
    listNotebookSiteMemos: (id: string, input: { q?: string; visibility?: "all" | "public" | "excluded"; cursor?: string | null; limit?: number }) => {
      const params = new URLSearchParams();
      if (input.q) params.set("q", input.q);
      if (input.visibility) params.set("visibility", input.visibility);
      if (input.cursor) params.set("cursor", input.cursor);
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      return request<NotebookSiteContents>(`/api/v1/notebooks/${encodeURIComponent(id)}/share/memos?${params}`);
    },
    listNotebookSiteExclusions: (id: string, cursor?: string | null) => request<NotebookSiteExclusions>(`/api/v1/notebooks/${encodeURIComponent(id)}/share/excluded-memos${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    setNotebookSiteExclusion: (id: string, memoId: string, excluded: boolean) => request<{ memoId: string; excluded: boolean }>(`/api/v1/notebooks/${encodeURIComponent(id)}/share/memos/${encodeURIComponent(memoId)}`, { method: "PATCH", body: JSON.stringify({ excluded }) }),
    getPublicNotebookMemo: (token: string, memoId: string) =>
      request<{ share: PublicMemoShare; memoUrls: Record<string, string> }>(`/api/public/notebook-shares/${encodeURIComponent(token)}/memos/${encodeURIComponent(memoId)}`),
    unlockPublicNotebookShare: (token: string, password: string) =>
      request<{ ok: true }>(`/api/public/notebook-shares/${encodeURIComponent(token)}/unlock`, { method: "POST", body: JSON.stringify({ password }) }),
    updateNotebookShare: (id: string, input: { passwordProtected: boolean }) =>
      request<{ share: NotebookShare }>(`/api/v1/notebooks/${encodeURIComponent(id)}/share`, { method: "PATCH", body: JSON.stringify(input) }),
    listNotebookShares: () => request<{ shares: NotebookShare[] }>("/api/v1/notebook-shares"),
    getNotebookShare: (id: string) => request<{ share: NotebookShare | null }>(`/api/v1/notebooks/${encodeURIComponent(id)}/share`),
    createNotebookShare: (id: string) => request<{ share: NotebookShare }>(`/api/v1/notebooks/${encodeURIComponent(id)}/share`, { method: "POST" }),
    revokeNotebookShare: (id: string) => request<{ ok: true }>(`/api/v1/notebooks/${encodeURIComponent(id)}/share`, { method: "DELETE" }),

    getPublicMemoShare: (token: string) =>
      request<PublicMemoShareResponse>(`/api/public/shares/${encodeURIComponent(token)}`),

    updatePublishedNoteBodyFont: (bodyFont: PublicMemoShare["bodyFont"]) =>
      request<{ bodyFont: PublicMemoShare["bodyFont"] }>("/api/v1/me/note-body-font", {
        method: "PUT",
        body: JSON.stringify({ bodyFont }),
      }),

    getNoteProse: () => request<AccountNoteProse>("/api/v1/me/note-prose"),

    updateNoteProse: (patch: NoteProsePatch) =>
      request<AccountNoteProse>("/api/v1/me/note-prose", {
        method: "PUT",
        body: JSON.stringify(patch),
      }),

    unlockPublicMemoShare: (token: string, password: string) =>
      request<{ ok: true }>(`/api/public/shares/${encodeURIComponent(token)}/unlock`, {
        method: "POST",
        body: JSON.stringify({ password }),
      }),

    listLoginDeviceSessions: () =>
      request<ListLoginDeviceSessionsResponse>("/api/v1/auth/sessions"),

    revokeLoginDeviceSession: (sessionId: string) =>
      request<{ ok: true }>(`/api/v1/auth/sessions/${sessionId}`, { method: "DELETE" }),

    updateLoginDeviceSession: (sessionId: string, payload: { label: string | null }) =>
      request<{ ok: true }>(`/api/v1/auth/sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),

    revokeOtherLoginDeviceSessions: () =>
      request<{ ok: true }>("/api/v1/auth/sessions", { method: "DELETE" }),

    login: (payload: LoginInput) =>
      request<AuthSession>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    changePassword: (payload: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
      request<{ ok: true }>("/api/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    getObjectStorageSettings: () =>
      request<ObjectStorageSettingsResponse>("/api/v1/instance/object-storage"),

    testObjectStorageConnection: (payload: {
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey?: string;
      forcePathStyle: boolean;
      objectPrefix: string;
    }) => request<{ ok: true }>("/api/v1/instance/object-storage/test", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

    updateObjectStorageSettings: (payload:
      | { provider: "builtin" }
      | {
          provider: "s3";
          displayName: string;
          endpoint: string;
          region: string;
          bucket: string;
          accessKeyId: string;
          secretAccessKey?: string;
          forcePathStyle: boolean;
          objectPrefix: string;
        }) => request<ObjectStorageSettingsResponse>("/api/v1/instance/object-storage", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

    getAiSettings: (locale?: string) => {
      const search = locale ? `?locale=${encodeURIComponent(locale)}` : "";
      return request<AiSettings>(`/api/v1/ai/settings${search}`);
    },

    getAiTranscriptionSettings: () =>
      request<AiTranscriptionSettings>("/api/v1/ai/transcription-settings"),

    createAiTranscriptionProvider: (payload: AiTranscriptionProviderCreatePayload) =>
      request<AiTranscriptionSettings>("/api/v1/ai/transcription-providers", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    updateAiTranscriptionProvider: (providerId: string, payload: AiTranscriptionProviderUpdatePayload) =>
      request<AiTranscriptionSettings>(`/api/v1/ai/transcription-providers/${encodeURIComponent(providerId)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),

    deleteAiTranscriptionProvider: (providerId: string) =>
      request<AiTranscriptionSettings>(`/api/v1/ai/transcription-providers/${encodeURIComponent(providerId)}`, {
        method: "DELETE",
      }),

    addAiTranscriptionModel: (providerId: string, payload: { modelId: string; displayName?: string }) =>
      request<AiTranscriptionSettings>(`/api/v1/ai/transcription-providers/${encodeURIComponent(providerId)}/models`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    deleteAiTranscriptionModel: (providerId: string, modelConfigId: string) =>
      request<AiTranscriptionSettings>(
        `/api/v1/ai/transcription-providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelConfigId)}`,
        { method: "DELETE" },
      ),

    updateDefaultAiTranscriptionModel: (modelConfigId: string | null) =>
      request<AiTranscriptionSettings>("/api/v1/ai/transcription-default-model", {
        method: "PUT",
        body: JSON.stringify({ modelConfigId }),
      }),

    prepareNoteResourceTranscription: (memoId: string, resourceId: string, signal?: AbortSignal) =>
      request<{ baseUrl: string; modelId: string; apiKey: string; resourceId: string; filename: string }>(
        `/api/v1/memos/${encodeURIComponent(memoId)}/resources/${encodeURIComponent(resourceId)}/transcription-target`,
        { method: "POST", signal },
      ),

    getAiTranscriptionDirectCredential: (providerId: string, signal?: AbortSignal) =>
      request<{ apiKey: string }>(
        `/api/v1/ai/transcription-providers/${encodeURIComponent(providerId)}/direct-credential`,
        { method: "POST", signal },
      ),

    createAiProvider: (payload: AiProviderCreatePayload) =>
      request<AiSettings>("/api/v1/ai/providers", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    updateAiProvider: (providerConfigId: string, payload: AiProviderUpdatePayload) =>
      request<AiSettings>(`/api/v1/ai/providers/${encodeURIComponent(providerConfigId)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),

    deleteAiProvider: (providerConfigId: string) =>
      request<AiSettings>(`/api/v1/ai/providers/${encodeURIComponent(providerConfigId)}`, {
        method: "DELETE",
      }),

    testAiProvider: async (providerConfigId: string, payload: { modelId: string; provider?: AiProvider; baseUrl?: string; apiKey?: string }) => {
      const prepared = await request<import("@ponder/shared").AiPreparedTextGeneration>(`/api/v1/ai/providers/${encodeURIComponent(providerConfigId)}/direct-credential`, { method: "POST", body: JSON.stringify(payload) });
      const { generateDirectAiText } = await import("./ai-direct-generate");
      const text = await generateDirectAiText({ ...prepared, system: "Follow the user instruction exactly.", prompt: "Reply with only: OK", maxOutputTokens: 16 }, { fetch: providerFetch(), signal: AbortSignal.timeout(20_000) });
      return { ok: true, response: text.trim() };
    },
    discoverAiProviderModels: async (providerConfigId: string) => {
      const prepared = await request<{ provider: AiProvider; baseUrl: string; apiKey: string }>(`/api/v1/ai/providers/${encodeURIComponent(providerConfigId)}/direct-credential`, { method: "POST", body: "{}" });
      const { discoverAiModels } = await import("./ai-provider-direct");
      return { models: await discoverAiModels(prepared, providerFetch()) };
    },

    addAiModel: (providerConfigId: string, payload: { modelId: string; displayName?: string }) =>
      request<AiSettings>(`/api/v1/ai/providers/${encodeURIComponent(providerConfigId)}/models`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    deleteAiModel: (providerConfigId: string, modelConfigId: string) =>
      request<AiSettings>(`/api/v1/ai/providers/${encodeURIComponent(providerConfigId)}/models/${encodeURIComponent(modelConfigId)}`, {
        method: "DELETE",
      }),

    updateDefaultAiModel: (modelConfigId: string | null) =>
      request<AiSettings>("/api/v1/ai/default-model", {
        method: "PUT",
        body: JSON.stringify({ modelConfigId }),
      }),

    listAiPrompts: (locale?: string) => {
      const search = locale ? `?locale=${encodeURIComponent(locale)}` : "";
      return request<{ prompts: AiPromptTemplate[] }>(`/api/v1/ai/prompts${search}`);
    },

    createAiPrompt: (payload: AiPromptTemplateCreateInput) =>
      request<{ prompt: AiPromptTemplate }>("/api/v1/ai/prompts", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    updateAiPrompt: (
      promptId: string,
      payload: AiPromptTemplateUpdateInput,
    ) =>
      request<{ prompt: AiPromptTemplate }>(`/api/v1/ai/prompts/${encodeURIComponent(promptId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),

    deleteAiPrompt: (promptId: string) =>
      request<{ ok: true }>(`/api/v1/ai/prompts/${encodeURIComponent(promptId)}`, {
        method: "DELETE",
      }),

    restoreDefaultAiPrompts: (locale?: string) => {
      const search = locale ? `?locale=${encodeURIComponent(locale)}` : "";
      return request<{ prompts: AiPromptTemplate[]; restoredCount: number }>(`/api/v1/ai/prompts/restore-defaults${search}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },

    suggestAiTags: (payload: AiTagSuggestionsRequestInput, signal?: AbortSignal) =>
      runDirectAi({
        signal,
        prepare: async () => {
          const { context, response } = await send("/api/v1/ai/tag-suggestions/prepare", {
            method: "POST", body: JSON.stringify(payload), signal,
          });
          if (response.ok) {
            const { parsePreparedTagSuggestions } = await import("./ai-direct-generate");
            const prepared = parsePreparedTagSuggestions(await response.json());
            if (!prepared) throw new ApiRequestError("The AI prepare response is invalid", 502, "ai_tag_suggestions_failed");
            return prepared;
          }
          if (response.status !== 404) await throwRequestError(context, response);
          return null;
        },
        run: async (prepared) => {
          const { generateDirectAiText, suggestionsFromDirectText } = await import("./ai-direct-generate");
          const text = await generateDirectAiText(prepared, { fetch: providerFetch(), signal });
          return { suggestions: suggestionsFromDirectText(text, prepared) };
        },
      }),

    listCompanionMemories: () => request<{ memories: CompanionMemory[] }>("/api/v1/companion/memories"),
    getCompanionDiscoverySettings: () => request<{ settings: CompanionDiscoverySettings }>("/api/v1/companion/discovery/settings"),
    saveCompanionDiscoverySettings: (input: CompanionDiscoverySettingsInput) => request<{ settings: CompanionDiscoverySettings }>("/api/v1/companion/discovery/settings", { method: "PUT", body: JSON.stringify(input) }),
    listCompanionDiscoveries: () => request<{ items: CompanionDiscoveryItem[] }>("/api/v1/companion/discovery"),
    checkCompanionDiscoveries: (locale: string, signal?: AbortSignal) =>
      runDirectAi({
        signal,
        prepare: async () => {
          const { context, response } = await send(
            `/api/v1/companion/discovery/check/prepare?locale=${encodeURIComponent(locale)}`,
            { method: "POST", body: "{}", signal },
          );
          if (response.ok) {
            const { parsePreparedDiscovery } = await import("./ai-direct-generate");
            const prepared = parsePreparedDiscovery(await response.json());
            if (!prepared) throw new ApiRequestError("The companion prepare response is invalid", 502, "companion_failed");
            return prepared;
          }
          if (response.status !== 404) await throwRequestError(context, response);
          return null;
        },
        run: async (prepared) => {
          if (prepared.quiet) return { items: prepared.items };
          const { generateDirectDiscoveryOutput } = await import("./ai-direct-generate");
          const output = await generateDirectDiscoveryOutput(prepared, { fetch: providerFetch(), signal });
          return request<{ items: CompanionDiscoveryItem[] }>("/api/v1/companion/discovery/check/complete", {
            method: "POST", body: JSON.stringify({ turnId: prepared.turnId, output }), signal,
          });
        },
      }),
    acknowledgeCompanionDiscovery: (id: string, dismiss = false) => request<{ ok: true }>(`/api/v1/companion/discovery/${encodeURIComponent(id)}/${dismiss ? "dismiss" : "seen"}`, { method: "POST", body: "{}" }),
    rememberCompanionDiscoveryFeedback: (id: string) => request<{ ok: true }>(`/api/v1/companion/discovery/${encodeURIComponent(id)}/feedback`, { method: "POST", body: "{}" }),
    listCompanionActions: () => request<{ actions: CompanionAction[] }>("/api/v1/companion/actions"),
    applyCompanionAction: (id: string) => request<{ action: CompanionAction }>(`/api/v1/companion/actions/${encodeURIComponent(id)}/apply`, { method: "POST", body: "{}" }),
    dismissCompanionAction: (id: string) => request<{ action: CompanionAction }>(`/api/v1/companion/actions/${encodeURIComponent(id)}/dismiss`, { method: "POST", body: "{}" }),
    saveCompanionMemory: (content: string, sourceTurnId?: string) => request<{ memory: CompanionMemory }>("/api/v1/companion/memories", {
      method: "POST", body: JSON.stringify({ content, sourceTurnId }),
    }),
    updateCompanionMemory: (memory: CompanionMemory, content: string) => request<{ memory: CompanionMemory }>(`/api/v1/companion/memories/${encodeURIComponent(memory.id)}`, {
      method: "PATCH", body: JSON.stringify({ content, version: memory.version }),
    }),
    forgetCompanionMemory: (memory: CompanionMemory) => request<{ ok: true }>(`/api/v1/companion/memories/${encodeURIComponent(memory.id)}?version=${memory.version}`, { method: "DELETE" }),
    listCompanionTurns: () => request<{ turns: CompanionTurn[] }>("/api/v1/companion/turns"),
    getCompanionTurn: (id: string) => request<{ turn: CompanionTurn }>(`/api/v1/companion/turns/${encodeURIComponent(id)}`),
    cancelCompanionTurn: (id: string) => request<{ ok: true }>(`/api/v1/companion/turns/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
    resumeCompanionTurn: async (id: string, payload: CompanionTurnResume = {}, options: { signal?: AbortSignal; onEvent: (event: CompanionEvent) => void }) => {
      await runCompanionDirect(`/api/v1/companion/turns/${encodeURIComponent(id)}/resume/prepare`, payload, options);
    },
    clearCompanionHistory: () => request<{ ok: true }>("/api/v1/companion/history", { method: "DELETE" }),
    uploadCompanionAttachment: (attachment: { filename: string; mediaType: string; base64Data: string }) =>
      request<{ attachment: { id: string; filename: string; mediaType: string; byteLength: number; expiresAt: string } }>(
        "/api/v1/companion/attachments",
        { method: "POST", body: JSON.stringify(attachment) },
      ),
    exportCompanion: () => request<{ version: 2; controls: { useMemory: boolean; learningEnabled: boolean }; exportedAt: string; memories: CompanionMemory[]; turns: CompanionTurn[]; actions: CompanionAction[] }>("/api/v1/companion/export"),
    importCompanionMemories: (memories: { content: string; kind?: "explicit" | "inferred" }[], controls?: { useMemory: boolean; learningEnabled: boolean }) => request<{ memories: CompanionMemory[] }>("/api/v1/companion/import-memories", {
      method: "POST", body: JSON.stringify({ version: 2, memories, controls }),
    }),
    streamCompanion: async (payload: CompanionTurnInput, streamOptions: { signal?: AbortSignal; onEvent: (event: CompanionEvent) => void }) => {
      await runCompanionDirect("/api/v1/companion/turns/prepare", payload, streamOptions);
    },

    streamInfographicAgent: async (payload: InfographicAgentRequest, streamOptions: { signal?: AbortSignal; onEvent: (event: InfographicAgentEvent) => void }) => {
      const prepared = await request<import("@ponder/shared").AiPreparedTextGeneration>("/api/v1/ai/infographic-agent/prepare", {
        method: "POST", body: JSON.stringify(payload), signal: streamOptions.signal,
      });
      const { runInfographicAgent } = await import("./infographic-direct");
      const { createClientAiModel } = await import("./ai-model");
      await runInfographicAgent({ input: payload, model: createClientAiModel({ ...prepared, fetch: providerFetch() }),
        signal: streamOptions.signal ?? new AbortController().signal, onEvent: streamOptions.onEvent });
    },

    streamAiGeneration: async (payload: AiGenerateInput, streamOptions: { signal?: AbortSignal; onEvent: (event: AiStreamEvent) => void }) => {
      throwIfAborted(streamOptions.signal);
      const { context, response } = await send("/api/v1/ai/generate/prepare", {
        method: "POST", body: JSON.stringify(payload), signal: streamOptions.signal,
      });
      if (response.status === 404 || response.status === 410) throw directAiUnavailable();
      if (!response.ok) await throwRequestError(context, response);
      const prepared = parsePreparedAiGeneration(await response.json());
      if (!prepared) throw new ApiRequestError("The AI prepare response is invalid", 502, "ai_generation_failed");
      await streamDirectAiGeneration(prepared, payload.attachments, { fetch: providerFetch(), ...streamOptions });
    },

    listUsers: () => request<ListUsersResponse>("/api/v1/users"),

    getInstanceStorageUsage: () => request<InstanceStorageUsageResponse>("/api/v1/instance/storage-usage"),

    createUser: (payload: { username: string; displayName?: string | null; password: string }) =>
      request<UserResponse>("/api/v1/users", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    updateUser: (userId: string, payload: { displayName?: string | null; password?: string; isDisabled?: boolean }) =>
      request<UserResponse>(`/api/v1/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),

    logout: () =>
      request<{ ok: true }>("/api/v1/auth/logout", {
        method: "POST",
        body: JSON.stringify({}),
      }),

    listNotebooks: () => request<ListNotebooksResponse>("/api/v1/notebooks"),

    getPageTree: () => request<{ pages: PageNode[]; truncated: boolean }>("/api/v1/pages/tree"),

    createPage: (payload: { notebookId?: string; parentId?: string | null; title?: string; icon?: string | null }) =>
      request<{ memo: MemoDetail; page: PageNode }>("/api/v1/pages", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    movePage: (id: string, payload: { notebookId?: string; parentId?: string | null; beforeId?: string | null; afterId?: string | null }) =>
      request<{ page: PageNode }>(`/api/v1/pages/${encodeURIComponent(id)}/move`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    collabLeave: (memoId: string, payload: { clientId: string; generation: number; update?: string }, keepalive = false) =>
      request<{ ok: boolean }>(`/api/v1/pages/${encodeURIComponent(memoId)}/collab/leave`, { method: "POST", body: JSON.stringify(payload), keepalive }),

    updatePageFields: (id: string, payload: { title?: string; tags?: string[]; contentJson?: TiptapDoc; contentMarkdown?: string }) =>
      request<{ page: PageNode }>(`/api/v1/pages/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),

    updatePage: (id: string, payload: { icon?: string | null; cover?: string | null }) =>
      request<{ page: PageNode }>(`/api/v1/pages/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),

    createDatabase: (payload: { notebookId?: string; parentId?: string | null; title?: string }) =>
      request<{ database: DatabaseDetail }>("/api/v1/databases", { method: "POST", body: JSON.stringify(payload) }),

    getDatabase: (id: string) => request<{ database: DatabaseDetail }>(`/api/v1/databases/${encodeURIComponent(id)}`),

    updateDatabase: (id: string, payload: { schema?: DatabaseSchema; title?: string }) =>
      request<{ database: DatabaseDetail }>(`/api/v1/databases/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),

    listDatabaseRows: (id: string, params?: { cursor?: string | null; limit?: number }) => {
      const search = new URLSearchParams();
      if (params?.cursor) search.set("cursor", params.cursor);
      if (params?.limit) search.set("limit", String(params.limit));
      const query = search.toString();
      return request<{ rows: DatabaseRow[]; nextCursor: string | null }>(`/api/v1/databases/${encodeURIComponent(id)}/rows${query ? `?${query}` : ""}`);
    },

    createDatabaseRow: (id: string, payload: { title?: string; properties?: Record<string, DatabasePropertyValue>; templateId?: string }) =>
      request<{ row: DatabaseRow }>(`/api/v1/databases/${encodeURIComponent(id)}/rows`, { method: "POST", body: JSON.stringify(payload) }),

    updateDatabaseRow: (id: string, rowId: string, payload: { title?: string; properties?: Record<string, DatabasePropertyValue>; beforeId?: string | null; afterId?: string | null }) =>
      request<{ row: DatabaseRow }>(`/api/v1/databases/${encodeURIComponent(id)}/rows/${encodeURIComponent(rowId)}`, { method: "PATCH", body: JSON.stringify(payload) }),

    createDatabaseView: (id: string, payload: { name: string; type: DatabaseViewType; config?: DatabaseViewConfig }) =>
      request<{ view: DatabaseView }>(`/api/v1/databases/${encodeURIComponent(id)}/views`, { method: "POST", body: JSON.stringify(payload) }),

    updateDatabaseView: (id: string, viewId: string, payload: { name?: string; type?: DatabaseViewType; config?: DatabaseViewConfig; position?: number }) =>
      request<{ view: DatabaseView }>(`/api/v1/databases/${encodeURIComponent(id)}/views/${encodeURIComponent(viewId)}`, { method: "PATCH", body: JSON.stringify(payload) }),

    deleteDatabaseView: (id: string, viewId: string) =>
      request<{ ok: true }>(`/api/v1/databases/${encodeURIComponent(id)}/views/${encodeURIComponent(viewId)}`, { method: "DELETE" }),

    createDatabaseTemplate: (id: string, payload: DatabaseTemplateInput & { name: string }) =>
      request<{ template: DatabaseTemplate }>(`/api/v1/databases/${encodeURIComponent(id)}/templates`, { method: "POST", body: JSON.stringify(payload) }),

    updateDatabaseTemplate: (id: string, templateId: string, payload: DatabaseTemplateInput) =>
      request<{ template: DatabaseTemplate }>(`/api/v1/databases/${encodeURIComponent(id)}/templates/${encodeURIComponent(templateId)}`, { method: "PATCH", body: JSON.stringify(payload) }),

    deleteDatabaseTemplate: (id: string, templateId: string) =>
      request<{ ok: true }>(`/api/v1/databases/${encodeURIComponent(id)}/templates/${encodeURIComponent(templateId)}`, { method: "DELETE" }),

    getDatabaseForm: (databaseId: string, viewId: string) =>
      request<{ form: DatabaseForm }>(`/api/v1/databases/${encodeURIComponent(databaseId)}/forms/${encodeURIComponent(viewId)}`),

    updateDatabaseForm: (databaseId: string, viewId: string, payload: DatabaseFormUpdate) =>
      request<{ form: DatabaseForm }>(`/api/v1/databases/${encodeURIComponent(databaseId)}/forms/${encodeURIComponent(viewId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),

    listDatabaseAutomations: (id: string) =>
      request<{ automations: DatabaseAutomation[]; email: { sent: number; limit: number | null; available: boolean }; webhooks: boolean }>(
        `/api/v1/databases/${encodeURIComponent(id)}/automations`,
      ),

    createDatabaseAutomation: (id: string, payload: AutomationInput & { name: string; trigger: AutomationTrigger; actions: AutomationAction[] }) =>
      request<{ automation: DatabaseAutomation }>(`/api/v1/databases/${encodeURIComponent(id)}/automations`, { method: "POST", body: JSON.stringify(payload) }),

    updateDatabaseAutomation: (id: string, automationId: string, payload: AutomationInput) =>
      request<{ automation: DatabaseAutomation }>(`/api/v1/databases/${encodeURIComponent(id)}/automations/${encodeURIComponent(automationId)}`, { method: "PATCH", body: JSON.stringify(payload) }),

    deleteDatabaseAutomation: (id: string, automationId: string) =>
      request<{ ok: true }>(`/api/v1/databases/${encodeURIComponent(id)}/automations/${encodeURIComponent(automationId)}`, { method: "DELETE" }),

    listAutomationRuns: (id: string, automationId?: string) =>
      request<{ runs: AutomationRun[] }>(
        `/api/v1/databases/${encodeURIComponent(id)}/automation-runs${automationId ? `?automation=${encodeURIComponent(automationId)}` : ""}`,
      ),

    clickDatabaseButton: (id: string, rowId: string, propertyId: string) =>
      request<{ outcome: ActionOutcome }>(
        `/api/v1/databases/${encodeURIComponent(id)}/rows/${encodeURIComponent(rowId)}/buttons/${encodeURIComponent(propertyId)}`,
        { method: "POST", headers: { "x-ponder-time-zone": browserTimeZone() } },
      ),

    runButtonBlock: (payload: { pageId?: string; actions: AutomationAction[] }) =>
      request<{ outcome: ActionOutcome }>("/api/v1/buttons/run", {
        method: "POST", body: JSON.stringify(payload), headers: { "x-ponder-time-zone": browserTimeZone() },
      }),

    getDatabaseRowContext: (memoId: string) =>
      request<{ context: { database: DatabaseDetail; row: DatabaseRow } | null }>(`/api/v1/memos/${encodeURIComponent(memoId)}/database-row`),

    getWorkspaces: () => request<{ workspaces: WorkspaceSummary[] }>("/api/v1/workspaces"),

    createWorkspace: (name: string) =>
      request<{ id: string }>("/api/v1/workspaces", { method: "POST", body: JSON.stringify({ name }) }),

    switchWorkspace: (id: string) =>
      request<{ ok: true }>(`/api/v1/workspaces/${encodeURIComponent(id)}/switch`, { method: "POST" }),

    renameWorkspace: (name: string) =>
      request<{ ok: true }>("/api/v1/workspace", { method: "PATCH", body: JSON.stringify({ name }) }),

    updateWorkspaceMember: (userId: string, role: TeamRole) =>
      request<{ ok: true }>(`/api/v1/workspace/members/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify({ role }) }),

    removeWorkspaceMember: (userId: string) =>
      request<{ ok: true }>(`/api/v1/workspace/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),

    getWorkspaceInvitations: () => request<{ invitations: WorkspaceInvitation[] }>("/api/v1/workspace/invitations"),

    createWorkspaceInvitation: (payload: { email: string; role: "member" | "viewer" }) =>
      request<{ invitation: WorkspaceInvitation; emailed: boolean }>("/api/v1/workspace/invitations", { method: "POST", body: JSON.stringify(payload) }),

    revokeWorkspaceInvitation: (id: string) =>
      request<{ ok: true }>(`/api/v1/workspace/invitations/${encodeURIComponent(id)}`, { method: "DELETE" }),

    previewInvitation: (token: string) => request<{ invitation: InvitationPreview }>(`/api/public/invitations/${encodeURIComponent(token)}`),

    signUpFromInvitation: (token: string, payload: { username: string; password: string; displayName?: string }) =>
      request<{ workspaceId: string }>(`/api/public/invitations/${encodeURIComponent(token)}/signup`, { method: "POST", body: JSON.stringify(payload) }),

    acceptInvitation: (token: string) =>
      request<{ workspaceId: string }>(`/api/v1/invitations/${encodeURIComponent(token)}/accept`, { method: "POST" }),

    getPageAccess: (id: string) => request<{ access: PageAccess }>(`/api/v1/pages/${encodeURIComponent(id)}/access`),

    setPageAccess: (id: string, payload: { restricted: boolean; shares: PageShare[] }) =>
      request<{ access: PageAccess }>(`/api/v1/pages/${encodeURIComponent(id)}/access`, { method: "PUT", body: JSON.stringify(payload) }),

    collabJoin: (memoId: string) =>
      request<{ state: string; cursor: number; generation: number; canEdit: boolean }>(`/api/v1/pages/${encodeURIComponent(memoId)}/collab/join`, { method: "POST" }),

    collabSync: (memoId: string, payload: { clientId: string; cursor: number; generation: number; update?: string; awareness?: string }) =>
      request<{ updates: string[]; awareness: string[]; cursor: number; peers: number; title: string | null; state?: string; reset?: boolean }>(
        `/api/v1/pages/${encodeURIComponent(memoId)}/collab/sync`, { method: "POST", body: JSON.stringify(payload) },
      ),

    getConnections: () =>
      request<{
        available: boolean;
        canManage: boolean;
        unavailableProviders?: string[] | null;
        accounts: { id: string; provider: string; name: string; status: "active" | "expired"; connectedAt: string }[];
      }>("/api/v1/connections"),

    disconnectConnection: (id: string) =>
      request<{ ok: true }>(`/api/v1/connections/${encodeURIComponent(id)}`, { method: "DELETE" }),

    listDatabaseSyncs: () => request<{ syncs: DatabaseSyncInfo[]; canManage: boolean }>("/api/v1/database-syncs"),

    listGitHubRepositories: (connectionId: string, q = "") =>
      request<{ repositories: { fullName: string; private: boolean; description: string; updatedAt: string | null }[] }>(
        `/api/v1/database-syncs/github/repositories?${new URLSearchParams({ connectionId, q })}`,
      ),

    createDatabaseSync: (payload: Omit<DatabaseSyncCreateInput, "history"> & { history?: DatabaseSyncCreateInput["history"] }) =>
      request<{ database: DatabaseDetail }>("/api/v1/database-syncs", { method: "POST", body: JSON.stringify(payload) }),

    updateDatabaseSync: (databaseId: string, payload: DatabaseSyncUpdateInput) =>
      request<{ sync: DatabaseSyncInfo }>(`/api/v1/databases/${encodeURIComponent(databaseId)}/sync`, { method: "PATCH", body: JSON.stringify(payload) }),

    runDatabaseSync: (databaseId: string) =>
      request<{ outcome: { ok: boolean; created: number; updated: number; removed: number; pending: boolean; error: string | null }; sync: DatabaseSyncInfo }>(
        `/api/v1/databases/${encodeURIComponent(databaseId)}/sync/run`, { method: "POST" },
      ),

    deleteDatabaseSync: (databaseId: string) =>
      request<{ ok: true }>(`/api/v1/databases/${encodeURIComponent(databaseId)}/sync`, { method: "DELETE" }),

    getLinkPreview: (url: string) =>
      request<{ preview: LinkPreviewData | null }>("/api/v1/connections/preview", {
        method: "POST",
        body: JSON.stringify({ url }),
      }),

    /** Title, description, icon and image for Notion's Web bookmark card. */
    getWebBookmark: (url: string) =>
      request<{ bookmark: WebBookmarkData; frameable?: boolean | null }>("/api/v1/web-bookmark", {
        method: "POST",
        body: JSON.stringify({ url }),
      }),

    /** Notion's Synced block (Phase F): create, open, live-edit and unsync. */
    createSyncedBlock: (memoId: string, content?: Record<string, unknown>) =>
      request<{ id: string }>("/api/v1/synced-blocks", { method: "POST", body: JSON.stringify({ memoId, ...(content ? { content } : {}) }) }),
    getSyncedBlock: (id: string, memoId: string | null) =>
      request<{ block: SyncedBlockView }>(`/api/v1/synced-blocks/${encodeURIComponent(id)}${memoId ? `?${new URLSearchParams({ memoId })}` : ""}`),
    syncSyncedBlock: (id: string, input: { memoId: string | null; generation: number; version: number; update?: string; stateVector?: string }, signal?: AbortSignal) =>
      request<SyncedBlockSyncResult>(`/api/v1/synced-blocks/${encodeURIComponent(id)}/sync`, { method: "POST", body: JSON.stringify(input), signal }),
    unsyncAllSyncedBlock: (id: string) =>
      request<{ unsynced: number; skipped: number }>(`/api/v1/synced-blocks/${encodeURIComponent(id)}/unsync-all`, { method: "POST" }),
    expandSyncedMarkdown: (markdown: string) =>
      request<{ markdown: string }>("/api/v1/synced-blocks/expand", { method: "POST", body: JSON.stringify({ markdown }) }),

    searchConnectedApps: (q: string) =>
      request<{ results: { provider: "github"; title: string; subtitle: string; url: string }[] }>(`/api/v1/connections/search?${new URLSearchParams({ q })}`),

    savePageToDrive: (page: { title: string; html: string }) =>
      request<{ url: string }>("/api/v1/connections/drive/pages", {
        method: "POST",
        body: JSON.stringify(page),
      }),

    getCalendar: () =>
      request<{
        feeds: { id: string; label: string; lastError: string | null; connected: boolean }[];
        events: { id: string; title: string; start: string; end: string | null; allDay: boolean; location: string | null }[];
      }>("/api/v1/calendar"),

    connectCalendar: (url: string) =>
      request<{ feed: { id: string; label: string; lastError: string | null } }>("/api/v1/calendar/feeds", { method: "POST", body: JSON.stringify({ url }) }),

    disconnectCalendar: (id: string) =>
      request<{ ok: true }>(`/api/v1/calendar/feeds/${encodeURIComponent(id)}`, { method: "DELETE" }),

    getWorkspaceMembers: () => request<{ members: WorkspaceMember[] }>("/api/v1/workspace/members"),

    getMemoComments: (memoId: string) => request<{ comments: MemoComment[] }>(`/api/v1/memos/${encodeURIComponent(memoId)}/comments`),

    createMemoComment: (memoId: string, payload: { body: string; threadId?: string; quote?: string; quoteOccurrence?: number; mentions?: string[] }) =>
      request<{ comment: MemoComment }>(`/api/v1/memos/${encodeURIComponent(memoId)}/comments`, { method: "POST", body: JSON.stringify(payload) }),

    updateMemoComment: (id: string, payload: { body?: string; resolved?: boolean }) =>
      request<{ comment: MemoComment }>(`/api/v1/comments/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),

    deleteMemoComment: (id: string) => request<{ ok: true }>(`/api/v1/comments/${encodeURIComponent(id)}`, { method: "DELETE" }),

    getNotifications: () => request<{ notifications: AppNotification[]; unread: number }>("/api/v1/notifications"),

    markNotificationsRead: (payload: { ids?: string[]; all?: boolean }) =>
      request<{ ok: true }>("/api/v1/notifications/read", { method: "POST", body: JSON.stringify(payload) }),

    getPageSubscription: (id: string) =>
      request<{ level: PageSubscriptionLevel }>(`/api/v1/pages/${encodeURIComponent(id)}/subscription`),

    setPageSubscription: (id: string, level: PageSubscriptionLevel) =>
      request<{ level: PageSubscriptionLevel }>(`/api/v1/pages/${encodeURIComponent(id)}/subscription`, { method: "PUT", body: JSON.stringify({ level }) }),

    recordPageView: (id: string) =>
      request<{ ok: true }>(`/api/v1/pages/${encodeURIComponent(id)}/views`, { method: "POST" }),

    getPageAnalytics: (id: string) =>
      request<{ analytics: PageAnalytics }>(`/api/v1/pages/${encodeURIComponent(id)}/analytics`),

    getPageBacklinks: (id: string) =>
      request<{ backlinks: PageBacklink[] }>(`/api/v1/pages/${encodeURIComponent(id)}/backlinks`),

    syncBootstrap: (params?: { afterId?: string | null; limit?: number }) => {
      const search = new URLSearchParams();
      if (params?.afterId) {
        search.set("afterId", params.afterId);
        search.set("includeMetadata", "0");
      }
      if (params?.limit) search.set("limit", String(params.limit));
      const suffix = search.toString() ? `?${search.toString()}` : "";
      return request<SyncBootstrapResponse>(`/api/v1/sync/bootstrap${suffix}`);
    },

    syncChanges: (params: { cursor: number; limit?: number }) => {
      const search = new URLSearchParams({ cursor: String(params.cursor) });
      if (params.limit) search.set("limit", String(params.limit));
      return request<SyncChangesResponse>(`/api/v1/sync/changes?${search.toString()}`);
    },

    getMobileSyncBootstrapPage: (afterId: string | null = null, limit = 100) => {
      const search = new URLSearchParams({ limit: String(limit) });
      if (afterId) {
        search.set("afterId", afterId);
        search.set("includeMetadata", "0");
      }
      return request<MobileSyncBootstrapPage>(`/api/v1/sync/bootstrap?${search.toString()}`);
    },

    getMobileSyncChanges: (cursor: number, limit = 100) =>
      request<MobileSyncChangesPage>(`/api/v1/sync/changes?cursor=${cursor}&limit=${limit}`),

    createNotebook: (payload: { name: string; parentId?: string | null }) =>
      request<NotebookResponse>("/api/v1/notebooks", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    updateNotebook: (notebookId: string, payload: NotebookUpdateInput) =>
      request<NotebookResponse>(`/api/v1/notebooks/${notebookId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),

    deleteNotebook: (notebookId: string) =>
      request<{ ok: true }>(`/api/v1/notebooks/${notebookId}`, {
        method: "DELETE",
      }),

    restoreNotebook: (notebookId: string) =>
      request<NotebookResponse>(`/api/v1/notebooks/${notebookId}/restore`, {
        method: "POST",
      }),

    listTags: () => request<ListTagsResponse>("/api/v1/tags"),

    renameTag: (tag: string, name: string) =>
      request<{ ok: true; updated: number }>(`/api/v1/tags/${encodeURIComponent(tag)}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),

    deleteTag: (tag: string) =>
      request<{ ok: true; updated: number }>(`/api/v1/tags/${encodeURIComponent(tag)}`, {
        method: "DELETE",
      }),

    listApiTokens: () => request<ListApiTokensResponse>("/api/v1/api-tokens"),

    createApiToken: (payload: { name: string; scopes: string[]; expiresAt?: string | null }) =>
      request<CreatedApiToken>("/api/v1/api-tokens", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    revokeApiToken: (tokenId: string) =>
      request<{ ok: true }>(`/api/v1/api-tokens/${tokenId}`, {
        method: "DELETE",
      }),

    listMemos: (params: {
      notebookId?: string | null;
      includeTotal?: boolean;
      includeDescendants?: boolean;
      q?: string;
      tag?: string;
      trash?: boolean;
      sort?: MemoSortMode;
      filter?: MemoFilterMode;
      cursor?: string | null;
      limit?: number;
    }) => {
      const search = new URLSearchParams();

      if (params.notebookId) {
        search.set("notebookId", params.notebookId);
      }

      if (params.includeDescendants) {
        search.set("includeDescendants", "1");
      }

      if (params.q?.trim()) {
        search.set("q", params.q.trim());
      }

      if (params.tag?.trim()) {
        search.set("tag", params.tag.trim());
      }

      if (params.trash) {
        search.set("trash", "1");
      }

      if (params.sort) {
        search.set("sort", params.sort);
      }

      if (params.filter && params.filter !== "all") {
        search.set("filter", params.filter);
      }

      if (params.cursor) {
        search.set("cursor", params.cursor);
      }

      if (params.limit) {
        search.set("limit", String(params.limit));
      }

      if (params.includeTotal === false) search.set("includeTotal", "0");
      return request<ListMemosResponse>(`/api/v1/memos?${search.toString()}`);
    },

    getImportCapabilities: () => request<{ protocolVersion: number; maxBatchSize: number; formats: string[]; importContext: string; accountId: string | null }>("/api/v1/imports/capabilities"),

    importMemos: (payload: ImportMemosInput) => request<ImportMemosResponse>("/api/v1/imports/memos", { method: "POST", body: JSON.stringify(payload) }),

    createMemo: (payload: {
      notebookId: string;
      title?: string;
      contentJson?: TiptapDoc;
      contentMarkdown?: string;
      tags?: string[];
      createdAt?: string;
      updatedAt?: string;
    }) =>
      request<MemoResponse>("/api/v1/memos", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    listTemplates: () => request<ListTemplatesResponse>("/api/v1/templates"),

    createTemplate: (payload: {
      name: string;
      description?: string | null;
      memoId?: string;
      title?: string | null;
      contentMarkdown?: string;
      tags?: string[];
    }) => request<TemplateResponse>("/api/v1/templates", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

    updateTemplate: (templateId: string, payload: {
      name?: string;
      description?: string | null;
      title?: string | null;
      contentMarkdown?: string;
      tags?: string[];
    }) => request<TemplateResponse>(`/api/v1/templates/${templateId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

    useTemplate: (templateId: string, notebookId: string, locale?: string) =>
      request<MemoResponse>(`/api/v1/templates/${templateId}/use`, {
        method: "POST",
        body: JSON.stringify(locale ? { notebookId, locale } : { notebookId }),
      }),

    deleteTemplate: (templateId: string) =>
      request<{ ok: true }>(`/api/v1/templates/${templateId}`, { method: "DELETE" }),

    listScheduledTasks: (executorDeviceId?: string) => {
      const search = new URLSearchParams();
      if (executorDeviceId) search.set("executorDeviceId", executorDeviceId);
      const suffix = search.size > 0 ? `?${search.toString()}` : "";
      return request<ListScheduledTasksResponse>(`/api/v1/scheduled-tasks${suffix}`);
    },

    listWorkspaceExtensions: () => request<ListWorkspaceExtensionsResponse>("/api/v1/workspace-extensions"),

    upsertWorkspaceExtension: (extensionId: string, payload: WorkspaceExtensionUpsertInput) =>
      request<WorkspaceExtensionResponse>(
        `/api/v1/workspace-extensions/${encodeURIComponent(extensionId)}`,
        { method: "PUT", body: JSON.stringify(payload) },
      ),

    deleteWorkspaceExtension: (extensionId: string) =>
      request<WorkspaceExtensionResponse>(
        `/api/v1/workspace-extensions/${encodeURIComponent(extensionId)}`,
        { method: "DELETE" },
      ),

    listScheduledTaskRunHistory: (offset = 0, limit = 50) => {
      const search = new URLSearchParams({ offset: String(offset), limit: String(limit) });
      return request<ScheduledTaskRunHistoryResponse>(`/api/v1/scheduled-task-runs?${search.toString()}`);
    },

    listPluginScheduledTasks: (pluginId: string) => request<ListScheduledTasksResponse>(
      `/api/v1/scheduled-tasks/plugin/${encodeURIComponent(pluginId)}`,
    ),

    upsertPluginScheduledTask: (payload: {
      pluginId: string;
      scheduleKey: string;
      name: string;
      commandId: string;
      cronExpression: string;
      timezone: string;
      executorDeviceId: string;
      missedRunPolicy?: "run-once" | "skip";
      isEnabled?: boolean;
    }) => request<ScheduledTaskResponse>("/api/v1/scheduled-tasks/plugin-upsert", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

    deletePluginScheduledTask: (pluginId: string, scheduleKey: string) => request<{ ok: true }>(
      `/api/v1/scheduled-tasks/plugin/${encodeURIComponent(pluginId)}/${encodeURIComponent(scheduleKey)}`,
      { method: "DELETE" },
    ),

    createScheduledTask: (payload: {
      name: string;
      taskType: "plugin-command";
      taskPayload: { pluginId: string; commandId: string };
      cronExpression: string;
      timezone: string;
      executorDeviceId: string;
      missedRunPolicy?: "run-once" | "skip";
      isEnabled?: boolean;
    }) => request<ScheduledTaskResponse>("/api/v1/scheduled-tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

    updateScheduledTask: (taskId: string, payload: {
      name?: string;
      taskPayload?: { pluginId: string; commandId: string };
      cronExpression?: string;
      timezone?: string;
      executorDeviceId?: string;
      missedRunPolicy?: "run-once" | "skip";
      isEnabled?: boolean;
    }) => request<ScheduledTaskResponse>(`/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

    deleteScheduledTask: (taskId: string) => request<{ ok: true }>(
      `/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}`,
      { method: "DELETE" },
    ),

    listScheduledTaskRuns: (taskId: string, offset = 0, limit = 50) => {
      const search = new URLSearchParams({ offset: String(offset), limit: String(limit) });
      return request<ScheduledTaskRunsResponse>(
        `/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}/runs?${search.toString()}`,
      );
    },

    claimScheduledTaskRun: (taskId: string, payload: {
      scheduledFor: string;
      executorDeviceId: string;
    }) => request<ScheduledTaskRunResponse>(
      `/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}/runs/claim`,
      { method: "POST", body: JSON.stringify(payload) },
    ),

    finishScheduledTaskRun: (taskId: string, runId: string, payload: {
      executorDeviceId: string;
      status: "succeeded" | "failed";
      errorMessage?: string | null;
    }) => request<ScheduledTaskRunResponse>(
      `/api/v1/scheduled-tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(runId)}/finish`,
      { method: "POST", body: JSON.stringify(payload) },
    ),

    moveMemos: (payload: { memoIds: string[]; notebookId: string }) =>
      request<{ ok: true; moved: number }>("/api/v1/memos/batch/move", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    deleteMemos: (payload: { memoIds: string[]; permanent?: boolean }) =>
      request<{ ok: true; deleted: number }>("/api/v1/memos/batch/delete", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    emptyTrash: () =>
      request<{ ok: true; deleted: number }>("/api/v1/memos/trash/empty", {
        method: "DELETE",
      }),

    getMemo: (memoId: string, options?: { includeDeleted?: boolean }) => {
      const search = new URLSearchParams();

      if (options?.includeDeleted) {
        search.set("includeDeleted", "1");
      }

      const suffix = search.toString() ? `?${search.toString()}` : "";
      return request<MemoResponse>(`/api/v1/memos/${memoId}${suffix}`);
    },

    getMemoShare: (memoId: string) =>
      request<MemoShareResponse>(`/api/v1/memos/${memoId}/share`),

    listMemoShares: (offset = 0, limit = 50) =>
      request<ListMemoSharesResponse>(`/api/v1/memo-shares?offset=${offset}&limit=${limit}`),

    createMemoShare: (memoId: string) =>
      request<{ share: MemoShare }>(`/api/v1/memos/${memoId}/share`, {
        method: "POST",
        body: JSON.stringify({}),
      }),

    updateMemoShare: (memoId: string, payload: { passwordProtected?: boolean; password?: string; slug?: string | null; showUpdatedAt?: boolean; showBranding?: boolean; expiresAt?: string | null }) =>
      request<{ share: MemoShare }>(`/api/v1/memos/${memoId}/share`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),

    getTableForm: (memoId: string) =>
      request<{ form: TableFormSettings | null }>(`/api/v1/memos/${encodeURIComponent(memoId)}/form`),

    updateTableForm: (memoId: string, payload: TableFormUpdateInput) =>
      request<{ form: TableFormSettings }>(`/api/v1/memos/${encodeURIComponent(memoId)}/form`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),

    getPublicTableForm: (token: string) =>
      request<{ form: PublicTableForm }>(`/api/public/forms/${encodeURIComponent(token)}`),

    unlockPublicTableForm: (token: string, password: string) =>
      request<{ ok: true }>(`/api/public/forms/${encodeURIComponent(token)}/unlock`, {
        method: "POST",
        body: JSON.stringify({ password }),
      }),

    submitPublicTableForm: (token: string, cells: Record<string, unknown>) =>
      request<{ ok: true }>(`/api/public/forms/${encodeURIComponent(token)}/submissions`, {
        method: "POST",
        body: JSON.stringify({ cells }),
      }),

    uploadPublicTableFormFile: (token: string, file: File) => {
      const form = new FormData();
      form.append("file", file, file.name || "attachment");
      return request<{ resource: { id: string; filename: string; mimeType: string; byteSize: number } }>(
        `/api/public/forms/${encodeURIComponent(token)}/resources`,
        { method: "POST", body: form },
      );
    },

    getPublicDatabaseForm: (token: string) =>
      request<{ form: PublicDatabaseForm }>(`/api/public/database-forms/${encodeURIComponent(token)}`),

    unlockPublicDatabaseForm: (token: string, password: string) =>
      request<{ ok: true }>(`/api/public/database-forms/${encodeURIComponent(token)}/unlock`, {
        method: "POST",
        body: JSON.stringify({ password }),
      }),

    submitPublicDatabaseForm: (token: string, answers: Record<string, unknown>, website = "") =>
      request<{ ok: true }>(`/api/public/database-forms/${encodeURIComponent(token)}/responses`, {
        method: "POST",
        body: JSON.stringify({ answers, ...(website ? { website } : {}) }),
      }),

    uploadPublicDatabaseFormFile: (token: string, file: File) => {
      const form = new FormData();
      form.append("file", file, file.name || "file");
      return request<{ file: DatabaseFileValue }>(`/api/public/database-forms/${encodeURIComponent(token)}/files`, { method: "POST", body: form });
    },

    revokeMemoShare: (memoId: string) =>
      request<{ ok: true }>(`/api/v1/memos/${memoId}/share`, { method: "DELETE" }),

    createMemoEditSession: (memoId: string) =>
      request<{ editSession: MemoEditSession }>(`/api/v1/memos/${memoId}/edit-sessions`, {
        method: "POST",
        body: JSON.stringify({}),
      }),

    listMemoRevisions: (memoId: string) => request<ListMemoRevisionsResponse>(`/api/v1/memos/${memoId}/revisions`),

    restoreMemoRevision: (memoId: string, revisionId: string) =>
      request<MemoResponse>(`/api/v1/memos/${memoId}/revisions/${revisionId}/restore`, {
        method: "POST",
        body: JSON.stringify({}),
      }),

    listResources: () => request<ListResourcesResponse>("/api/v1/resources"),

    renameResource: (resourceId: string, filename: string) =>
      request<ResourceResponse>(`/api/v1/resources/${encodeURIComponent(resourceId)}`, {
        method: "PATCH",
        body: JSON.stringify({ filename }),
      }),

    updateResourceContent: (resourceId: string, file: Blob, expectedContentHash: string) => {
      const form = new FormData();
      form.append("file", file);
      form.append("expectedContentHash", expectedContentHash);
      form.append("mimeType", file.type || "application/octet-stream");
      if (file instanceof File) form.append("filename", file.name);
      return request<ResourceResponse>(`/api/v1/resources/${encodeURIComponent(resourceId)}/blob`, {
        method: "PUT",
        body: form,
      });
    },

    deleteResource: (resourceId: string) =>
      request<{ ok: true }>(`/api/v1/resources/${encodeURIComponent(resourceId)}`, {
        method: "DELETE",
      }),

    getMarkdownExportPage: (offset = 0, limit = 50, memoIds?: string[], cursor?: string) => {
      const search = new URLSearchParams({
        offset: String(offset),
        limit: String(limit),
      });
      if (memoIds && memoIds.length > 0) {
        search.set("ids", memoIds.join(","));
      }
      if (offset > 0) search.set("includeTotal", "0");
      if (cursor !== undefined) search.set("cursor", cursor);
      return request<MarkdownExportPage>(`/api/v1/exports/markdown?${search.toString()}`);
    },

    getJsonBackupPage: (offset = 0, limit = 25, cursor?: string) => {
      const search = new URLSearchParams({ offset: String(offset), limit: String(limit) });
      if (offset > 0) search.set("includeTotal", "0");
      if (cursor !== undefined) search.set("cursor", cursor);
      return request<JsonBackupPage>(`/api/v1/backups/json?${search}`);
    },

    restoreJsonNotebooks: (notebooks: JsonBackupNotebook[]) =>
      request<{ ok: true }>("/api/v1/restores/json/notebooks", {
        method: "POST",
        body: JSON.stringify({ notebooks }),
      }),

    restoreJsonMemos: (memos: JsonBackupMemo[]) =>
      request<{ ok: true }>("/api/v1/restores/json/memos", {
        method: "POST",
        body: JSON.stringify({ memos }),
      }),

    getPageBackup: () => request<JsonBackupPages>("/api/v1/backups/pages"),

    restoreJsonPages: (pages: Partial<JsonBackupPages>) =>
      request<{ ok: true }>("/api/v1/restores/json/pages", {
        method: "POST",
        body: JSON.stringify(pages),
      }),

    restoreJsonAiPrompts: (prompts: JsonBackupAiPrompt[]) =>
      request<{ ok: true }>("/api/v1/restores/json/ai-prompts", {
        method: "POST",
        body: JSON.stringify({ prompts }),
      }),

    createJsonResourceRestoreSink,

    restoreJsonResource: async (resourceId: string, metadata: JsonBackupMemo["resources"][number], file: Blob) => {
      const sink = await createJsonResourceRestoreSink(resourceId, metadata);
      const reader = file.stream().getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          await sink.write(next.value);
        }
        await sink.close();
        return { ok: true as const };
      } catch (error) {
        await sink.abort();
        throw error;
      } finally {
        reader.releaseLock();
      }
    },

    getResourceResponse: (resourceUrl: string, init?: RequestInit) =>
      requestResourceResponse(resourceUrl, init),

    getResourceBlob: (resourceUrl: string) => requestBlob(resourceUrl),

    downloadGithubPluginAsset: (
      owner: string,
      repository: string,
      releaseTag: string,
      assetName: "manifest.json" | "main.js" | "styles.css",
    ) => requestArrayBuffer(
      `/api/v1/plugins/github/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/releases/${encodeURIComponent(releaseTag)}/assets/${encodeURIComponent(assetName)}`,
    ),

    downloadGithubPluginAssetById: (
      owner: string,
      repository: string,
      assetId: string,
      assetName: "manifest.json" | "main.js" | "styles.css",
    ) => requestArrayBuffer(
      `/api/v1/plugins/github/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/assets/${encodeURIComponent(assetId)}/${encodeURIComponent(assetName)}`,
    ),

    getGithubPluginRepositoryManifest: async (owner: string, repository: string) => {
      const path = `/api/v1/plugins/github/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/manifest`;
      const { context, response } = await send(path, undefined, { setJsonContentType: false });
      if (!response.ok) await throwRequestError(context, response, "GitHub plugin manifest request failed");
      return response.text();
    },

    getGithubPluginLatestManifest: async (owner: string, repository: string) => {
      const path = `/api/v1/plugins/github/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/latest-manifest`;
      const { context, response } = await send(path, undefined, { setJsonContentType: false });
      if (!response.ok) await throwRequestError(context, response, "GitHub plugin latest-release manifest request failed");
      return response.text();
    },

    getCommunityPluginRegistry: async () => {
      const { context, response } = await send("/api/v1/plugins/community-registry", undefined, { setJsonContentType: false });
      if (response.status === 404) return null;
      if (!response.ok) await throwRequestError(context, response, "Community registry request failed");
      return {
        bytes: await response.arrayBuffer(),
        signatureBase64: response.headers.get("x-ponder-community-registry-signature") ?? "",
      };
    },

    getGithubPluginRelease: async (owner: string, repository: string, releaseTag: string) => {
      const path = `/api/v1/plugins/github/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/releases/tags/${encodeURIComponent(releaseTag)}`;
      const { context, response } = await send(path, undefined, { setJsonContentType: false });
      if (response.status === 404) return null;
      if (!response.ok) await throwRequestError(context, response, "GitHub plugin release request failed");
      return response.json() as Promise<{
        tag_name: string;
        draft: boolean;
        assets: Array<{
          id: number;
          name: string;
          size: number;
          url: string;
          browser_download_url: string;
          digest?: string;
        }>;
      }>;
    },

    uploadMemoResource: (memoId: string, file: Blob | FormData) => {
      // Small files do not benefit from an upload session's three round trips.
      // Keep large attachments on the bounded-memory, resumable path.
      if (!(file instanceof FormData) && file.size > MAX_SINGLE_REQUEST_UPLOAD_BYTES) {
        return uploadMemoResourceMultipart(memoId, file);
      }
      const form = file instanceof FormData ? file : new FormData();
      if (!(file instanceof FormData)) {
        const filename = "name" in file && typeof file.name === "string" && file.name.trim()
          ? file.name
          : "attachment";
        form.append("file", file, filename);
      }
      return request<ResourceResponse>(`/api/v1/memos/${encodeURIComponent(memoId)}/resources`, {
        method: "POST",
        body: form,
      });
    },

    claimPosterRender: () => request<{ job: null | { id: string; memoId: string; expectedRevision: number; templateId: string | null; claimToken: string; expiresAt: string } }>("/api/v1/poster-render/claim", { method: "POST", body: "{}" }),
    completePosterRender: (id: string, input: { claimToken: string; document?: import("@ponder/shared").PosterDocument; errorCode?: "render_failed" | "revision_conflict" | "client_timeout" }) => request<{ job: { status: string } }>(`/api/v1/poster-render/${encodeURIComponent(id)}/complete`, { method: "POST", body: JSON.stringify(input) }),
    uploadMemoResourceParts,

    updateMemo: (
      memoId: string,
      payload: {
        expectedRevision?: number;
        expectedContentHash?: string;
        editSessionId?: string;
        notebookId?: string;
        title?: string;
        isPinned?: boolean;
        contentJson?: TiptapDoc;
        contentMarkdown?: string;
        tags?: string[];
        createdAt?: string;
        updatedAt?: string;
        allowDestructiveOverwrite?: boolean;
      }
    ) =>
      request<MemoResponse>(`/api/v1/memos/${memoId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),

    deleteMemo: (memoId: string, options?: { permanent?: boolean }) => {
      const search = new URLSearchParams();

      if (options?.permanent) {
        search.set("permanent", "1");
      }

      const suffix = search.toString() ? `?${search.toString()}` : "";
      return request<{ ok: true }>(`/api/v1/memos/${memoId}${suffix}`, {
        method: "DELETE",
      });
    },

    restoreMemo: (memoId: string) =>
      request<MemoResponse>(`/api/v1/memos/${memoId}/restore`, {
        method: "POST",
        body: JSON.stringify({}),
      }),

    duplicateMemo: (memoId: string, payload: { notebookId?: string; title?: string } = {}) =>
      request<MemoResponse>(`/api/v1/memos/${encodeURIComponent(memoId)}/duplicate`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    mergeMemos: (payload: { memoIds: string[]; notebookId?: string; title?: string }) =>
      request<MemoResponse>("/api/v1/memos/merge", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    resetDemo: () =>
      request<{ success: true }>("/api/v1/demo/reset", {
        method: "POST",
      }),
  };
};

const normalizeBaseUrl = (value?: string) => {
  if (!value) {
    return "";
  }

  return value.replace(/\/+$/, "");
};

const isAbsoluteHttpUrl = (value: string) => /^https?:\/\//i.test(value);
