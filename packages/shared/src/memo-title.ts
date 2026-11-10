/** Kept free of imports so server entry points loaded by Node can use it. */

export const DEFAULT_MEMO_TITLE = "Untitled note";

/** Written by earlier versions. Local mirrors can still hold it until they resync. */
const LEGACY_DEFAULT_MEMO_TITLE = "\u65e0\u6807\u9898\u7b14\u8bb0";

export const isDefaultMemoTitle = (title: string | null | undefined) =>
  title === DEFAULT_MEMO_TITLE || title === LEGACY_DEFAULT_MEMO_TITLE;

/**
 * Title to show for a note. Untitled notes are stored with the default title,
 * so it is replaced by the reader's localized label like an empty one.
 */
export const getMemoDisplayTitle = (title: string | null | undefined, untitledLabel: string) => {
  const trimmed = title?.trim() ?? "";
  return trimmed && !isDefaultMemoTitle(trimmed) ? trimmed : untitledLabel;
};
