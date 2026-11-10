import { describe, expect, test } from "bun:test";
import { DEFAULT_MEMO_TEMPLATE_SEEDS } from "@ponder/shared/memo-template-seeds";
import { createTemplateCards, createTemplateDraft, templateDraftToPayload } from "./template-center.ts";

const quickNote = DEFAULT_MEMO_TEMPLATE_SEEDS.find((seed) => seed.key === "quick-note");
const english = quickNote.translations["en-US"];
const polish = quickNote.translations.pl;
const storedEnglish = {
  id: "ws_default_template_quick-note",
  name: english.title,
  description: english.description,
  title: english.title,
  contentJson: { type: "doc", content: [] },
  contentMarkdown: english.contentMarkdown,
  tags: ["template", "quick-note"],
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

describe("template center", () => {
  test("shows an unedited default template in the UI language but edits the stored one", () => {
    const [card] = createTemplateCards([storedEnglish], "pl");

    expect(card.display.name).toBe(polish.title);
    expect(card.display.contentMarkdown).toBe(polish.contentMarkdown);
    expect(card.template).toBe(storedEnglish);
  });

  test("a name-only edit in another UI language keeps the other stored fields", () => {
    const [card] = createTemplateCards([storedEnglish], "pl");
    const draft = { ...createTemplateDraft(card.template), name: "Moja notatka" };

    expect(templateDraftToPayload(draft)).toEqual({
      name: "Moja notatka",
      description: english.description,
      title: english.title,
      contentMarkdown: english.contentMarkdown,
      tags: ["template", "quick-note"],
    });
  });
});
