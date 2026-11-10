import type { NoteSearchMatch } from "./note-search";

/**
 * Case-insensitive literal matches in a plain string, non-overlapping, as source offsets: the same
 * results as CodeMirror's literal SearchQuery (markdown-source-search.ts), without loading CodeMirror
 * with the editor. Find-in-note uses it in Markdown mode.
 */
export const findLiteralMatches = (source: string, query: string): NoteSearchMatch[] => {
  if (!query.length) return [];
  const needle = lowerByCodePoint(query).text;
  const { text, offsets } = lowerByCodePoint(source);
  const matches: NoteSearchMatch[] = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
    const from = offsets ? offsets[at] : at;
    const to = offsets ? offsets[at + needle.length] : at + needle.length;
    // A match inside one character's lowercase form (İ → i̇) doesn't line up with the source.
    if (from === undefined || to === undefined || from < 0 || to < 0) continue;
    matches.push({ from, to });
  }
  return matches;
};

/** The lowercase text, plus a map from its offsets to the source's when lowercasing changed a length. */
const lowerByCodePoint = (source: string): { text: string; offsets: number[] | null } => {
  const lower = source.toLowerCase();
  if (lower.length === source.length) return { text: lower, offsets: null };
  let text = "";
  const offsets: number[] = [];
  let index = 0;
  for (const char of source) {
    const piece = char.toLowerCase();
    offsets.push(index);
    for (let extra = 1; extra < piece.length; extra++) offsets.push(-1);
    text += piece;
    index += char.length;
  }
  offsets.push(index);
  return { text, offsets };
};
