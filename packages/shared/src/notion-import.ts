import { strFromU8, unzipSync } from "fflate";
import { DATABASE_ROW_LIMIT, type DatabaseDateValue, type DatabasePropertyType } from "./database";

/**
 * Reads the "Markdown & CSV" export from Notion. Pages are `Name <32 hex>.md`, their children live in a
 * folder of the same stem, and a database is `Name <32 hex>.csv` with one Markdown file per row beside it.
 */

const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 200 * 1024 * 1024;

export type NotionColumn = {
  name: string;
  type: DatabasePropertyType;
  options: string[];
  /** Key of the database this column points at, when it is a relation. */
  relationTo: string | null;
};
export type NotionRow = { title: string; cells: string[]; pageKey: string | null };
export type NotionPage = { kind: "page"; key: string; id: string | null; title: string; parentKey: string | null; dir: string; markdown: string; rowOf: string | null };
export type NotionDatabase = { kind: "database"; key: string; id: string | null; title: string; parentKey: string | null; columns: NotionColumn[]; rows: NotionRow[] };
export type NotionPlan = {
  /** Parents always come before their children. */
  entries: (NotionPage | NotionDatabase)[];
  assets: Map<string, Uint8Array>;
  warnings: string[];
};

export class NotionImportError extends Error {}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const dirName = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const stemOf = (path: string) => path.replace(/(_all)?\.(md|csv)$/i, "");
const depthOf = (path: string) => path.split("/").length;

const parseName = (stem: string) => {
  const name = baseName(stem);
  const match = /^(.*?)\s*\b([0-9a-f]{32})$/i.exec(name);
  return match ? { title: match[1]!.trim() || "Untitled", id: match[2]!.toLowerCase() } : { title: name.trim() || "Untitled", id: null };
};

const collectFiles = (archive: Uint8Array, files: Map<string, Uint8Array>, budget: { left: number }) => {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archive, {
      filter: (file) => {
        if (file.originalSize > MAX_FILE_BYTES) throw new NotionImportError(`${file.name} is too large to import.`);
        budget.left -= file.originalSize;
        if (budget.left < 0) throw new NotionImportError("This export is too large to import in one go.");
        return !file.name.endsWith("/") && !file.name.startsWith("__MACOSX/") && !file.name.endsWith(".DS_Store");
      },
    });
  } catch (error) {
    if (error instanceof NotionImportError) throw error;
    throw new NotionImportError("That file isn't a readable zip archive.");
  }
  for (const [path, data] of Object.entries(entries)) {
    // Big exports arrive as a zip of zips.
    if (/\.zip$/i.test(path)) collectFiles(data, files, budget);
    else files.set(path.normalize("NFC"), data);
  }
};

export const parseCsv = (input: string): string[][] => {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else cell += character;
  }
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
};

const pad = (value: number) => String(value).padStart(2, "0");
const parseOneDate = (raw: string): string | null => {
  const text = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (!/^(?:[A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}\/\d{1,2}\/\d{4})/.test(text)) return null;
  const date = new Date(text.replace(/\s*\([^)]*\)\s*$/, ""));
  return Number.isNaN(date.getTime()) ? null : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const parseNotionDate = (raw: string): DatabaseDateValue | null => {
  const [start, end] = raw.split(/\s*→\s*/);
  const startDate = parseOneDate(start ?? "");
  if (!startDate) return null;
  const endDate = end ? parseOneDate(end) : null;
  return endDate ? { start: startDate, end: endDate } : { start: startDate };
};

