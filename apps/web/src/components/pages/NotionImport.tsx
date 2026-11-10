import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildNotionPlan,
  createMemoLinkHref,
  DATABASE_OPTION_COLORS,
  markdownToDoc,
  notionAssetRefs,
  NotionImportError,
  notionCellValue,
  notionNormalizeTitle,
  notionRelationTitles,
  notionStatusGroup,
  renderNotionBody,
  type DatabaseOption,
  type DatabaseProperty,
  type DatabasePropertyValue,
  type NotionDatabase,
  type NotionPage,
  type NotionPlan,
  type NotionTargets,
} from "@ponder/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";

const OPEN_EVENT = "ponder:notion-import";
const BODY_CONCURRENCY = 4;

export const openNotionImport = () => window.dispatchEvent(new Event(OPEN_EVENT));

type Report = { pages: number; databases: number; issues: string[] };
type Progress = { done: number; total: number };

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf" };
const fileFor = (path: string, data: Uint8Array) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return new File([data.slice().buffer as ArrayBuffer], name, { type: MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream" });
};

const createDatabase = async (entry: NotionDatabase, parent: { notebookId?: string; parentId?: string }) => {
  const { database } = await api.createDatabase({ ...parent, title: entry.title.slice(0, 160) });
  const titleProperty = database.schema.properties.find((property) => property.type === "title")!;
  const optionIds = new Map<string, Map<string, string>>();
  const properties: DatabaseProperty[] = entry.columns.map((column, index) => {
    if (index === 0) return { ...titleProperty, name: column.name.slice(0, 120) };
    const id = `prop_${index}`;
    const ids = new Map<string, string>();
    optionIds.set(id, ids);
    const options: DatabaseOption[] = column.options.slice(0, 500).map((name, optionIndex) => {
      const optionId = `opt_${index}_${optionIndex}`;
      ids.set(name, optionId);
      return {
        id: optionId,
        name: name.slice(0, 120),
        color: DATABASE_OPTION_COLORS[optionIndex % DATABASE_OPTION_COLORS.length]!,
        ...(column.type === "status" ? { group: notionStatusGroup(name) } : {}),
      };
    });
    return {
      id,
      name: column.name.slice(0, 120),
      type: column.type,
      ...(column.options.length > 0 ? { options } : {}),
    } as DatabaseProperty;
  });
  return { database, properties, optionIds, titleId: titleProperty.id };
};

const runImport = async (plan: NotionPlan, notebookName: string, onProgress: (progress: Progress) => void, issue: (title: string) => string): Promise<Report> => {
  const notebook = await api.createNotebook({ name: notebookName });
  const notebookId = (notebook as unknown as { notebook?: { id: string }; id?: string }).notebook?.id ?? (notebook as unknown as { id: string }).id;
  const issues = [...plan.warnings];
  const rowCount = plan.entries.reduce((sum, entry) => sum + (entry.kind === "database" ? entry.rows.length : 0), 0);
  const pageEntries = plan.entries.filter((entry): entry is NotionPage => entry.kind === "page");
  const total = plan.entries.length + rowCount + pageEntries.length;
  let done = 0;
  const step = () => { done += 1; onProgress({ done, total }); };

  const targets: NotionTargets = { byKey: new Map(), byNotionId: new Map(), assetUrls: new Map() };
  const prepared = new Map<string, Awaited<ReturnType<typeof createDatabase>>>();
  const rowIds = new Map<string, string>();
  const created = new Set<string>();
  let pages = 0;
  let databases = 0;

  const parentFor = (parentKey: string | null) => {
    const parent = parentKey ? targets.byKey.get(parentKey) : null;
    return parent ? { parentId: parent.memoId } : { notebookId };
  };

  // Parents first, so every page has somewhere to go. Row pages are made with their table.
  for (const entry of plan.entries) {
    if (entry.kind === "page" && entry.rowOf) continue;
    try {
      if (entry.kind === "database") {
        const made = await createDatabase(entry, parentFor(entry.parentKey));
        prepared.set(entry.key, made);
        targets.byKey.set(entry.key, { memoId: made.database.pageMemoId, databaseId: made.database.id, title: entry.title, parentKey: entry.parentKey });
        databases += 1;
      } else {
        const { memo } = await api.createPage({ ...parentFor(entry.parentKey), title: entry.title.slice(0, 160) });
        targets.byKey.set(entry.key, { memoId: memo.id, title: entry.title, parentKey: entry.parentKey });
        pages += 1;
      }
      created.add(entry.key);
      if (entry.id) targets.byNotionId.set(entry.id, entry.key);
    } catch {
      issues.push(issue(entry.title));
    }
    step();
  }

  const databaseEntries = plan.entries.filter((entry): entry is NotionDatabase => entry.kind === "database" && prepared.has(entry.key));
  // Relations can point at any table, so the schema goes in once they all exist.
  for (const entry of databaseEntries) {
    const made = prepared.get(entry.key)!;
    const properties = made.properties.map((property, index) => {
      const column = entry.columns[index]!;
      if (column.type !== "relation") return property;
      const target = column.relationTo ? prepared.get(column.relationTo) : undefined;
      return target ? { ...property, relation: { databaseId: target.database.id, syncedPropertyId: null } } : { ...property, type: "text" as const };
    });
    made.properties = properties;
    await api.updateDatabase(made.database.id, { schema: { properties } });
    const groupable = properties.find((property) => property.type === "status") ?? properties.find((property) => property.type === "select");
    if (groupable) await api.createDatabaseView(made.database.id, { name: "Board", type: "board", config: { groupByPropertyId: groupable.id } }).catch(() => undefined);
    const dated = properties.find((property) => property.type === "date");
    if (dated) await api.createDatabaseView(made.database.id, { name: "Calendar", type: "calendar", config: { datePropertyId: dated.id } }).catch(() => undefined);
  }

  const titleIndex = new Map<string, Map<string, string>>();
  for (const entry of databaseEntries) {
    const made = prepared.get(entry.key)!;
    const titles = new Map<string, string>();
    titleIndex.set(entry.key, titles);
    for (const row of entry.rows) {
      try {
        const values: Record<string, DatabasePropertyValue> = {};
        entry.columns.forEach((column, index) => {
          if (index === 0) return;
          const property = made.properties[index]!;
          const value = notionCellValue({ ...column, type: property.type }, row.cells[index] ?? "", made.optionIds.get(property.id) ?? new Map());
          if (value !== null && !(Array.isArray(value) && value.length === 0)) values[property.id] = value;
        });
        const created_ = await api.createDatabaseRow(made.database.id, { title: row.title.slice(0, 160), properties: values });
        titles.set(notionNormalizeTitle(row.title), created_.row.id);
        rowIds.set(`${entry.key}\u0000${notionNormalizeTitle(row.title)}`, created_.row.id);
        if (row.pageKey) {
          targets.byKey.set(row.pageKey, { memoId: created_.row.id, title: row.title, parentKey: entry.key });
          const page = pageEntries.find((item) => item.key === row.pageKey);
          if (page?.id) targets.byNotionId.set(page.id, row.pageKey);
          pages += 1;
        }
      } catch {
        issues.push(issue(row.title));
      }
      step();
    }
  }

  // Pages nested under a row can only be made once the row exists.
  for (const entry of pageEntries) {
    if (targets.byKey.has(entry.key) || !entry.parentKey || !targets.byKey.has(entry.parentKey)) continue;
    const { memo } = await api.createPage({ parentId: targets.byKey.get(entry.parentKey)!.memoId, title: entry.title.slice(0, 160) }).catch(() => ({ memo: null }));
    if (memo) {
      targets.byKey.set(entry.key, { memoId: memo.id, title: entry.title, parentKey: entry.parentKey });
      pages += 1;
    }
  }

  for (const entry of databaseEntries) {
    const made = prepared.get(entry.key)!;
    const relationColumns = entry.columns.flatMap((column, index) => (made.properties[index]!.type === "relation" && column.relationTo ? [{ column, index }] : []));
    if (relationColumns.length === 0) continue;
    for (const row of entry.rows) {
      const rowId = titleIndex.get(entry.key)!.get(notionNormalizeTitle(row.title));
      if (!rowId) continue;
      const properties: Record<string, DatabasePropertyValue> = {};
      for (const { column, index } of relationColumns) {
        const known = titleIndex.get(column.relationTo!);
        const ids = notionRelationTitles(row.cells[index] ?? "").flatMap((title) => known?.get(title) ?? []);
        if (ids.length > 0) properties[made.properties[index]!.id] = ids;
      }
      if (Object.keys(properties).length > 0) await api.updateDatabaseRow(made.database.id, rowId, { properties }).catch(() => issues.push(issue(row.title)));
    }
  }

  const queue = [...pageEntries];
  const writeBody = async () => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      const target = targets.byKey.get(entry.key);
      try {
        if (target && entry.markdown.trim()) {
          for (const path of notionAssetRefs(entry, plan.assets)) {
            if (targets.assetUrls.has(path)) continue;
            const uploaded = await api.uploadMemoResource(target.memoId, fileFor(path, plan.assets.get(path)!));
            targets.assetUrls.set(path, uploaded.resource.url);
          }
          const contentMarkdown = renderNotionBody(entry, targets, createMemoLinkHref);
          await api.updatePageFields(target.memoId, { contentMarkdown, contentJson: markdownToDoc(contentMarkdown) });
        }
      } catch {
        issues.push(issue(entry.title));
      }
      step();
    }
  };
  await Promise.all(Array.from({ length: BODY_CONCURRENCY }, writeBody));
  return { pages, databases, issues };
};

