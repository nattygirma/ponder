import { describe, expect, test } from "bun:test";
import { findLiteralMatches } from "./literal-search";
import { getMarkdownSearchMatches } from "./markdown-source-search";

// Find-in-note no longer loads CodeMirror for Markdown mode; its results must match CodeMirror's.
describe("literal search without CodeMirror", () => {
  const cases = [
    [String.raw`\\alpha \[link\](url) **bold** $& \\beta`, "\\\\"],
    [String.raw`\\alpha \[link\](url) **bold** $& \\beta`, "**"],
    ["a\\nb\na\\nb", String.raw`\n`],
    [" a  b ", " "],
    ["Aa aa AA", "aa"],
    ["😀aaaa", "aa"],
    ["line one\nLine two\nLINE three", "line"],
    ["İstanbul and istanbul", "stan"],
    ["Straße STRASSE", "straße"],
    ["Ünïcödé ünïcödé", "ÜNÏ"],
    ["anything", ""],
    ["nothing here", "missing"],
  ];
  for (const [source, query] of cases) {
    test(`${JSON.stringify(query)} in ${JSON.stringify(source)}`, () => {
      expect(findLiteralMatches(source, query)).toEqual(getMarkdownSearchMatches(source, query));
    });
  }
});
