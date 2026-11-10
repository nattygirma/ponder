import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { enUS } from "../../../../../packages/shared/src/i18n/en-US.ts";
import { InfographicSidebarSession } from "./InfographicSidebarSession.tsx";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, enabled: false } },
});

const session = {
  turns: [{
    id: "turn-1",
    prompt: "做成Infographic",
    createdAt: "2026-10-02T00:00:00.000Z",
    kind: "generated",
    resultTitle: "里程碑",
    response: "相关Notes：[演进里程碑](#memo=memo_demo_infographic)\n\n详见 [Documents](https://example.com/docs)。",
  }],
  activeTurn: {
    prompt: "再补一张",
    response: "见 [Flowchart](#memo=memo_03de025fc0134b7da0d155c2c1686b92)",
  },
  generating: false,
  readOnly: false,
  canUndo: false,
  hasGraphic: true,
  activeSessionId: null,
  async onSubmit() {},
  onUndo() {},
  onStop() {},
  onSelectSession() {},
  onCreateSession() {},
};

describe("infographic sidebar note links", () => {
  test("renders note links as in-app anchors and leaves external links as buttons", async () => {
    const i18n = createInstance();
    await i18n.init({ lng: "en-US", resources: { "en-US": { translation: enUS } } });
    const markup = renderToStaticMarkup(createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(InfographicSidebarSession, {
          session,
          onOpenNote() {},
        }),
      ),
    ));
    expect(markup).toContain('href="#memo=memo_demo_infographic"');
    expect(markup).toContain('href="#memo=memo_03de025fc0134b7da0d155c2c1686b92"');
    expect(markup).toContain("演进里程碑");
    expect(markup).toContain("Flowchart");
    expect(markup).not.toContain('href="#memo=memo_demo_infographic" target="_blank"');
    expect(markup).toContain(">Documents</button>");
    expect(markup).not.toContain('href="https://example.com/docs"');
  });
});
