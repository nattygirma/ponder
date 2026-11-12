/**
 * Headings, scrolling to them, and the heading being read, for the /toc block and the floating
 * table of contents.
 *
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0:
 * src/components/editor/components/blocks/outline/OutlineNavigation.tsx. Slate selectors and
 * block ids became a TipTap editor-state selector and heading positions; collapsed toggles are
 * opened through their own toggle buttons; the URL is left alone.
 */
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useEditorState } from "@tiptap/react";
import { extractHeadings, getActiveHeading, sameHeadings, type OutlineHeading } from "@ponder/shared";

type HeadingList = ReturnType<typeof extractHeadings>;

// Cursor movement keeps the same document; avoid rescanning it.
const cache = new WeakMap<ProseMirrorNode, Map<number, HeadingList>>();

const headingsOf = (doc: ProseMirrorNode, maxDepth: number) => {
  let byDepth = cache.get(doc);
  if (!byDepth) {
    byDepth = new Map();
    cache.set(doc, byDepth);
  }
  let result = byDepth.get(maxDepth);
  if (!result) {
    result = extractHeadings(doc, maxDepth);
    byDepth.set(maxDepth, result);
  }
  return result;
};

const sameList = (a: HeadingList | null, b: HeadingList | null) =>
  a === b || Boolean(a && b && a.hasHeadings === b.hasHeadings && sameHeadings(a.headings, b.headings));

/** The page's H1 to H3, kept current as it's edited. */
export const usePageHeadings = (editor: Editor | null, maxDepth = 3): HeadingList => {
  const list = useEditorState({
    editor,
    selector: ({ editor: current }) => (current && !current.isDestroyed ? headingsOf(current.state.doc, maxDepth) : null),
    equalityFn: sameList,
  });
  return list ?? { hasHeadings: false, headings: [] };
};

export const headingElement = (editor: Editor, heading: Pick<OutlineHeading, "pos">) => {
  try {
    const node = editor.view.nodeDOM(heading.pos);
    return node instanceof HTMLElement ? node : null;
  } catch {
    // The heading moved or the view isn't mounted yet.
    return null;
  }
};

/** Opens the toggles a heading sits in, so it can be scrolled to. Returns whether any opened. */
const revealHeading = (editor: Editor, pos: number) => {
  let revealed = false;
  let $pos;
  try {
    $pos = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size));
  } catch {
    return false;
  }
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name !== "details") continue;
    const dom = editor.view.nodeDOM($pos.before(depth));
    if (!(dom instanceof HTMLElement) || dom.classList.contains("is-open")) continue;
    dom.querySelector<HTMLButtonElement>(":scope > button")?.click();
    revealed = true;
  }
  return revealed;
};

/** Notion scrolls the heading to the top of the page, opening any toggle it's inside. */
export const jumpToHeading = (editor: Editor, heading: Pick<OutlineHeading, "pos">) => {
  const scroll = () => headingElement(editor, heading)?.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
  // Let a toggle open before measuring the heading.
  if (revealHeading(editor, heading.pos)) window.requestAnimationFrame(scroll);
  else scroll();
};

const scrollParent = (element: HTMLElement | null): HTMLElement | Window => {
  for (let current = element?.parentElement ?? null; current; current = current.parentElement) {
    const { overflowY } = getComputedStyle(current);
    if ((overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight) return current;
  }
  return window;
};

/** The heading being read: the last one above a line near the top of the page. */
export const useActiveHeading = (editor: Editor | null, headings: OutlineHeading[], enabled: boolean) => {
  const [activeId, setActiveId] = useState<string>();
  const headingsRef = useRef(headings);
  headingsRef.current = headings;

  useEffect(() => {
    if (!enabled || !editor || editor.isDestroyed) return;
    const root = editor.view.dom as HTMLElement;
    const scroller = scrollParent(root);
    let frame = 0;
    const update = () => {
      frame = 0;
      if (editor.isDestroyed) return;
      const top = scroller instanceof HTMLElement ? scroller.getBoundingClientRect().top : 0;
      const positions = headingsRef.current.flatMap((heading) => {
        const element = headingElement(editor, heading);
        return element?.getClientRects().length ? [{ id: heading.id, top: element.getBoundingClientRect().top }] : [];
      });
      const atBottom = scroller instanceof HTMLElement
        ? scroller.scrollHeight > scroller.clientHeight && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1
        : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1;
      setActiveId(getActiveHeading(positions, Math.max(0, top) + 96, atBottom));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(root);
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    editor.on("update", schedule);
    schedule();
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      editor.off("update", schedule);
    };
  }, [editor, enabled]);

  return activeId;
};
