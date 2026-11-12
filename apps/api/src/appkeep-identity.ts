import type { Bindings } from "./api-context";
import { isoNow } from "./entity-utils";
import type { DatabaseAdapter } from "./storage-contract";

// On AppKeep the platform signs people in. It strips x-altstack-* headers from
// browser requests and sets them itself, so they can be trusted, but only when
// the AppKeep entry point has set PONDER_APPKEEP. Anywhere else they are just
// text a client typed, and Ponder keeps its own login.
export const APPKEEP_SIGN_IN = {
  loginUrl: "/_altstack/login",
  logoutUrl: "/_altstack/logout",
} as const;

const UNUSABLE_PASSWORD_HASH = "appkeep-sign-in";

export type AppKeepIdentity = {
  id: string;
  email: string;
  name: string | null;
  canManageApp: boolean;
};

export const isAppKeepHosted = (env: Pick<Bindings, "PONDER_APPKEEP">) => env.PONDER_APPKEEP === "true";

export const appKeepIdentity = (
  env: Pick<Bindings, "PONDER_APPKEEP">,
  headers: Headers,
): AppKeepIdentity | null => {
  if (!isAppKeepHosted(env)) return null;
  const id = headers.get("x-altstack-owner-id")?.trim();
  const email = headers.get("x-altstack-owner-email")?.trim().toLowerCase();
  if (!id || !email) return null;
  let name: string | null = null;
  try {
    name = decodeURIComponent(headers.get("x-altstack-owner-name") ?? "").trim() || null;
  } catch {
    // A malformed name is only cosmetic.
  }
  const role = headers.get("x-altstack-role");
  return { id, email, name, canManageApp: role === "owner" || role === "admin" };
};

export const appKeepUserId = (identity: Pick<AppKeepIdentity, "id">) => `usr_appkeep_${identity.id}`;

// The Ponder account behind an AppKeep person, created on their first visit.
// The id comes from AppKeep's stable user id, so a changed email stays the same account.
export const ensureAppKeepUser = async (db: DatabaseAdapter, identity: AppKeepIdentity) => {
  const id = appKeepUserId(identity);
  const displayName = identity.name ?? identity.email;
  const now = isoNow();
  const insert = (username: string) => db.prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, username, UNUSABLE_PASSWORD_HASH, displayName, now, now).run();
  const load = () => db.prepare(
    `SELECT id, username, password_hash, display_name, email, is_disabled FROM users WHERE id = ?`,
  ).bind(id).first<{ id: string; username: string; password_hash: string; display_name: string | null; email: string | null; is_disabled: number }>();

  await insert(identity.email);
  let user = await load();
  if (!user) {
    // Another account already holds this email as its username.
    await insert(id);
    user = await load();
  }
  if (!user) throw new Error("Could not create the Ponder account for this AppKeep user.");
  // Keep the AppKeep email on the account, so comment alerts and automation mail can reach the person.
  if (user.display_name !== displayName || user.email !== identity.email) {
    await db.prepare(`UPDATE users SET display_name = ?, email = ?, updated_at = ? WHERE id = ?`).bind(displayName, identity.email, now, id).run();
  }
  return { ...user, display_name: displayName, email: identity.email };
};
