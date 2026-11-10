/**
 * CSS safety filter and scope limiter
 */

import { sanitizeNoteProseDeclarationBlock } from "@ponder/shared";

const sanitizeRulesBlock = (block: string): string => sanitizeNoteProseDeclarationBlock(block);

const scopeSelector = (selector: string): string => {
  const trimmed = selector.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith(".ProseMirror") || trimmed.includes(".ponder-editor")) return trimmed;
  const dark = trimmed.match(/^(?:html\.dark|:root\.dark)\s+(.+)$/);
  if (dark) return `:root.dark .ponder-editor .ProseMirror ${dark[1]}`;
  return `.ponder-editor .ProseMirror ${trimmed}`;
};

/**
 * Filters user CSS for safety and scopes it to the current editor ProseMirror area.
 * :root.dark stays outside the scope, so dark rules follow the app theme.
 */
export const sanitizeAndScopeCss = (css: string): string => {
  if (!css) return "";

  let cleaned = css
    .replace(/@import/gi, "")
    .replace(/@charset/gi, "")
    .replace(/@namespace/gi, "");

  cleaned = cleaned.replace(/([^{]+)({[^}]+})/g, (_, selectors, blockContent) => {
    const rawRules = blockContent.slice(1, -1);
    const safeRules = sanitizeRulesBlock(rawRules);
    if (!safeRules) return "";

    const scopedSelectors = selectors
      .split(",")
      .map((selector: string) => scopeSelector(selector))
      .filter(Boolean)
      .join(", ");

    return scopedSelectors ? `${scopedSelectors} { ${safeRules} }` : "";
  });

  return cleaned;
};

/** Class on the settings sample. Dark rules bind here instead of :root, so the sample does not follow the app theme. */
export const NOTE_PROSE_CSS_PREVIEW_DARK_CLASS = "note-prose-css-preview-dark";

export const previewNoteProseCss = (css: string): string =>
  sanitizeAndScopeCss(css).replaceAll(":root.dark", `.${NOTE_PROSE_CSS_PREVIEW_DARK_CLASS}`);

/**
 * Parses user CSS and extracts a tag style map that WeChat and rich-text copy can apply directly
 */
export const parseCustomCssToStyles = (css: string): Record<string, string> => {
  const stylesMap: Record<string, string> = {};
  if (!css) return stylesMap;

  // Match selectors and rule bodies with a simple regular expression
  const regex = /([^{]+){([^}]+)}/g;
  let match;

  while ((match = regex.exec(css)) !== null) {
    const selectors = match[1].split(",");
    const rawRules = match[2];
    const safeRules = sanitizeRulesBlock(rawRules);

    if (!safeRules) continue;

    selectors.forEach((sel) => {
      const key = sel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").trim().toLowerCase();
      // Only keep plain tag selectors (h1, p, blockquote and so on), which WeChat copy can inline directly
      if (/^[a-z0-9]+$/i.test(key)) {
        if (stylesMap[key]) {
          stylesMap[key] = `${stylesMap[key]} ${safeRules}`;
        } else {
          stylesMap[key] = safeRules;
        }
      }
    });
  }

  return stylesMap;
};
