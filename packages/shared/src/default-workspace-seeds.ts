import { resolveSupportedLocale, type SupportedLocale } from "./i18n/locales";

export type DefaultNotebookSeed = {
  key: "inbox" | "projects" | "learning" | "creative" | "personal";
  slug: string;
  color: string | null;
  sortOrder: number;
  names: Record<SupportedLocale, string>;
};

// English is what the installation migrations leave behind (0093). Keep it
// first so the localization guard can recognise names nobody has changed yet.
// color stays null so the sidebar uses the shared slate icon. A hue is stored
// only after someone saves an appearance.
export const DEFAULT_NOTEBOOK_SEEDS: readonly DefaultNotebookSeed[] = [
  {
    key: "inbox",
    slug: "inbox",
    color: null,
    sortOrder: 10,
    names: { "en-US": "Inbox", ja: "受信トレイ", pl: "Skrzynka", ru: "Входящие" },
  },
  {
    key: "projects",
    slug: "work-projects",
    color: null,
    sortOrder: 20,
    names: { "en-US": "Work Projects", ja: "仕事のプロジェクト", pl: "Projekty zawodowe", ru: "Рабочие проекты" },
  },
  {
    key: "learning",
    slug: "learning-resources",
    color: null,
    sortOrder: 30,
    names: { "en-US": "Learning Resources", ja: "学習資料", pl: "Materiały do nauki", ru: "Учебные материалы" },
  },
  {
    key: "creative",
    slug: "creative-ideas",
    color: null,
    sortOrder: 40,
    names: { "en-US": "Creative Ideas", ja: "アイデアと創作", pl: "Pomysły i twórczość", ru: "Творческие идеи" },
  },
  {
    key: "personal",
    slug: "personal-life",
    color: null,
    sortOrder: 50,
    names: { "en-US": "Personal Life", ja: "暮らしと個人", pl: "Życie prywatne", ru: "Личная жизнь" },
  },
];

export const localizeDefaultNotebookName = (
  seed: DefaultNotebookSeed,
  locale: string | null | undefined,
) => seed.names[resolveSupportedLocale(locale)];

export const WELCOME_MEMO_ID = "memo_welcome";

/**
 * The welcome note as the installation migrations leave it (0093 rewrites the
 * original text in English): its title, the content hash, and the `system`
 * actor. Any edit, including a title-only one, changes the title, the revision,
 * or the actor, so together they identify a welcome note nobody has touched.
 */
export const WELCOME_MEMO_SEED_TITLE = "Welcome to Ponder";
export const WELCOME_MEMO_SEED_CONTENT_HASH = "d2388c61e2f39c85d12d052df6c4fba8cc638343d879b40e730e674a9faa0747";

export type WelcomeMemoTranslation = {
  title: string;
  paragraphs: [string, string];
};

export const WELCOME_MEMO_TRANSLATIONS: Record<SupportedLocale, WelcomeMemoTranslation> = {
  "en-US": {
    title: "Welcome to Ponder",
    paragraphs: [
      "This is your first Ponder note: three panes, running on the edge, ready for AI agents.",
      "Next, create notebooks, write notes, search your content, and merge several notes into a new long-term note.",
    ],
  },
  ja: {
    title: "Ponder へようこそ",
    paragraphs: [
      "これは Ponder の最初のノートです。3 ペイン構成でエッジ上で動作し、AI エージェントとも連携できます。",
      "ノートブックを作成してノートを書き、内容を検索し、複数のノートを 1 つの新しい長期ノートにまとめてみましょう。",
    ],
  },
  pl: {
    title: "Witaj w Ponder",
    paragraphs: [
      "To Twoja pierwsza notatka w Ponder: trzy panele, działanie na brzegu sieci i gotowość do pracy z agentami AI.",
      "Teraz możesz tworzyć notatniki, pisać notatki, przeszukiwać treści i scalać kilka notatek w jedną nową, trwałą notatkę.",
    ],
  },
  ru: {
    title: "Добро пожаловать в Ponder",
    paragraphs: [
      "Это первая заметка в Ponder: три панели, работа на краю сети и готовность к агентам ИИ.",
      "Дальше можно создавать блокноты, писать заметки, искать по содержимому и объединять несколько заметок в одну новую долгосрочную.",
    ],
  },
};

export type WelcomeMemoContent = {
  title: string;
  excerpt: string;
  contentJson: string;
  contentMarkdown: string;
  contentText: string;
};

// Mirrors the document shape of the welcome note in the installation migrations:
// a level-2 heading followed by two paragraphs.
export const buildWelcomeMemoContent = (locale: string | null | undefined): WelcomeMemoContent => {
  const { title, paragraphs } = WELCOME_MEMO_TRANSLATIONS[resolveSupportedLocale(locale)];
  const text = (value: string) => [{ type: "text", text: value }];
  return {
    title,
    excerpt: paragraphs[0],
    contentJson: JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: text(title) },
        ...paragraphs.map((paragraph) => ({ type: "paragraph", content: text(paragraph) })),
      ],
    }),
    contentMarkdown: [`## ${title}`, ...paragraphs].join("\n\n"),
    contentText: [title, ...paragraphs].join(" "),
  };
};
