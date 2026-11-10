import { expect, test } from "bun:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { enUS } from "@ponder/shared/i18n";
import { DesktopAcpAgentCard } from "./DesktopAcpAgentCard.tsx";

test("desktop and hidden mobile cards have independent native radio groups", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "en-US", resources: { "en-US": { translation: enUS } } });
  const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n },
    createElement(Fragment, null, createElement(DesktopAcpAgentCard), createElement(DesktopAcpAgentCard))));
  const names = [...html.matchAll(/name="(ponder-acp-source-[^"]+)"/g)].map((match) => match[1]);
  expect(names).toHaveLength(4);
  expect(names[0]).toBe(names[1]);
  expect(names[2]).toBe(names[3]);
  expect(names[0]).not.toBe(names[2]);
});
