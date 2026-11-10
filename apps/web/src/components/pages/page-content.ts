import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import type { Schema } from "@tiptap/pm/model";
import type * as Y from "yjs";
import { resolveMemoContentDoc, type MemoDetail, type TiptapDoc } from "@ponder/shared";
import { HttpYjsProvider } from "@/components/teams/collab";
import type { PonderRepository } from "@/lib/repository";
import { createLocalEditSession } from "@/components/editor/editor-pane-helpers";

type Viewer = { id: string; teamRole?: string | null; displayName?: string | null; username?: string } | null | undefined;

const isEmptyParagraph = (node: { type?: string; content?: unknown[] } | undefined) =>
  node?.type === "paragraph" && !node.content?.length;

/** The page's content with a block added at the end, taking the place of a trailing empty line. */
export const docWithBlockAppended = (doc: TiptapDoc, block: Record<string, unknown>): TiptapDoc => {
  const content = [...((doc.content ?? []) as Record<string, unknown>[])];
  if (isEmptyParagraph(content[content.length - 1])) content.pop();
  return { ...doc, content: [...content, block] } as TiptapDoc;
};

/** Adds a block to the end of another page, through the live session when the page has one. */
export const appendBlockToPage = async ({ memoId, block, schema, repository, viewer }: {
  memoId: string;
  block: Record<string, unknown>;
  schema: Schema;
  repository: PonderRepository;
  viewer: Viewer;
}) => {
  if (viewer?.teamRole) {
    const provider = new HttpYjsProvider(memoId, { id: viewer.id, name: viewer.displayName || viewer.username || "", color: "#787774" }, () => undefined);
    try {
      await provider.start();
      if (!provider.canEdit) throw new Error("This page is read-only.");
      const fragment = provider.doc.getXmlFragment("default");
      const incoming = prosemirrorJSONToYXmlFragment(schema, { type: "doc", content: [block] });
      fragment.insert(fragment.length, incoming.toArray().map((item) => item.clone()) as (Y.XmlElement | Y.XmlText)[]);
    } finally {
      provider.stop();
    }
    return;
  }
  const { memo } = await repository.getMemo(memoId) as { memo: MemoDetail };
  const session = createLocalEditSession(memo);
  await repository.updateMemo(memo, {
    expectedRevision: memo.revision,
    expectedContentHash: memo.contentHash,
    editSessionId: session.id,
    title: memo.title ?? "",
    contentJson: docWithBlockAppended(resolveMemoContentDoc(memo.contentJson, memo.contentMarkdown), block),
    tags: memo.tags,
  });
};
