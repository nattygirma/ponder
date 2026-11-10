import type { Context } from "hono";
import type { CloudflareStorageBindings } from "./cloudflare-storage-adapter";
import type { StorageAdapter } from "./storage-contract";
import type { HostAiStream, HostAiText } from "./host-ai";

export type HostConnection = {
  id: string;
  provider: string;
  external_id: string;
  name: string;
  status: "active" | "expired";
  scopes: string[];
  connected_at: string;
};

export type Bindings = {
  /** Runtime driver for public-only egress; no platform-specific business logic. */
  publicNetworkFetch?: (input: string, init: RequestInit) => Promise<Response>;
  /** Optional runtime driver for notification email; without it people get in-app notifications only. */
  sendEmail?: (message: { to: string; subject: string; text: string }) => Promise<void>;
  /** Accounts connected by login, on hosts that offer it (AppKeep). They belong to the deployment. */
  listConnections?: (provider?: string) => Promise<HostConnection[]>;
  /** One turn with the host's AI model, paid by the host account (AppKeep's ai.text). Offered as the "AppKeep AI" provider. */
  hostAiText?: HostAiText;
  /** The same turn streamed as Claude's own events, with no time limit (AppKeep's ai.stream). Used for streamed requests when present. */
  hostAiStream?: HostAiStream;
  disconnectConnection?: (connectionId: string) => Promise<boolean>;
  /** Which login providers the host can connect yet; the rest show as coming soon. Absent: all of them. */
  connectionProviders?: () => Promise<{ provider: string; name: string; available: boolean }[]>;
  /** The only persistence dependency exposed to application code. */
  storage: StorageAdapter;
  PONDER_AUTH_USERNAME?: string;
  PONDER_RUNTIME?: string;
  PONDER_CONTAINER_IMAGE?: string;
  PONDER_DEPLOYMENT_TRIGGER?: string;
  PONDER_DEPLOYMENT_METHOD?: string;
  PONDER_BUILD_CREATED_AT?: string;
  PONDER_BUILD_TRIGGER?: string;
  PONDER_BUILD_METHOD?: string;
  /** Creation time of the active deployment version, supplied by a runtime adapter. */
  deploymentVersionCreatedAt?: string;
  PONDER_AUTH_PASSWORD?: string;
  PONDER_APPKEEP?: string;
  ALTSTACK_APP_URL?: string;
  PONDER_AUTH_PASSWORD_HASH?: string;
  PONDER_AUTH_PASSWORD_FALLBACK?: string;
  PONDER_SESSION_TTL_DAYS?: string;
  PONDER_AUTH_LOGIN_WINDOW_SECONDS?: string;
  PONDER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS?: string;
  PONDER_AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS?: string;
  PONDER_AUTH_LOGIN_IP_MAX_ATTEMPTS?: string;
  PONDER_AUTH_LOGIN_IP_COOLDOWN_SECONDS?: string;
  PONDER_R2_BUCKET_NAME?: string;
  /** Legacy decryption fallback; new credentials use auth-derived keys. */
  PONDER_STORAGE_ENCRYPTION_KEY?: string;
  PONDER_CREDENTIALS_ENCRYPTION_KEY?: string;
  PONDER_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS?: string;
  PONDER_DEMO_MODE?: string;
  PONDER_LOCAL_DEMO_SEED?: string;
  PONDER_ALLOW_UNAUTHENTICATED?: string;
  /** HTTPS URL of the signed community registry. Unset disables the catalog. */
  PONDER_COMMUNITY_REGISTRY_URL?: string;
};

export type WorkerBindings = Omit<Bindings, "storage" | "publicNetworkFetch" | "sendEmail" | "deploymentVersionCreatedAt"> & CloudflareStorageBindings & {
  ASSETS: Fetcher;
  CF_VERSION_METADATA?: { timestamp?: string };
};

export type AuthContext = {
  kind: "user" | "agent";
  actorType: "user" | "agent";
  actorId: string | null;
  username: string;
  displayName: string | null;
  scopes: string[];
  workspaceId: string;
  /** Instance-level role. Being an owner of a shared workspace never changes it. */
  role: "owner" | "member";
  /** Set only while a shared workspace is open; decides what the person may do there. */
  teamRole?: "owner" | "member" | "viewer";
  sessionId?: string;
  tokenId?: string;
};

export type AuditActor = {
  actorType: "user" | "agent";
  actorId: string | null;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    auth: AuthContext;
  };
};

export type AppContext = Context<AppEnv>;
