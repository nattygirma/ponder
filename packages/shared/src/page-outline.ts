/**
 * The headings a table of contents lists, for the /toc block and the floating outline.
 *
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0:
 * src/components/editor/components/blocks/outline/utils.ts. Slate blocks are ProseMirror nodes here,
 * a heading is known by its position instead of a block id, and toggle headings are `details`
 * nodes with a `level`.
 */

/** The little of a ProseMirror node this needs, so tests can pass plain objects. */
export type OutlineSourceNode = {
  type: { name: string };
  attrs: Record<string, unknown>;
  textContent: string;
  firstChild?: OutlineSourceNode | null;
  forEach: (callback: (child: OutlineSourceNode, offset: number) => void) => void;
};

export type OutlineHeading = {
  /** The heading's position in the document; the same heading keeps it until text before it changes. */
  id: string;
  pos: number;
  level: number;
  text: string;
  children: OutlineHeading[];
};

export type OutlineItem = { heading: OutlineHeading; indent: number };

const headingLevel = (node: OutlineSourceNode) => {
  if (node.type.name === "heading") return Number(node.attrs.level);
  if (node.type.name === "details") return Number(node.attrs.level ?? 0);
  return 0;
};

const headingText = (node: OutlineSourceNode) =>
  (node.type.name === "details" ? node.firstChild?.textContent ?? "" : node.textContent).trim();

/** Headings from H1 to `maxDepth`, in document order, including those inside toggles, columns and tabs. */
export const extractHeadings = (doc: OutlineSourceNode, maxDepth = 3): { hasHeadings: boolean; headings: OutlineHeading[] } => {
  const headings: OutlineHeading[] = [];
  let hasHeadings = false;

  const traverse = (node: OutlineSourceNode, start: number) => {
    node.forEach((child, offset) => {
      const pos = start + offset;
      const level = headingLevel(child);
      const isHeading = Number.isInteger(level) && level >= 1 && level <= 6;
      if (isHeading) hasHeadings = true;
      if (isHeading && level <= maxDepth) {
        headings.push({ id: String(pos), pos, level, text: headingText(child), children: [] });
      }
      // Headings can contain nested blocks, including other headings (a toggle heading's body).
      if (child.type.name !== "heading") traverse(child, pos + 1);
    });
  };

  traverse(doc, 0);
  return { hasHeadings, headings };
};

export const nestHeadings = (headings: OutlineHeading[]): OutlineHeading[] => {
  const root: OutlineHeading[] = [];
  const stack: OutlineHeading[] = [];

  headings.forEach((heading) => {
    const node = { ...heading, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length === 0) root.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  });

  return root;
};

export const flattenHeadings = (headings: OutlineHeading[], indent = 0): OutlineItem[] =>
  headings.flatMap((heading) => [{ heading, indent }, ...flattenHeadings(heading.children, indent + 1)]);

/** The visually nearest heading above the reading line, or the topmost heading before scrolling. */
export const getActiveHeading = (
  positions: readonly { id: string; top: number }[],
  readingLine: number,
  atBottom = false,
): string | undefined => {
  if (!positions.length) return undefined;
  let first = positions[0];
  let last = first;
  let active: (typeof positions)[number] | undefined;

  for (const position of positions) {
    // Column order is not vertical order. Resolve ties in document order.
    if (position.top < first.top) first = position;
    if (position.top >= last.top) last = position;
    if (position.top <= readingLine && (!active || position.top >= active.top)) active = position;
  }

  return (atBottom ? last : active ?? first).id;
};

/** Two lists name the same headings at the same places, so a view can keep its old copy. */
export const sameHeadings = (a: OutlineHeading[], b: OutlineHeading[]) =>
  a.length === b.length && a.every((heading, index) => {
    const other = b[index];
    return heading.pos === other.pos && heading.level === other.level && heading.text === other.text;
  });
