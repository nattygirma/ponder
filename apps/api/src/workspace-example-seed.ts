import {
  createExcerpt,
  docToText,
  markdownToDoc,
  normalizeTags,
} from "@ponder/shared";
import {
  WELCOME_MEMO_SEED_CONTENT_HASH,
  WELCOME_MEMO_TRANSLATIONS,
  buildWelcomeMemoContent,
} from "@ponder/shared/default-workspace-seeds";
import { supportedLocales, type SupportedLocale } from "@ponder/shared/i18n/locales";
import { DEFAULT_MEMO_TEMPLATE_SEEDS, defaultMemoTemplateId } from "@ponder/shared/memo-template-seeds";
import type { DatabasePropertyValue, DatabaseSchema, DatabaseViewConfig, DatabaseViewType } from "@ponder/shared";
import type { Bindings } from "./api-context";
import { isDemoModeEnabled } from "./demo-mode";
import { isoNow } from "./entity-utils";
import { sha256 } from "./hash-utils";
import { upsertMemoSearchDocumentStatement } from "./memo-search-index";
import type { DatabaseAdapter, PreparedStatementAdapter } from "./storage-contract";

const WELCOME_MEMO_ID = "memo_welcome";
const POSITION_GAP = 1024;

// Folders the installation creates. A new account starts with pages rather than these.
const UNUSED_DEFAULT_NOTEBOOK_SLUGS = ["work-projects", "learning-resources", "creative-ideas", "personal-life"];

type StarterRow = { key: string; title: string; properties: Record<string, DatabasePropertyValue>; markdown?: string };
type StarterPage = {
  key: string;
  title: string;
  icon: string;
  markdown?: (link: (key: string, title: string) => string) => string;
  database?: {
    schema: DatabaseSchema;
    views: Array<{ name: string; type: DatabaseViewType; config: DatabaseViewConfig }>;
    rows: StarterRow[];
  };
};

const STATUS = "status";
const statusProperty = (options: [string, string, string]) => ({
  id: STATUS,
  name: "Status",
  type: "status" as const,
  options: [
    { id: "todo", name: options[0], color: "gray" as const, group: "todo" as const },
    { id: "doing", name: options[1], color: "blue" as const, group: "in_progress" as const },
    { id: "done", name: options[2], color: "green" as const, group: "done" as const },
  ],
});

const starterPages = (today: string): StarterPage[] => [
  {
    key: "getting_started",
    title: "Getting Started",
    icon: "👋",
    markdown: () => [
      "Welcome! This page is yours to change or delete.",
      "## Try these first",
      [
        "- [ ] Click below this list and start typing",
        "- [ ] Type / to add a heading, a list, a table or a database",
        "- [ ] Select some text to format it or leave a comment",
        "- [ ] Hover over a line and drag its handle to move it",
        "- [ ] Press Cmd or Ctrl + K to find any page",
      ].join("\n"),
      "## Coming from Notion?",
      "Export your workspace as Markdown & CSV, then choose **Import from Notion** on Home. Your pages, nesting and databases come across.",
    ].join("\n\n"),
  },
  {
    key: "reading_list",
    title: "Reading List",
    icon: "📚",
    database: {
      schema: {
        properties: [
          { id: "title", name: "Name", type: "title" },
          statusProperty(["To read", "Reading", "Finished"]),
          {
            id: "kind",
            name: "Type",
            type: "select",
            options: [
              { id: "book", name: "Book", color: "orange" },
              { id: "article", name: "Article", color: "blue" },
              { id: "video", name: "Video", color: "red" },
              { id: "podcast", name: "Podcast", color: "purple" },
            ],
          },
          { id: "link", name: "Link", type: "url" },
        ],
      },
      views: [{ name: "Table", type: "table", config: {} }],
      rows: [
        { key: "first", title: "A book you keep meaning to read", properties: { [STATUS]: "todo", kind: "book" } },
        { key: "second", title: "An article you saved for later", properties: { [STATUS]: "doing", kind: "article" } },
      ],
    },
  },
  {
    key: "task_list",
    title: "Task List",
    icon: "✅",
    database: {
      schema: {
        properties: [
          { id: "title", name: "Name", type: "title" },
          statusProperty(["To do", "In progress", "Done"]),
          { id: "due", name: "Due", type: "date" },
        ],
      },
      views: [
        { name: "Board", type: "board", config: { groupByPropertyId: STATUS } },
        { name: "Table", type: "table", config: {} },
      ],
      rows: [
        { key: "first", title: "Import your pages", properties: { [STATUS]: "todo" } },
        { key: "second", title: "Add your first real task", properties: { [STATUS]: "doing" } },
        { key: "third", title: "Open this workspace", properties: { [STATUS]: "done", due: { start: today } } },
      ],
    },
  },
  {
    key: "journal",
    title: "Journal",
    icon: "📓",
    database: {
      schema: {
        properties: [
          { id: "title", name: "Name", type: "title" },
          { id: "date", name: "Date", type: "date" },
        ],
      },
      views: [{ name: "Entries", type: "table", config: { sorts: [{ propertyId: "date", direction: "desc" }] } }],
      rows: [{
        key: "first",
        title: "First entry",
        properties: { date: { start: today } },
        markdown: "What happened today, and what do you want to remember about it?",
      }],
    },
  },
  {
    key: "quick_note",
    title: "Quick Note",
    icon: "📝",
    markdown: () => "Somewhere to get a thought down fast. Sort it out later.",
  },
  {
    key: "personal_home",
    title: "Personal Home",
    icon: "🏠",
    markdown: (link) => [
      "The things you come back to most.",
      "## Shortcuts",
      [
        `- ${link("task_list", "Task List")}`,
        `- ${link("reading_list", "Reading List")}`,
        `- ${link("journal", "Journal")}`,
        `- ${link("quick_note", "Quick Note")}`,
      ].join("\n"),
      "## This week",
      "- [ ] Pick one thing to finish",
    ].join("\n\n"),
  },
];

