import { describe, expect, test } from "bun:test";
import { AppError } from "./app-error";
import {
  asRecord,
  decodeBase64Data,
  escapeMarkdownImageAlt,
  getJsonRpcId,
  getRequiredString,
  getRequiredStringArray,
  jsonRpcError,
  jsonRpcResult,
  mapMcpToolError,
} from "./mcp-json-rpc";

describe("MCP JSON-RPC helpers", () => {
  test("builds protocol results and errors", () => {
    expect(jsonRpcResult(1, { ok: true })).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    expect(jsonRpcError("request", -32602, "Invalid params", { field: "memoId" })).toEqual({
      jsonrpc: "2.0",
      id: "request",
      error: { code: -32602, message: "Invalid params", data: { field: "memoId" } },
    });
  });

  test("accepts only valid IDs, records, and required values", () => {
    expect(getJsonRpcId({ id: 0 })).toBe(0);
    expect(getJsonRpcId({ id: false })).toBeNull();
    expect(asRecord(["not", "a", "record"])).toEqual({});
    expect(getRequiredString(" memo_1 ", "memoId")).toBe("memo_1");
    expect(getRequiredStringArray(["one", 2, "two"], "items")).toEqual(["one", "two"]);
    expect(() => getRequiredString(" ", "memoId")).toThrow(AppError);
  });

  test("decodes raw and data URL base64 payloads", async () => {
    expect(new TextDecoder().decode(await decodeBase64Data("UG9uZGVy"))).toBe("Ponder");
    expect(new TextDecoder().decode(await decodeBase64Data("data:text/plain;base64,UG9uZGVy"))).toBe("Ponder");
  });

  test("escapes Markdown image labels", () => {
    expect(escapeMarkdownImageAlt("[cover] \\ draft")).toBe("\\[cover\\] \\\\ draft");
  });

  test("maps application errors to stable MCP error codes", () => {
    expect(mapMcpToolError(new AppError("memo_missing", "Memo not found", 404))).toEqual({
      rpcCode: -32004,
      status: 404,
      message: "Memo not found",
      data: { code: "memo_missing" },
    });
    expect(mapMcpToolError(new Error("boom"))).toMatchObject({ rpcCode: -32000, status: 400, message: "boom" });
  });
});
