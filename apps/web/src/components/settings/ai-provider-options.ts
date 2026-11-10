import type { AiProvider } from "@ponder/shared";
import { ApiRequestError } from "@/lib/api";

export const providerDefaults: Record<AiProvider, { displayName: string; baseUrl: string; modelId: string }> = {
  "openai-compatible": { displayName: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1", modelId: "gpt-5.6-luna" },
  anthropic: { displayName: "Anthropic", baseUrl: "https://api.anthropic.com/v1", modelId: "claude-sonnet-4-5" },
  google: { displayName: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", modelId: "gemini-2.5-flash" },
};

export const formatProviderOrdinal = (position: number, _locale: string) => String(position);

export const trimAiText = (value: string | null | undefined) => (value ?? "").trim();

export const isLegacyProviderDisplayName = (displayName: string | null | undefined, provider: AiProvider) =>
  trimAiText(displayName).toLocaleLowerCase() === (providerDefaults[provider]?.displayName ?? "").toLocaleLowerCase();

export const aiErrorMessage = (
  error: unknown,
  fallback: string,
  encryptionMessage: string,
  unavailableMessage = encryptionMessage,
) => {
  if (error instanceof ApiRequestError && error.code === "ai_encryption_key_missing") return encryptionMessage;
  if (error instanceof ApiRequestError && error.code === "ai_credentials_unavailable") return unavailableMessage;
  return error instanceof Error ? error.message : fallback;
};