const splitList = (value: string) => value.split(/,\s+/).map(stripNotionUrl).filter(Boolean);
const stripNotionUrl = (value: string) => value.replace(/\s*\(https?:\/\/(?:www\.)?notion\.so\/[^)]*\)\s*$/, "").trim();
const isNumber = (value: string) => /^-?[\d,]*\.?\d+$/.test(value);
const isUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const inferColumn = (name: string, cells: string[]): NotionColumn => {
  const values = cells.map((cell) => cell.trim()).filter(Boolean);
  const column = (type: DatabasePropertyType, options: string[] = []): NotionColumn => ({ name, type, options, relationTo: null });
  if (values.length === 0) return column("text");
  if (values.every((value) => value === "Yes" || value === "No")) return column("checkbox");
  if (values.every(isNumber)) return column("number");
  if (values.every((value) => parseNotionDate(value))) return column("date");
  if (values.every(isUrl)) return column("url");
  if (values.every(isEmail)) return column("email");
  const whole = [...new Set(values)];
  const parts = values.flatMap(splitList);
  const distinctParts = [...new Set(parts)];
  const shortLabels = distinctParts.every((part) => part.length <= 60);
  if (/^status$/i.test(name) && whole.length <= 20 && whole.every((value) => value.length <= 60)) return column("status", whole);
  const repeats = parts.length > distinctParts.length || values.length <= 3;
  if (shortLabels && distinctParts.length <= 40 && repeats) {
    return values.some((value) => splitList(value).length > 1) ? column("multi_select", distinctParts) : column("select", whole);
  }
  return column("text");
};

const statusGroup = (name: string): "todo" | "in_progress" | "done" => {
  if (/done|complete|finished|shipped|closed/i.test(name)) return "done";
  if (/progress|doing|started|active|review/i.test(name)) return "in_progress";
  return "todo";
};
export const notionStatusGroup = statusGroup;

const normalizeTitle = (title: string) => title.trim().toLowerCase();
const firstHeading = (markdown: string) => /^\s*#\s+(.+?)\s*$/m.exec(markdown.split("\n").slice(0, 5).join("\n"))?.[1] ?? null;