export const markWorkspaceExampleSeedPendingStatement = (
  db: DatabaseAdapter,
  workspaceId: string,
  now = isoNow(),
): PreparedStatementAdapter => db.prepare(
  `INSERT OR IGNORE INTO workspace_example_seeds (workspace_id, created_at) VALUES (?, ?)`,
).bind(workspaceId, now);

const knownWelcomeContentHashes = async () => {
  const hashes = new Set<string>([
    WELCOME_MEMO_SEED_CONTENT_HASH,
    ]);
  for (const locale of supportedLocales) {
    const welcome = buildWelcomeMemoContent(locale);
    hashes.add(await sha256(welcome.contentMarkdown + welcome.contentJson));
  }
  return hashes;
};

const knownWelcomeTitles = new Set(
  (Object.keys(WELCOME_MEMO_TRANSLATIONS) as SupportedLocale[])
    .map((locale) => WELCOME_MEMO_TRANSLATIONS[locale].title),
);

type WelcomeRow = {
  id: string;
  is_deleted: number;
  created_by: string;
  updated_by: string;
  title: string | null;
  content_hash: string | null;
};

const workspaceStillWantsExamples = async (
  db: DatabaseAdapter,
  workspaceId: string,
) => {
  const memos = (await db.prepare(
    `SELECT m.id, m.is_deleted, m.created_by, m.updated_by, m.title, c.content_hash
     FROM memos m
     LEFT JOIN memo_contents c ON c.memo_id = m.id
     WHERE m.workspace_id = ?`,
  ).bind(workspaceId).all<WelcomeRow>()).results;

  if (memos.length === 0) return true;

  const welcomeHashes = await knownWelcomeContentHashes();
  return memos.length === 1
    && memos[0].id === WELCOME_MEMO_ID
    && memos[0].is_deleted === 0
    && memos[0].created_by === "system"
    && memos[0].updated_by === "system"
    && knownWelcomeTitles.has(memos[0].title ?? "")
    && welcomeHashes.has(memos[0].content_hash ?? "");
};

const clearPending = (db: DatabaseAdapter, workspaceId: string) => db.prepare(
  `DELETE FROM workspace_example_seeds WHERE workspace_id = ?`,
).bind(workspaceId).run();

const idsAreFree = async (db: DatabaseAdapter, table: string, ids: string[]) => {
  if (ids.length === 0) return true;
  const row = await db.prepare(
    `SELECT id FROM ${table} WHERE id IN (${ids.map(() => "?").join(", ")}) LIMIT 1`,
  ).bind(...ids).first<{ id: string }>();
  return !row;
};

