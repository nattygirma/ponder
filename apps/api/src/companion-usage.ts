import type { CompanionTurnUsage, CompanionUsageRecord } from "@ponder/shared";
import type { DatabaseAdapter } from "./storage-contract";
import { hostAiModelList, type HostAiEnvironment } from "./host-ai";
import { turnAiRequests, type TurnRow } from "./companion-service";

// What one chat reply cost, for its "…" card. On AppKeep each model call left a usage record (tokens, price,
// who paid) whose id the browser saved with the turn; elsewhere the card shows the token counts the AI SDK
// reported for the turn, with no price.

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);
const text = (value: unknown, max = 128) => (typeof value === "string" && value ? value.slice(0, max) : null);

/** Only the fields the card needs, whatever else the host's record carries. */
export const toUsageRecord = (raw: unknown): CompanionUsageRecord | null => {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const usage = (record.usage && typeof record.usage === "object" ? record.usage : {}) as Record<string, unknown>;
  const paid = record.paid_with === "credits" || record.paid_with === "key" ? record.paid_with : null;
  return {
    id: text(record.id) ?? undefined,
    model: text(record.model),
    provider: text(record.provider),
    paid_with: paid,
    result: text(record.result, 32),
    stop_reason: text(record.stop_reason, 64),
    usage: {
      input_tokens: count(usage.input_tokens),
      cache_read_tokens: count(usage.cache_read_tokens),
      cache_write_tokens: count(usage.cache_write_tokens),
      output_tokens: count(usage.output_tokens),
      thinking_tokens: count(usage.thinking_tokens),
    },
    price_micros: count(record.price_micros) ?? null,
    estimated: record.estimated === true,
    started_at: text(record.started_at, 40) ?? undefined,
    first_token_ms: count(record.first_token_ms) ?? null,
    duration_ms: count(record.duration_ms) ?? null,
  };
};

const sdkRecord = (row: TurnRow): CompanionUsageRecord[] => (row.input_tokens == null && row.output_tokens == null ? [] : [{
  model: row.model || null,
  usage: { input_tokens: row.input_tokens ?? undefined, output_tokens: row.output_tokens ?? undefined },
}]);

export const companionTurnUsage = async (
  db: DatabaseAdapter,
  workspaceId: string,
  row: TurnRow,
  environment: HostAiEnvironment,
): Promise<CompanionTurnUsage> => {
  const ids = turnAiRequests(row);
  let records: CompanionUsageRecord[] = [];
  if (ids.length && environment.hostAiUsage) {
    const usage = environment.hostAiUsage;
    // One lookup per model call; a record the host can't find (or a failed lookup) is left out.
    const found = await Promise.all(ids.map((id) => usage(id).then(toUsageRecord, () => null)));
    records = found.filter((record): record is CompanionUsageRecord => record !== null);
  }
  const source: CompanionTurnUsage["source"] = records.length ? "appkeep" : "sdk";
  if (!records.length) records = sdkRecord(row);

  const wanted = [...new Set(records.map((record) => record.model).filter((id): id is string => !!id))];
  const models: Record<string, string> = {};
  if (wanted.length) {
    const rows = await db.prepare(
      `SELECT models.model_id, models.display_name FROM ai_models AS models
       JOIN ai_provider_configs AS providers ON providers.id = models.provider_config_id
       WHERE providers.workspace_id = ? AND models.model_id IN (${wanted.map(() => "?").join(", ")})`,
    ).bind(workspaceId, ...wanted).all<{ model_id: string; display_name: string }>();
    for (const item of rows.results ?? []) if (item.display_name?.trim()) models[item.model_id] = item.display_name.trim();
    if (source === "appkeep" && wanted.some((id) => !models[id])) {
      for (const model of await hostAiModelList(environment)) if (wanted.includes(model.modelId) && !models[model.modelId]) models[model.modelId] = model.displayName;
    }
  }
  return { source, records, models };
};
