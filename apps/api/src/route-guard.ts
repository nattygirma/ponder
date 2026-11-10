import type { AppContext } from "./api-context";
import { AppError } from "./app-error";
import { apiError } from "./http-errors";
import { requireScopes } from "./request-auth";

/** Checks the token's scope, then turns an AppError from the handler into its JSON response. */
export const guarded = async (c: AppContext, scope: "read:memos" | "write:memos", handler: () => Promise<Response>) => {
  const denied = requireScopes(c, scope);
  if (denied) return denied;
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AppError) return apiError(c, error.code, error.message, error.status);
    throw error;
  }
};
