/*
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0.
 * Source: src/components/_shared/emoji-picker/EmojiPicker.hooks.ts (`useLoadEmojiData`: reading
 * emoji-mart's categories into {id, name, native} lists filtered by name and keywords, and
 * `getRowsWithCategories`: a category title row followed by rows of emojis, for the virtual list).
 * Ponder ranks matches for the `:` menu (Notion lists the closest names first) and keeps Recent.
 *
 * Emoji data: @emoji-mart/data (MIT, Copyright (c) 2022 Missive), loaded only when the picker opens.
 */

export type Emoji = { id: string; name: string; native: string; keywords: string[] };
export type EmojiCategory = { id: string; emojis: Emoji[] };

/** Notion's `:` menu: 12 a row, up to 35 matches, after two letters. */
export const EMOJI_COLUMNS = 12;
export const MAX_EMOJI_MATCHES = 35;
export const MIN_EMOJI_QUERY = 2;
const MAX_RECENT = 24;
const RECENT_KEY = "ponder.emoji.recent";

type EmojiMartData = {
  categories: Array<{ id: string; emojis: string[] }>;
  emojis: Record<string, { id: string; name: string; keywords?: string[]; skins: Array<{ native: string }> }>;
};

let loaded: Promise<EmojiCategory[]> | null = null;

export const toEmojiCategories = (data: EmojiMartData): EmojiCategory[] =>
  data.categories.map((category) => ({
    id: category.id,
    emojis: category.emojis.flatMap((id) => {
      const emoji = data.emojis[id];
      const native = emoji?.skins[0]?.native;
      return emoji && native ? [{ id, name: emoji.name, native, keywords: emoji.keywords ?? [] }] : [];
    }),
  }));

/** The emoji list, fetched once per page load. */
export const loadEmojiCategories = () => {
  loaded ??= import("@emoji-mart/data/sets/15/native.json")
    .then((module) => toEmojiCategories((module.default ?? module) as unknown as EmojiMartData))
    .catch((error) => {
      loaded = null;
      throw error;
    });
  return loaded;
};

/** How well an emoji matches: lower is better, null for no match. */
const rank = (emoji: Emoji, query: string): number | null => {
  const id = emoji.id.toLowerCase();
  const name = emoji.name.toLowerCase();
  if (id === query || name === query) return 0;
  if (id.startsWith(query) || name.startsWith(query)) return 1;
  if (name.split(/[\s_-]+/).some((word) => word.startsWith(query)) || id.split(/[_-]+/).some((word) => word.startsWith(query))) return 2;
  if (emoji.keywords.some((keyword) => keyword.toLowerCase().startsWith(query))) return 3;
  if (name.includes(query) || emoji.keywords.some((keyword) => keyword.toLowerCase().includes(query))) return 4;
  return null;
};

/** The emojis for `:query`, closest first, in the data's order within a rank. */
export const searchEmojis = (categories: readonly EmojiCategory[], rawQuery: string, limit = MAX_EMOJI_MATCHES): Emoji[] => {
  const query = rawQuery.trim().toLowerCase().replace(/^:+|:+$/g, "");
  if (!query) return [];
  const ranked: Array<{ emoji: Emoji; score: number; order: number }> = [];
  let order = 0;
  for (const category of categories) {
    for (const emoji of category.emojis) {
      const score = rank(emoji, query);
      if (score !== null) ranked.push({ emoji, score, order });
      order += 1;
    }
  }
  return ranked.sort((a, b) => a.score - b.score || a.order - b.order).slice(0, limit).map((item) => item.emoji);
};

export type EmojiRow = { id: string; type: "category"; category: string } | { id: string; type: "emojis"; category: string; emojis: Emoji[] };

/** A title row per category, then its emojis in rows of `rowSize`. */
export const getRowsWithCategories = (categories: readonly EmojiCategory[], rowSize = EMOJI_COLUMNS): EmojiRow[] => {
  const rows: EmojiRow[] = [];
  for (const category of categories) {
    if (!category.emojis.length) continue;
    rows.push({ id: category.id, type: "category", category: category.id });
    for (let index = 0; index < category.emojis.length; index += rowSize) {
      rows.push({ id: `${category.id}-${index / rowSize}`, type: "emojis", category: category.id, emojis: category.emojis.slice(index, index + rowSize) });
    }
  }
  return rows;
};

/** Emojis this browser picked last, most recent first. */
export const readRecentEmojis = (): string[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
};

export const rememberEmoji = (native: string) => {
  try {
    const next = [native, ...readRecentEmojis().filter((value) => value !== native)].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Recent emojis are a convenience; the pick itself still goes in.
  }
};

/** Recent first, then every category, for the full picker that `/emoji` opens. */
export const withRecent = (categories: readonly EmojiCategory[], recent: readonly string[]): EmojiCategory[] => {
  if (!recent.length) return [...categories];
  const byNative = new Map<string, Emoji>();
  for (const category of categories) for (const emoji of category.emojis) if (!byNative.has(emoji.native)) byNative.set(emoji.native, emoji);
  const emojis = recent.flatMap((native) => byNative.get(native) ?? []);
  return emojis.length ? [{ id: "recent", emojis }, ...categories] : [...categories];
};