/** Drops the title Notion repeats at the top of the file, and the property list on a row page. */
const stripHeader = (markdown: string, columns: Set<string>) => {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  const skipBlank = () => { while (index < lines.length && !lines[index]!.trim()) index += 1; };
  skipBlank();
  if (/^#\s/.test(lines[index] ?? "")) index += 1;
  skipBlank();
  if (columns.size > 0) {
    while (index < lines.length && columns.has(/^([^:]+):/.exec(lines[index]!)?.[1]?.trim() ?? "")) index += 1;
    skipBlank();
  }
  return lines.slice(index).join("\n");
};

/** The "Name: value" lines under a row page's title, for a row the table itself doesn't list. */
const rowProperties = (markdown: string, columns: Set<string>) => {
  const values = new Map<string, string>();
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length && (!lines[index]!.trim() || /^#\s/.test(lines[index]!))) index += 1;
  for (; index < lines.length; index += 1) {
    const match = /^([^:]+):\s?(.*)$/.exec(lines[index]!);
    const name = match?.[1]?.trim() ?? "";
    if (!match || !columns.has(name)) break;
    values.set(name, match[2]!.trim());
  }
  return values;
};

const inferRelations = (databases: NotionDatabase[]) => {
  const titles = new Map(databases.map((database) => [database.key, new Set(database.rows.map((row) => normalizeTitle(row.title)))]));
  for (const database of databases) {
    database.columns.forEach((column, columnIndex) => {
      if (columnIndex === 0 || !["text", "select", "multi_select"].includes(column.type)) return;
      const parts = database.rows.flatMap((row) => splitList(row.cells[columnIndex] ?? "")).map(normalizeTitle);
      if (parts.length === 0) return;
      const matches = databases.filter((candidate) => {
        const known = titles.get(candidate.key)!;
        return known.size > 0 && parts.filter((part) => known.has(part)).length / parts.length >= 0.9;
      });
      if (matches.length !== 1) return;
      column.type = "relation";
      column.options = [];
      column.relationTo = matches[0]!.key;
    });
  }
};

export const buildNotionPlan = (archive: Uint8Array): NotionPlan => {
  const files = new Map<string, Uint8Array>();
  collectFiles(archive, files, { left: MAX_TOTAL_BYTES });
  const warnings: string[] = [];
  const assets = new Map<string, Uint8Array>();
  const csvFiles = new Map<string, string>();
  const markdownFiles: string[] = [];

  for (const path of [...files.keys()].sort()) {
    if (/\.md$/i.test(path)) markdownFiles.push(path);
    else if (/\.csv$/i.test(path)) {
      // Notion may write both; `_all` includes the rows the saved view filtered out.
      const stem = stemOf(path);
      if (/_all\.csv$/i.test(path) || !csvFiles.has(stem)) csvFiles.set(stem, path);
    } else assets.set(path, files.get(path)!);
  }
  if (markdownFiles.length === 0 && csvFiles.size === 0) {
    throw new NotionImportError("This doesn't look like a Notion Markdown & CSV export.");
  }

  const databases: NotionDatabase[] = [];
  const databaseColumns = new Map<string, Set<string>>();
  const known = new Set<string>([...csvFiles.keys(), ...markdownFiles.map(stemOf)]);
  // Newer exports name a page's folder without its id ("Task List/" beside "Task List <id>.csv"),
  // so each folder also answers to its page's name without the id, unless two pages there share that name.
  const byFolderName = new Map<string, string | null>();
  for (const stem of known) {
    const { title, id } = parseName(stem);
    if (!id) continue;
    const folder = dirName(stem) ? `${dirName(stem)}/${baseName(stem).slice(0, baseName(stem).length - id.length).trim()}` : baseName(stem).slice(0, -id.length).trim();
    if (!folder || folder === stem || !title) continue;
    byFolderName.set(folder, byFolderName.has(folder) && byFolderName.get(folder) !== stem ? null : stem);
  }
  const parentOf = (stem: string) => {
    for (let dir = dirName(stem); dir; dir = dirName(dir)) {
      if (known.has(dir)) return dir;
      const named = byFolderName.get(dir);
      if (named) return named;
    }
    return null;
  };

  for (const [stem, path] of csvFiles) {
    const [header, ...records] = parseCsv(strFromU8(files.get(path)!));
    const { title, id } = parseName(stem);
    if (!header || header.length === 0) {
      warnings.push(`${title}: the table was empty.`);
      continue;
    }
    if (records.length > DATABASE_ROW_LIMIT) warnings.push(`${title}: only the first ${DATABASE_ROW_LIMIT} rows were imported.`);
    const kept = records.slice(0, DATABASE_ROW_LIMIT);
    const names = header.map((name, index) => name.trim() || `Column ${index + 1}`);
    const unique = names.map((name, index) => (names.indexOf(name) === index ? name : `${name} ${index + 1}`));
    const columns = unique.map((name, index) => {
      if (index === 0) return { name, type: "title" as const, options: [], relationTo: null };
      return inferColumn(name, kept.map((record) => record[index] ?? ""));
    });
    databases.push({
      kind: "database", key: stem, id, title, parentKey: parentOf(stem), columns,
      rows: kept.map((record) => ({ title: record[0]?.trim() || "Untitled", cells: unique.map((_, index) => record[index] ?? ""), pageKey: null })),
    });
    databaseColumns.set(stem, new Set(unique));
  }

  const byDatabase = new Map(databases.map((database) => [database.key, database]));
  const pages: NotionPage[] = markdownFiles.map((path) => {
    const stem = stemOf(path);
    const text = strFromU8(files.get(path)!);
    const parsed = parseName(stem);
    const parentKey = parentOf(stem);
    const database = parentKey ? byDatabase.get(parentKey) : undefined;
    const title = firstHeading(text) ?? parsed.title;
    const page: NotionPage = {
      kind: "page", key: stem, id: parsed.id, title, parentKey, dir: dirName(path),
      markdown: stripHeader(text, database ? databaseColumns.get(database.key)! : new Set()),
      rowOf: database?.key ?? null,
    };
    if (database) {
      const row = database.rows.find((item) => !item.pageKey && normalizeTitle(item.title) === normalizeTitle(title));
      if (row) row.pageKey = stem;
      else {
        const values = rowProperties(text, databaseColumns.get(database.key)!);
        database.rows.push({ title, cells: database.columns.map((column, index) => (index === 0 ? title : values.get(column.name) ?? "")), pageKey: stem });
      }
    }
    return page;
  });

  inferRelations(databases);
  const depth = (entry: { key: string }) => depthOf(entry.key);
  return { entries: [...databases, ...pages].sort((left, right) => depth(left) - depth(right)), assets, warnings };
};

const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const LINK = /(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g;

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const resolvePath = (dir: string, target: string) => {
  const segments = (dir ? dir.split("/") : []);
  for (const part of safeDecode(target.split(/[?#]/)[0]!).normalize("NFC").split("/")) {
    if (part === "..") segments.pop();
    else if (part && part !== ".") segments.push(part);
  }
  return segments.join("/");
};

export type NotionTargets = {
  /** Key → the created page, for a Markdown or CSV path. */
  byKey: Map<string, { memoId: string; databaseId?: string; title: string; parentKey: string | null }>;
  byNotionId: Map<string, string>;
  assetUrls: Map<string, string>;
};

/** Every local file a page refers to, so they can be uploaded before the body is written. */
export const notionAssetRefs = (page: NotionPage, assets: Map<string, Uint8Array>) => {
  const found = new Set<string>();
  for (const match of page.markdown.matchAll(LINK)) {
    const path = resolvePath(page.dir, match[3]!.trim().replace(/\s+"[^"]*"$/, ""));
    if (assets.has(path)) found.add(path);
  }
  return [...found];
};

const blockForTarget = (page: NotionPage, target: NonNullable<ReturnType<NotionTargets["byKey"]["get"]>>) => {
  if (target.parentKey !== page.key) return null;
  return target.databaseId
    ? `<ponder-database id="${escapeAttr(target.databaseId)}"></ponder-database>`
    : `<ponder-page id="${escapeAttr(target.memoId)}">${escapeAttr(target.title)}</ponder-page>`;
};

/** Rewrites Notion's relative links, callouts and child-page lines into this app's Markdown. */
export const renderNotionBody = (page: NotionPage, targets: NotionTargets, memoLink: (memoId: string) => string) => {
  const lookup = (raw: string) => {
    const external = /notion\.so\/.*?([0-9a-f]{32})/i.exec(raw)?.[1]?.toLowerCase();
    if (external) return targets.byKey.get(targets.byNotionId.get(external) ?? "") ?? null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
    return targets.byKey.get(stemOf(resolvePath(page.dir, raw))) ?? null;
  };

  const rewrite = (segment: string) => segment
    .replace(/<aside>\s*([\s\S]*?)\s*<\/aside>/g, (_all, inner: string) => {
      const emoji = /^(\p{Extended_Pictographic}\S*)\s*/u.exec(inner);
      const body = emoji ? inner.slice(emoji[0].length) : inner;
      return `\n<ponder-callout icon="${escapeAttr(emoji?.[1] ?? "💡")}" color="gray">\n\n${body.trim()}\n\n</ponder-callout>\n`;
    })
    .split("\n")
    .map((line) => {
      const whole = /^\s*\[([^\]\n]*)\]\(([^)\n]+)\)\s*$/.exec(line);
      if (whole) {
        const target = lookup(whole[2]!.trim());
        const block = target ? blockForTarget(page, target) : null;
        if (block) return `\n${block}\n`;
      }
      return line.replace(LINK, (all, bang: string, text: string, rawTarget: string) => {
        const raw = rawTarget.trim().replace(/\s+"[^"]*"$/, "");
        const asset = targets.assetUrls.get(resolvePath(page.dir, raw));
        if (asset) return `${bang}[${text}](${asset})`;
        if (bang) return all;
        const target = lookup(raw);
        return target ? `[${text}](${memoLink(target.memoId)})` : all;
      });
    })
    .join("\n");

  return page.markdown
    .split(/(```[\s\S]*?```)/g)
    .map((segment, index) => (index % 2 === 1 ? segment : rewrite(segment)))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const notionCellValue = (column: NotionColumn, raw: string, optionIds: Map<string, string>) => {
  const value = raw.trim();
  if (!value) return null;
  switch (column.type) {
    case "number": return Number(value.replace(/,/g, ""));
    case "checkbox": return value === "Yes";
    case "date": return parseNotionDate(value);
    case "select":
    case "status": return optionIds.get(value) ?? null;
    case "multi_select": return splitList(value).flatMap((part) => optionIds.get(part) ?? []);
    case "relation": return null;
    default: return value;
  }
};

export const notionRelationTitles = (raw: string) => splitList(raw).map(normalizeTitle);
export const notionNormalizeTitle = normalizeTitle;