/** Mounted once; the sidebar menu opens it, because menu items unmount as soon as the menu closes. */
export const NotionImportHost = () => {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const show = () => { setReport(null); setError(null); setProgress(null); setOpen(true); };
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const start = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const plan = buildNotionPlan(new Uint8Array(await file.arrayBuffer()));
      setReport(await runImport(plan, t("pages.notionImport.notebook"), setProgress, (title) => t("pages.notionImport.failedItem", { title })));
    } catch (failure) {
      setError(failure instanceof NotionImportError ? failure.message : failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
      <DialogContent data-notion-import>
        <DialogHeader>
          <DialogTitle>{t("pages.notionImport.title")}</DialogTitle>
          <DialogDescription>{report ? t("pages.notionImport.done", { pages: report.pages, databases: report.databases }) : t("pages.notionImport.help")}</DialogDescription>
        </DialogHeader>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          aria-label={t("pages.notionImport.choose")}
          data-notion-import-file
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void start(file);
          }}
        />
        {busy ? (
          <div className="space-y-1 text-sm" role="status">
            <p>{progress ? t("pages.notionImport.working", { done: progress.done, total: progress.total }) : t("pages.notionImport.reading")}</p>
            <p className="text-xs text-slate-500">{t("pages.notionImport.warning")}</p>
          </div>
        ) : null}
        {error ? <p className="text-sm text-rose-600" role="alert">{error}</p> : null}
        {report ? (
          <div className="space-y-2 text-sm">
            <p className="text-xs text-slate-500">{t("pages.notionImport.limits")}</p>
            {report.issues.length > 0 ? (
              <div>
                <p className="font-medium">{t("pages.notionImport.issues")}</p>
                <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-xs text-slate-600">{report.issues.map((item, index) => <li key={index}>{item}</li>)}</ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          {report ? (
            <Button type="button" onClick={() => window.location.assign("/")}>{t("pages.notionImport.open")}</Button>
          ) : (
            <Button type="button" disabled={busy} onClick={() => input.current?.click()}>{t("pages.notionImport.choose")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