export const ensureWorkspaceExampleSeed = async (env: Bindings, workspaceId: string) => {
  const db = env.storage.db;
  const pending = await db.prepare(
    `SELECT workspace_id FROM workspace_example_seeds WHERE workspace_id = ?`,
  ).bind(workspaceId).first<{ workspace_id: string }>();
  if (!pending) return;

  const demoOwnsTheCatalog = isDemoModeEnabled(env.PONDER_DEMO_MODE)
    || isDemoModeEnabled(env.PONDER_LOCAL_DEMO_SEED);
  if (demoOwnsTheCatalog || !await workspaceStillWantsExamples(db, workspaceId)) {
    await clearPending(db, workspaceId);
    return;
  }

  const inbox = await db.prepare(
    `SELECT id FROM notebooks
     WHERE workspace_id = ? AND is_deleted = 0 AND parent_id IS NULL
       AND (slug = 'inbox' OR id = 'nb_inbox' OR id = ?)
     LIMIT 1`,
  ).bind(workspaceId, `${workspaceId}_inbox`).first<{ id: string }>();
  if (!inbox) {
    await clearPending(db, workspaceId);
    return;
  }

  const welcome = await db.prepare(
    `SELECT id FROM memos WHERE workspace_id = ? AND id = ? AND is_deleted = 0`,
  ).bind(workspaceId, WELCOME_MEMO_ID).first<{ id: string }>();

  const now = isoNow();
  const today = now.slice(0, 10);
  const pageId = (key: string) => (key === "getting_started" && welcome ? welcome.id : `${workspaceId}_starter_${key}`);
  const statements: PreparedStatementAdapter[] = [];

  const addContent = async (
    id: string,
    title: string,
    markdown: string,
    placement: { parentId: string | null; position: number; icon: string | null; databaseId: string | null; properties: string },
  ) => {
    const contentJson = markdownToDoc(markdown);
    const contentText = docToText(contentJson);
    const contentHash = await sha256(markdown + JSON.stringify(contentJson));
    const isWelcome = id === welcome?.id;
    statements.push(
      isWelcome
        // The untouched welcome note becomes Getting Started, so a new account has one first page, not two.
        ? db.prepare(
          `UPDATE memos SET notebook_id = ?, title = ?, excerpt = ?, page_position = ?, page_icon = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ?`,
        ).bind(inbox.id, title, createExcerpt(contentText), placement.position, placement.icon, now, workspaceId, id)
        : db.prepare(
          `INSERT OR IGNORE INTO memos (
             id, workspace_id, notebook_id, title, excerpt, tags_json, is_pinned, is_archived, is_deleted,
             created_by, updated_by, created_at, updated_at, deleted_at,
             parent_memo_id, page_position, page_icon, database_id, properties_json
           ) VALUES (?, ?, ?, ?, ?, '[]', 0, 0, 0, 'system', 'system', ?, ?, NULL, ?, ?, ?, ?, ?)`,
        ).bind(
          id, workspaceId, inbox.id, title, createExcerpt(contentText), now, now,
          placement.parentId, placement.position, placement.icon, placement.databaseId, placement.properties,
        ),
      isWelcome
        ? db.prepare(
          `UPDATE memo_contents SET content_json = ?, content_markdown = ?, content_text = ?, content_hash = ?, updated_at = ?
           WHERE memo_id = ?`,
        ).bind(JSON.stringify(contentJson), markdown, contentText, contentHash, now, id)
        : db.prepare(
          `INSERT OR IGNORE INTO memo_contents (
             memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        ).bind(id, JSON.stringify(contentJson), markdown, contentText, contentHash, now, now),
      upsertMemoSearchDocumentStatement(db, id, title, contentText, ""),
    );
  };

  const pages = starterPages(today);
  for (const [index, page] of pages.entries()) {
    const id = pageId(page.key);
    const linked: string[] = [];
    const link = (key: string, title: string) => {
      linked.push(pageId(key));
      return `[${title}](#memo=${pageId(key)})`;
    };
    await addContent(id, page.title, page.markdown?.(link) ?? "", {
      parentId: null,
      position: (index + 1) * POSITION_GAP,
      icon: page.icon,
      databaseId: null,
      properties: "{}",
    });
    for (const target of linked) {
      statements.push(db.prepare(
        `INSERT OR IGNORE INTO memo_links (workspace_id, source_memo_id, target_memo_id) VALUES (?, ?, ?)`,
      ).bind(workspaceId, id, target));
    }

    if (!page.database) continue;
    const databaseId = `${workspaceId}_db_${page.key}`;
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO databases (id, workspace_id, page_memo_id, schema_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(databaseId, workspaceId, id, JSON.stringify(page.database.schema), now, now));
    page.database.views.forEach((view, viewIndex) => {
      statements.push(db.prepare(
        `INSERT OR IGNORE INTO database_views (id, database_id, workspace_id, name, type, config_json, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `${databaseId}_view_${viewIndex}`, databaseId, workspaceId, view.name, view.type,
        JSON.stringify(view.config), (viewIndex + 1) * POSITION_GAP, now, now,
      ));
    });
    for (const [rowIndex, row] of page.database.rows.entries()) {
      await addContent(`${workspaceId}_starter_${page.key}_${row.key}`, row.title, row.markdown ?? "", {
        parentId: id,
        position: (rowIndex + 1) * POSITION_GAP,
        icon: null,
        databaseId,
        properties: JSON.stringify(row.properties),
      });
    }
  }

  statements.push(
    db.prepare(
      `DELETE FROM notebooks
       WHERE workspace_id = ? AND parent_id IS NULL
         AND slug IN (${UNUSED_DEFAULT_NOTEBOOK_SLUGS.map(() => "?").join(", ")})
         AND NOT EXISTS (SELECT 1 FROM memos m WHERE m.notebook_id = notebooks.id)
         AND NOT EXISTS (SELECT 1 FROM notebooks child WHERE child.parent_id = notebooks.id)`,
    ).bind(workspaceId, ...UNUSED_DEFAULT_NOTEBOOK_SLUGS),
    // New accounts start without a template catalog. Anything a person made has a different id.
    db.prepare(
      `DELETE FROM memo_templates
       WHERE workspace_id = ? AND id IN (${DEFAULT_MEMO_TEMPLATE_SEEDS.map(() => "?").join(", ")})`,
    ).bind(workspaceId, ...DEFAULT_MEMO_TEMPLATE_SEEDS.map((seed) => defaultMemoTemplateId(workspaceId, seed.key))),
    db.prepare(`DELETE FROM workspace_example_seeds WHERE workspace_id = ?`).bind(workspaceId),
  );
  await db.batch(statements);
};
