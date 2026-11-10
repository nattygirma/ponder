import {
  serializeDiagramDocument,
  serializeInfographicDocument,
  serializePosterDocument,
  serializeTableDocument,
  type DiagramDocument,
  type InfographicDocument,
  type PosterDocument,
  type TableDocument,
} from "@ponder/shared";
import {
  decodeDemoAttachment,
  DEMO_ATTACHMENT_MARKDOWN_EN,
  DEMO_ATTACHMENT_RESOURCES,
} from "./demo-attachments";

export { decodeDemoAttachment };

export const DEMO_SEED_NOTEBOOKS = [
  { id: "nb_inbox", parentId: null, name: "Inbox", slug: "inbox", icon: "notebook", color: null, sortOrder: 10 },
  { id: "nb_projects", parentId: null, name: "Work Projects", slug: "work-projects", icon: "notebook", color: null, sortOrder: 20 },
  { id: "nb_learning", parentId: null, name: "Learning Resources", slug: "learning-resources", icon: "notebook", color: null, sortOrder: 30 },
  { id: "nb_creative", parentId: null, name: "Creative Ideas", slug: "creative-ideas", icon: "notebook", color: null, sortOrder: 40 },
  { id: "nb_personal", parentId: null, name: "Personal Life", slug: "personal-life", icon: "notebook", color: null, sortOrder: 50 },
  { id: "nb_demo_features_en", parentId: "nb_projects", name: "Feature Demos", slug: "feature-demos", icon: "notebook", color: null, sortOrder: 22 },
];

export const DEMO_ARCHITECTURE_DIAGRAM_EN: DiagramDocument = {
  schemaVersion: 2,
  kind: "architecture",
  nodes: [
    { id: "boundary-clients", label: "Cross-Platform Experience", x: 32, y: 43, width: 260, height: 694, shape: "boundary" },
    { id: "boundary-platform", label: "Portable Application Platform · Shared Core on Cloudflare Workers or Docker", x: 380, y: 181, width: 732, height: 418, shape: "boundary" },
    { id: "boundary-data", label: "Data & Files · Replaceable Infrastructure Adapters", x: 1200, y: 396, width: 260, height: 436, shape: "boundary" },
    { id: "boundary-ecosystem", label: "AI & Automation Ecosystem", x: 1200, y: 32, width: 260, height: 308, shape: "boundary" },

    { id: "client-web", label: "Web / PWA\nOffline First", x: 68, y: 99, width: 156, height: 64, shape: "frontend", resourceIcon: "webApp", parentId: "boundary-clients" },
    { id: "client-desktop", label: "macOS / Windows\nDesktop", x: 68, y: 203, width: 156, height: 70, shape: "client", resourceIcon: "client", parentId: "boundary-clients" },
    { id: "client-ios", label: "iOS\nNative SwiftUI", x: 68, y: 313, width: 156, height: 70, shape: "client", resourceIcon: "mobileApp", parentId: "boundary-clients" },
    { id: "client-android", label: "Android\nNative Expo", x: 68, y: 423, width: 156, height: 64, shape: "client", resourceIcon: "mobileApp", parentId: "boundary-clients" },
    { id: "client-clipper", label: "Web Clipper\nChrome / Edge", x: 68, y: 527, width: 156, height: 70, shape: "client", resourceIcon: "website", parentId: "boundary-clients" },
    { id: "client-sync", label: "Shared Cross-Client Sync", x: 68, y: 637, width: 156, height: 64, shape: "service", resourceIcon: "apiClient", parentId: "boundary-clients" },

    { id: "platform-api", label: "Unified API Entry\nAuth · Limits · Routing", x: 416, y: 365, width: 156, height: 88, shape: "service", resourceIcon: "apiGateway", parentId: "boundary-platform" },
    { id: "platform-core", label: "Shared Business Core\nHono · Domain Services", x: 668, y: 301, width: 156, height: 88, shape: "service", resourceIcon: "service", parentId: "boundary-platform" },
    { id: "platform-sync", label: "Sync & Revision Engine\nOffline Queue · Conflicts", x: 920, y: 301, width: 156, height: 88, shape: "service", resourceIcon: "streamProcessing", parentId: "boundary-platform" },
    { id: "platform-mcp", label: "Native MCP Endpoint\nAgent Read/Write Tools", x: 416, y: 237, width: 156, height: 88, shape: "service", resourceIcon: "mcpServer", parentId: "boundary-platform" },
    { id: "platform-model", label: "Client Model Gateway\nPrivate BYOK", x: 416, y: 493, width: 156, height: 70, shape: "service", resourceIcon: "modelGateway", parentId: "boundary-platform" },

    { id: "data-search", label: "Search & Semantic Index\nFull Text · Vectors", x: 1239, y: 452, width: 150, height: 106, shape: "database", resourceIcon: "vectorDatabase", parentId: "boundary-data" },
    { id: "data-sql", label: "D1 / SQLite\nNotes · Tags · Revisions", x: 1239, y: 598, width: 150, height: 88, shape: "database", resourceIcon: "relationalDatabase", parentId: "boundary-data" },
    { id: "data-objects", label: "R2 / S3\nImages & Attachments", x: 1236, y: 726, width: 156, height: 70, shape: "storage", resourceIcon: "objectStorage", parentId: "boundary-data" },

    { id: "ecosystem-agents", label: "Claude / Cursor\nAutomation Agents", x: 1236, y: 88, width: 156, height: 88, shape: "external", resourceIcon: "aiAgent", parentId: "boundary-ecosystem" },
    { id: "ecosystem-models", label: "OpenAI / Gemini\nCompatible Models", x: 1236, y: 216, width: 156, height: 88, shape: "external", resourceIcon: "largeLanguageModel", parentId: "boundary-ecosystem" },
  ],
  edges: [
    { id: "edge-clients-api", source: "client-sync", target: "platform-api", label: "HTTPS / Sync Cursor", kind: "request" },
    { id: "edge-api-core", source: "platform-api", target: "platform-core", label: "Domain API", kind: "request" },
    { id: "edge-core-sync", source: "platform-core", target: "platform-sync", label: "Change Log", kind: "async", bidirectional: true },
    { id: "edge-mcp-core", source: "platform-mcp", target: "platform-core", label: "Governed Access", kind: "request", bidirectional: true },
    { id: "edge-core-sql", source: "platform-core", target: "data-sql", label: "Transactions", kind: "data" },
    { id: "edge-core-objects", source: "platform-core", target: "data-objects", label: "Objects", kind: "data" },
    { id: "edge-sync-search", source: "platform-sync", target: "data-search", label: "Incremental Index", kind: "data" },
    { id: "edge-agents-mcp", source: "ecosystem-agents", target: "platform-mcp", label: "MCP Tools", kind: "request", bidirectional: true },
    { id: "edge-model-gateway", source: "platform-model", target: "ecosystem-models", label: "User-Key Direct", kind: "request", bidirectional: true },
  ],
};

export const DEMO_FLOWCHART_DIAGRAM_EN: DiagramDocument = {
  schemaVersion: 1,
  kind: "flowchart",
  theme: "plain",
  nodes: [
    { id: "capture", label: "Capture an idea", x: 72, y: 176, width: 136, height: 48, shape: "terminator" },
    { id: "enrich", label: "Add content, tags & files", x: 264, y: 168, width: 184, height: 64, shape: "process" },
    { id: "organized", label: "Ready to organize?", x: 516, y: 164, width: 164, height: 72, shape: "decision" },
    { id: "inbox", label: "Keep in Inbox", x: 516, y: 304, width: 164, height: 56, shape: "process" },
    { id: "notebook", label: "Move to a project or topic", x: 748, y: 168, width: 184, height: 64, shape: "process" },
    { id: "ai", label: "Let AI extract summary & actions", x: 748, y: 304, width: 184, height: 64, shape: "process" },
    { id: "publish", label: "Publish, share, or iterate", x: 1000, y: 176, width: 184, height: 48, shape: "terminator" },
  ],
  edges: [
    { id: "capture-enrich", source: "capture", target: "enrich" },
    { id: "enrich-organized", source: "enrich", target: "organized" },
    { id: "organized-notebook", source: "organized", target: "notebook", label: "Yes" },
    { id: "organized-inbox", source: "organized", target: "inbox", label: "Not yet" },
    { id: "inbox-ai", source: "inbox", target: "ai", label: "Review later" },
    { id: "notebook-publish", source: "notebook", target: "publish" },
    { id: "ai-publish", source: "ai", target: "publish" },
  ],
};

export const DEMO_MIND_MAP_DIAGRAM_EN: DiagramDocument = {
  schemaVersion: 1,
  kind: "mind-map",
  theme: "plain",
  structure: "map",
  nodes: [
    { id: "root", label: "My Second Brain", x: 72, y: 216, width: 152, height: 52, shape: "topic" },
    { id: "capture", label: "Capture", x: 304, y: 72, width: 112, height: 42, shape: "topic", parentId: "root" },
    { id: "organize", label: "Organize", x: 304, y: 176, width: 112, height: 42, shape: "topic", parentId: "root" },
    { id: "connect", label: "Connect", x: 304, y: 280, width: 112, height: 42, shape: "topic", parentId: "root" },
    { id: "create", label: "Create", x: 304, y: 384, width: 112, height: 42, shape: "topic", parentId: "root" },
    { id: "capture-clip", label: "Web clipping", x: 520, y: 32, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "capture-quick", label: "Quick notes", x: 520, y: 88, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "capture-files", label: "Images & files", x: 520, y: 144, width: 112, height: 36, shape: "topic", parentId: "capture" },
    { id: "organize-notebooks", label: "Notebook tree", x: 520, y: 200, width: 112, height: 36, shape: "topic", parentId: "organize" },
    { id: "organize-tags", label: "Tags & search", x: 520, y: 256, width: 112, height: 36, shape: "topic", parentId: "organize" },
    { id: "connect-links", label: "Backlinks", x: 520, y: 312, width: 112, height: 36, shape: "topic", parentId: "connect" },
    { id: "connect-mcp", label: "MCP agents", x: 520, y: 368, width: 112, height: 36, shape: "topic", parentId: "connect" },
    { id: "create-writing", label: "Focused writing", x: 520, y: 424, width: 112, height: 36, shape: "topic", parentId: "create" },
    { id: "create-share", label: "Publish & share", x: 520, y: 480, width: 112, height: 36, shape: "topic", parentId: "create" },
  ],
  edges: [
    { id: "edge-root-capture", source: "root", target: "capture" },
    { id: "edge-root-organize", source: "root", target: "organize" },
    { id: "edge-root-connect", source: "root", target: "connect" },
    { id: "edge-root-create", source: "root", target: "create" },
    { id: "edge-capture-clip", source: "capture", target: "capture-clip" },
    { id: "edge-capture-quick", source: "capture", target: "capture-quick" },
    { id: "edge-capture-files", source: "capture", target: "capture-files" },
    { id: "edge-organize-notebooks", source: "organize", target: "organize-notebooks" },
    { id: "edge-organize-tags", source: "organize", target: "organize-tags" },
    { id: "edge-connect-links", source: "connect", target: "connect-links" },
    { id: "edge-connect-mcp", source: "connect", target: "connect-mcp" },
    { id: "edge-create-writing", source: "create", target: "create-writing" },
    { id: "edge-create-share", source: "create", target: "create-share" },
  ],
};

export const DEMO_INFOGRAPHIC_SYNTAX_EN = `infographic sequence-timeline-rounded-rect-node
data
  title Ponder Evolution Milestones
  sequences
    - label v1.0 Foundation
      desc Classic three-pane layout, Serverless D1 storage & sync cursors
    - label v1.50 Agents & Mobile
      desc Native MCP endpoint (/mcp), native mobile apps & clipping matrix
    - label v1.88 Structured Workspace
      desc AI-driven infographics, structured tables & visual diagram suite
    - label v1.100 Dual Protocols & Web
      desc Desktop ACP for local agents, public notebook site publishing & full platform apps
    - label v1.120 Visual Canvas & Layout
      desc Native poster notes & canvas layout, WeChat chat archiving & flexible self-hosting`;

export const DEMO_INFOGRAPHIC_DOCUMENT_EN: InfographicDocument = {
  schemaVersion: 1,
  syntax: DEMO_INFOGRAPHIC_SYNTAX_EN,
};

export const DEMO_POSTER_DOCUMENT_EN: PosterDocument = {
  schemaVersion: 1,
  width: 1080,
  height: 1440,
  background: "#f4efe4",
  templateId: "editorial",
  copy: {
    badge: "PONDER · KNOWLEDGE ART",
    title: "Next-Gen Second Brain\nfor Geeks & Creators",
    subtitle: "Revive the beloved three-pane workflow with native AI agents and total data ownership.",
  },
  elements: [
    {
      id: "accent",
      name: "accent",
      type: "rect",
      x: 96,
      y: 110,
      width: 120,
      height: 12,
      fill: "#16a06e",
      rotation: 0,
      opacity: 1,
      locked: false,
    },
    {
      id: "badge",
      name: "badge",
      type: "text",
      role: "badge",
      text: "PONDER · KNOWLEDGE ART",
      x: 96,
      y: 150,
      width: 888,
      height: 40,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#0f766e",
      fontSize: 24,
      fontFamily: "sans-serif",
      fontWeight: "bold",
      textAlign: "left",
    },
    {
      id: "heading",
      name: "heading",
      type: "text",
      role: "title",
      text: "Next-Gen Second Brain\nfor Geeks & Creators",
      x: 96,
      y: 220,
      width: 888,
      height: 220,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#07130b",
      fontSize: 80,
      fontFamily: "serif",
      fontWeight: "bold",
      textAlign: "left",
      lineHeight: 1.25,
    },
    {
      id: "subtitle",
      name: "subtitle",
      type: "text",
      role: "subtitle",
      text: "Revive the beloved three-pane workflow with native AI agents and total data ownership.",
      x: 96,
      y: 470,
      width: 888,
      height: 80,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#3f3f46",
      fontSize: 30,
      fontFamily: "sans-serif",
      fontWeight: "normal",
      textAlign: "left",
    },
    {
      id: "section-1-card",
      name: "section-1-card",
      type: "rect",
      x: 96,
      y: 590,
      width: 888,
      height: 220,
      fill: "#ffffff",
      radius: 20,
      rotation: 0,
      opacity: 1,
      locked: false,
    },
    {
      id: "section-1-heading",
      name: "section-1-heading",
      type: "text",
      text: "01 · Native MCP & ACP Dual Protocols",
      x: 136,
      y: 630,
      width: 808,
      height: 48,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#07130b",
      fontSize: 32,
      fontFamily: "sans-serif",
      fontWeight: "bold",
      textAlign: "left",
    },
    {
      id: "section-1-body",
      name: "section-1-body",
      type: "text",
      text: "Connect Claude, Cursor, and Codex via MCP, and drive local agents seamlessly via ACP on desktop.",
      x: 136,
      y: 695,
      width: 808,
      height: 70,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#71717a",
      fontSize: 24,
      fontFamily: "sans-serif",
      fontWeight: "normal",
      textAlign: "left",
      lineHeight: 1.4,
    },
    {
      id: "section-2-card",
      name: "section-2-card",
      type: "rect",
      x: 96,
      y: 840,
      width: 888,
      height: 220,
      fill: "#ffffff",
      radius: 20,
      rotation: 0,
      opacity: 1,
      locked: false,
    },
    {
      id: "section-2-heading",
      name: "section-2-heading",
      type: "text",
      text: "02 · 100% Free Serverless & Self-Hosting",
      x: 136,
      y: 880,
      width: 808,
      height: 48,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#07130b",
      fontSize: 32,
      fontFamily: "sans-serif",
      fontWeight: "bold",
      textAlign: "left",
    },
    {
      id: "section-2-body",
      name: "section-2-body",
      type: "text",
      text: "Run within Cloudflare free quotas or one-command Docker on your VPS/NAS with standard SQLite storage.",
      x: 136,
      y: 945,
      width: 808,
      height: 70,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#71717a",
      fontSize: 24,
      fontFamily: "sans-serif",
      fontWeight: "normal",
      textAlign: "left",
      lineHeight: 1.4,
    },
    {
      id: "section-3-card",
      name: "section-3-card",
      type: "rect",
      x: 96,
      y: 1090,
      width: 888,
      height: 220,
      fill: "#ffffff",
      radius: 20,
      rotation: 0,
      opacity: 1,
      locked: false,
    },
    {
      id: "section-3-heading",
      name: "section-3-heading",
      type: "text",
      text: "03 · Full-Platform Apps & Knowledge Sites",
      x: 136,
      y: 1130,
      width: 808,
      height: 48,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#07130b",
      fontSize: 32,
      fontFamily: "sans-serif",
      fontWeight: "bold",
      textAlign: "left",
    },
    {
      id: "section-3-body",
      name: "section-3-body",
      type: "text",
      text: "Native coverage on macOS, Windows, Linux, iOS & Android; publish entire notebooks as standalone sites.",
      x: 136,
      y: 1195,
      width: 808,
      height: 70,
      rotation: 0,
      opacity: 1,
      locked: false,
      fill: "#71717a",
      fontSize: 24,
      fontFamily: "sans-serif",
      fontWeight: "normal",
      textAlign: "left",
      lineHeight: 1.4,
    },
  ],
};

export const DEMO_TABLE_DOCUMENT_EN: TableDocument = {
  schemaVersion: 1,
  fields: [
    { id: "fld_feature", name: "Feature", type: "text" },
    { id: "fld_category", name: "Category", type: "select", options: ["AI Agents", "Cross-Platform", "Visuals & Data", "Data & Architecture"] },
    { id: "fld_status", name: "Status", type: "select", options: ["Released", "Public Beta", "Planned"] },
    { id: "fld_verified", name: "Verified", type: "checkbox" },
    { id: "fld_date", name: "Release Date", type: "date" },
    { id: "fld_docs", name: "Documents", type: "attachment" },
  ],
  records: [
    {
      id: "rec_poster",
      cells: {
        fld_feature: "Native Poster Notes & Canvas Layout",
        fld_category: "Visuals & Data",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-10-05",
        fld_docs: [],
      },
    },
    {
      id: "rec_acp",
      cells: {
        fld_feature: "Desktop ACP Local Agent Integration",
        fld_category: "AI Agents",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-10-08",
        fld_docs: [],
      },
    },
    {
      id: "rec_notebook_site",
      cells: {
        fld_feature: "Notebook Knowledge Base Web Publishing",
        fld_category: "Data & Architecture",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-10-10",
        fld_docs: [],
      },
    },
    {
      id: "rec_platforms",
      cells: {
        fld_feature: "Full-Platform Apps (macOS / Win / Linux / iOS / Android)",
        fld_category: "Cross-Platform",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-09-28",
        fld_docs: [{ resourceId: "res_demo_attachment_bundle_zip", filename: "ponder-attachment-demo.zip", mimeType: "application/zip", byteSize: 153 }],
      },
    },
    {
      id: "rec_infographic",
      cells: {
        fld_feature: "AntV AI Infographic Notes",
        fld_category: "Visuals & Data",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-09-15",
        fld_docs: [{ resourceId: "res_demo_feature_matrix_csv", filename: "feature-matrix.csv", mimeType: "text/csv", byteSize: 99 }],
      },
    },
    {
      id: "rec_table",
      cells: {
        fld_feature: "Structured Tables & Public Forms",
        fld_category: "Visuals & Data",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-09-20",
        fld_docs: [{ resourceId: "res_demo_product_brief_pdf", filename: "ponder-product-brief.pdf", mimeType: "application/pdf", byteSize: 349 }],
      },
    },
    {
      id: "rec_mcp",
      cells: {
        fld_feature: "Native MCP Endpoint (/mcp)",
        fld_category: "AI Agents",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-08-10",
        fld_docs: [],
      },
    },
    {
      id: "rec_clipper",
      cells: {
        fld_feature: "Web Clipper & WeChat Chat Archiving",
        fld_category: "Cross-Platform",
        fld_status: "Released",
        fld_verified: true,
        fld_date: "2026-09-25",
        fld_docs: [],
      },
    },
  ],
  view: {
    filters: [],
    sort: null,
  },
};

export const DEMO_SEED_MEMO_METADATA = [
  { id: "memo_demo_overview", notebookId: "nb_demo_features", tags: ["overview", "guide", "features", "ai-agent"], isPinned: true },
  { id: "memo_demo_poster", notebookId: "nb_demo_features", tags: ["poster", "design", "visual-layout", "branding"], isPinned: false },
  { id: "memo_demo_infographic", notebookId: "nb_demo_features", tags: ["infographic", "milestone", "timeline", "ai-agent"], isPinned: false },
  { id: "memo_demo_table", notebookId: "nb_demo_features", tags: ["table", "roadmap", "project-management", "tracking"], isPinned: false },
  { id: "memo_demo_architecture", notebookId: "nb_demo_features", tags: ["architecture", "diagram", "portable-runtime", "cloud-native", "mcp"], isPinned: false },
  { id: "memo_demo_flowchart", notebookId: "nb_demo_features", tags: ["flowchart", "diagram", "workflow", "knowledge-management"], isPinned: false },
  { id: "memo_demo_mind_map", notebookId: "nb_demo_features", tags: ["mind-map", "diagram", "second-brain", "knowledge-management"], isPinned: false },
];

export const DEMO_SEED_REVISIONS = [
  {
    id: "rev_demo_revision_1_en",
    memoId: "memo_demo_overview_en",
    revision: 1,
    title: "Welcome to Ponder: Modern Open-Source Knowledge Base for Geeks & Creators",
    markdown:
      "## Welcome to Ponder (Initial Draft)\n\n- Classic Evernote 3-pane layout & Serverless self-hosted\n- Visual table editing & Markdown source toggle\n- Native MCP & AI agent synergy",
  },
  {
    id: "rev_demo_poster_1_en",
    memoId: "memo_demo_poster_en",
    revision: 1,
    title: "Visual Design: Ponder Geek Second Brain Poster Note",
    markdown: serializePosterDocument(DEMO_POSTER_DOCUMENT_EN),
  },
  {
    id: "rev_demo_infographic_1_en",
    memoId: "memo_demo_infographic_en",
    revision: 1,
    title: "Evolution Milestones: Ponder Architecture & Release History",
    markdown: serializeInfographicDocument(DEMO_INFOGRAPHIC_DOCUMENT_EN),
  },
  {
    id: "rev_demo_table_1_en",
    memoId: "memo_demo_table_en",
    revision: 1,
    title: "Delivery Tracking: Ponder Product Roadmap & Release Status",
    markdown: serializeTableDocument(DEMO_TABLE_DOCUMENT_EN),
  },
  {
    id: "rev_demo_architecture_1_en",
    memoId: "memo_demo_architecture_en",
    revision: 1,
    title: "System Architecture: Ponder Portable Full Stack & AI Collaboration",
    markdown: serializeDiagramDocument(DEMO_ARCHITECTURE_DIAGRAM_EN),
  },
];

export const DEMO_MEMO_ENGLISH = {
  memo_demo_overview: {
    title: "Welcome to Ponder: Modern Open-Source Knowledge Base for Geeks & Creators",
    markdown:
      `> **Ponder** is an open-source, AI-native, and portable serverless/containerized personal knowledge base that revives the beloved **Evernote-style three-pane layout**. Designed for geeks and content creators, it combines 100% free serverless hosting, absolute data ownership, native cross-platform clients, and seamless AI Agent (MCP) synergy to redefine your digital second brain.

---

## 1. Why Choose Ponder?

*Tip: In editor mode, click any table cell to edit text directly, or right-click to insert/delete rows and columns.*

| Dimension | Traditional Cloud Notes (e.g. Evernote) | Local Offline Notes (e.g. Obsidian) | Ponder Geek Knowledge Base |
| :--- | :--- | :--- | :--- |
| **Source Code** | Closed source | Closed-source core, open files | **Full-stack open source (AGPL-3.0)** |
| **Hosting Cost** | Costly commercial subscriptions ($10+/mo) | Official cloud sync subscription ($5+/mo) | **100% Free Forever (Cloudflare Free Tier / Docker Self-Hosted)** |
| **Data Ownership** | Proprietary lock-in, hard to export | Local Markdown, cumbersome mobile sync | **Full Ownership (D1 SQLite, R2 Storage, Lossless ZIP Archives)** |
| **Writing & Expressive Matrix** | Rich text only, fragile formatting | Plain Markdown, lacks WYSIWYG flow | **Seamless Dual-View (WYSIWYG ⇄ Source) + Native Architecture/Flowchart/Mind-Map/AI Infographic/Structured Table/Poster Notes** |
| **Publishing Ready** | No typography styling, loses format | Requires 3rd-party plugins or scripts | **One-Click Rich Copy for WeChat, Substack, Medium & WordPress** |
| **Social Poster Cards** | Basic screenshots without styling | Requires external tools or plugins | **8 Built-in Exquisite Poster Themes with Typography Options & PNG/JPEG Export** |
| **Native AI Ecosystem** | Paywalled, limited features | Heavy plugin setup required | **Native MCP Server (\`/mcp\`), Desktop ACP Local Agent Integration & Inline AI** |
| **Cross-Platform Matrix** | Restricts active free devices | Complex setup across platforms | **Web / PWA / Android / iOS / macOS / Windows / Linux AppImage** |

---

## 2. Architectural Overview & Ecosystem

The Mermaid diagram below demonstrates how Ponder connects cross-platform clients, zero-cost cloud infrastructure, and AI Agents into a cohesive workflow:

\`\`\`mermaid
flowchart TD
    subgraph MultiClients["Client Matrix"]
        C1["Web / PWA (Offline Drafts & Sync Queue)"]
        C2["macOS Desktop (Electron + Rust Sidecar)"]
        C3["Windows / Linux Desktop (ACP Agent Integration)"]
        C4["Android Native App (Expo + SQLite)"]
        C5["iOS Native App (SwiftUI + GRDB)"]
        C6["Web Clipper (Chrome / Edge / Firefox)"]
    end

    subgraph CoreEngine["Service & Storage Core"]
        API["Hono API Engine (Cloudflare Workers / Docker)"]
        MCP["Native MCP Endpoint (/mcp 2026-07-28 & 2025)"]
        D1[("D1 / SQLite Database (Sync Cursor & Revisions)")]
        R2[("R2 / S3 Storage (Images & Media Attachments)")]
    end

    subgraph AIAgents["AI Agents & Integrations"]
        A1["Claude Code / Cursor / Antigravity"]
        A2["Inline AI Assistant (OpenAI / Gemini / DeepSeek)"]
        A3["Notion DB / Feishu Bitable Sync"]
    end

    MultiClients <==>|REST API & Sync Cursor| API
    API <==> D1 & R2
    MCP <==> D1 & R2
    A1 <==>|MCP Tools / SSE| MCP
    A2 -.->|BYOK Direct Key| MultiClients
    A1 -.->|Bi-directional Sync| A3
\`\`\`

---

## 3. Immersive Writing & Typography Aesthetics

Ponder is engineered to provide a distraction-free, elegant writing experience:

### Dual-View Editor & Focus Modes
- **Seamless Dual-View**: Click the \`</>\` button in the top-right corner (or use shortcuts) to instantly toggle between **WYSIWYG Rich Text** and **Markdown Source Code** with 100% fidelity.
- **Collapsible Outline Navigation**: Automatically indexes \`H1-H3\` heading hierarchies with smooth jump scrolling, keeping lengthy documents organized.
- **Zen Focus Mode**: Press \`Cmd/Ctrl + Shift + F\` to hide sidebars and distractions, immersing yourself in pure writing flow.
- **Reading Protection Mode**: When reading or reviewing notes, press \`Cmd/Ctrl + E\` to toggle read-only protection, locking the editor to prevent accidental edits while browsing; press it again to seamlessly resume editing.

### Curated Typography Themes & Publishing Export
- **Preset Editor Themes**: Switch effortlessly between \`WeChat Green\`, \`Fresh Mint\`, \`Minimal Jade\`, \`Lined Jade\`, and styles such as Warm Page, Lesson Page, and Navy Draft, with custom Chinese and interface typography.
- **One-Click Publishing Export**: Built for publishers and bloggers. Click the **WeChat Icon** in the top bar to format your note with inline CSS. Paste directly into WeChat Official Account editor, Substack, Medium, or WordPress while preserving layout and syntax highlighting.

### 8 Exquisite Social Poster Themes
Click **"Share as Card"** in the top-right menu to turn any note into an eye-catching poster card:
- **8 Themes**: \`Slate\`, \`Aurora\`, \`Sunset\`, \`Midnight\`, \`Mint\`, \`Notepad\` (skeuomorphic paper), \`Xuan\` (rice paper & Chinese ink), \`Lavender\`.
- **Customizable Typography**: Switch between Sans, Serif (Songti/Ming), and Monospace fonts, select compact, standard, or wide card widths, and export as high-resolution PNG or JPEG.

---

## 4. Visual Richness: Diagrams, AI Infographics & Structured Tables

Ponder transcends traditional plain text notes with native visual and structured data canvases:

### Native Diagram Suite
- **System Architecture (Architecture)**: Designed for microservices and cloud topologies with boundaries, icons, and automated layout;
- **Business Workflows (Flowchart)**: Standard terminators, decisions, and process nodes to map workflows cleanly;
- **Second Brain Mind Maps (Mind Map)**: Radial trees and grouped topics for interconnected thoughts.

### AntV AI Infographic Engine (Infographic)
Powered by AntV and AI Agents:
- Select from Timelines, Steps, Quadrants, and Comparison matrices;
- **Conversational Refinement**: Instruct the AI in natural language directly in the infographic editor (e.g. "focus on cross-platform milestones" or "convert to a chronological timeline") to adjust layouts with full history and undo support.

### Multi-Dimensional Structured Tables (Structured Table)
Engineered for roadmaps, asset tracking, and form collection:
- **Rich Field Types**: Native support for Text, Number, Single Select, Date, Checkbox, URL, and **Multi-File Attachments**;
- **Multi-Condition Filtering & Sorting**: Dynamically combine filters and field order;
- **Public Form Collection**: Generate a public link for external input that writes directly back to your table in real time.

---

## 5. Power Productivity Toolbox: Slash Commands, Backlinks & Math

### Slash Commands
Type \`/\` or press \`Space\` on an empty line to invoke the command menu:
- Insert \`H1/H2/H3\` headings, quotes, horizontal rules, code blocks, and rich tables;
- Use \`/date\`, \`/time\`, or \`/now\` to insert current timestamps instantly;
- Attach files, insert images, or summon the inline AI assistant.

### Bi-directional Note Links & Backlinks
Type \`@\` or insert \`#memo=<memoId>\` links to establish bi-directional references across your knowledge base, building an interconnected web of thoughts.

### KaTeX Professional LaTeX Mathematics
Native support for KaTeX renders complex mathematical equations in milliseconds:

- **Inline Math**: For instance, Einstein's mass-energy equivalence $E = mc^2$ or the Gaussian probability density function $f(x) = \\frac{1}{\\sigma \\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$.
- **Display Block Math**:
$$
\\oint_{\\partial \\Omega} \\mathbf{E} \\cdot d\\mathbf{S} = \\frac{1}{\\varepsilon_0} \\iiint_{\\Omega} \\rho \\, dV, \\quad \\oint_{\\partial \\Omega} \\mathbf{B} \\cdot d\\mathbf{S} = 0
$$

### Interactive Task Lists
- [x] Explore Ponder's dual-view editing and outline navigation
- [x] Experiment with 8 editor themes and 8 social poster card styles
- [x] View the new 【AI Infographic】 evolution milestones and 【Structured Table】 delivery tracker
- [ ] Try typing \`/\` on an empty line to insert current timestamp and tables
- [ ] Connect your AI API Key to experience inline summarization and continuation
- [ ] Connect AI Agents via MCP to automate note categorization

---

## 6. Native AI Agent Synergy & MCP Protocol

Ponder is architected for the agentic AI era, weaving LLMs directly into the knowledge management lifecycle:

\`\`\`mermaid
sequenceDiagram
    autonumber
    participant User as Creator / Knowledge Worker
    participant Client as Ponder Clients
    participant MCP as Ponder MCP Endpoint
    participant Agent as AI Agent (Claude / Cursor / Antigravity)
    participant Database as Notion / Feishu Bitable

    User->>Client: Capture quick spark or meeting notes
    Agent->>MCP: tools/call memo_search (Query unprocessed memos)
    MCP-->>Agent: Returns structured Markdown & tags
    Agent->>Agent: Analyzes content, extracts key takeaways & tags
    Agent->>MCP: tools/call memo_update (Writes back summary & tags)
    Agent->>Database: Syncs structured records to master database
    Client-->>User: Sub-second live updates in client UI
\`\`\`

### 1. Inline AI Assistant
Press the **\`Space\` bar** in an empty block, type **\`/ai\`**, use the **\`/\`** slash command menu, or select text and click the **AI button** on the floating toolbar to instantly summon the AI writing assistant:
- **Summarization & Action Items**: Condense documents into key takeaways, conclusions, and actionable todos;
- **Format-Preserving Translation**: Translate accurately into multiple languages while strictly preserving Markdown, math equations, links, and code blocks;
- **Rewriting & Continuation**: Polish phrasing, make writing concise, or continue writing seamlessly;
- **BYOK Direct Key (Bring Your Own Key)**: Direct client-side connection with OpenAI, Anthropic Claude, Google Gemini, DeepSeek, and OpenAI-compatible relays with zero third-party data transit.

### 2. Model Context Protocol (MCP) Integration
Generate an API token in **Settings → MCP Settings** to connect Ponder directly with Claude Code, Cursor, Antigravity, OpenClaw, and other agent platforms:
- **Direct Reading & Writing**: Connect via the \`/mcp\` endpoint (supports stateless \`2026-07-28\` protocol and handshake-based 2025 specs);
- **Automated Workflows**: Let AI Agents read, organize, summarize, tag, and synchronize notes with Notion databases and Feishu Bitable.

---

## 7. Multi-Platform Ecosystem, Offline Sync & Smart Clipping

- **Cross-Platform Native Apps**:
  - **Web / PWA**: Full-featured in modern browsers with offline installation support;
  - **Android Native App**: Built with Expo & SQLite, available on Google Play and GitHub Releases;
  - **iOS Native App**: Native Swift / SwiftUI with GRDB local mirror, available on the App Store (requires a non-mainland China Apple ID);
  - **macOS Desktop App**: Electron + Rust Sidecar for Apple Silicon & Intel Mac with silent background updates;
  - **Windows Desktop App**: Official x64 Preview released, featuring auto-launch, global hotkeys, and Windows Explorer context menu integration to send files to notes with one click.
- **Browser Web Clipper**: Available on Chrome, Edge, and Firefox extension stores to extract clean, ad-free Markdown articles, selected text, high-res images, and full X (Twitter) posts directly from context menus.
- **WeChat Ecosystem & External Imports**:
  - **Mobile Article Clipper**: Share any WeChat article to Ponder on your phone to automatically extract and format it as an editable note;
  - **WeChat Chat Forward Import**: Import forwarded chat records on the desktop client into cleanly formatted notes;
  - **One-Click Publishing Export**: Click the WeChat icon in the toolbar to copy formatted rich text ready for publishing.
- **Offline Drafts & Sync Queue**: Keep writing seamlessly without network connectivity; changes are queued locally and automatically synced once reconnected.

---

## 8. Rich Media, Lossless Portability & Zero-Cost Hosting

### Smart Client-Side Image Compression
When pasting or dragging images into notes, Ponder compresses them to WebP locally in your browser before upload, **reducing file size by 50% - 90%** while preserving visual fidelity.

![Ponder Official Logo](/api/v1/resources/res_demo_logo/blob)

### Universal File Attachments
Embed Word documents, PDFs, spreadsheets, archives, and multimedia files directly in notes for preview or download:
- [📝 Meeting notes Word: ponder-meeting-notes.docx](/api/v1/resources/res_demo_meeting_notes_docx/blob)
- [📄 Product brief PDF: ponder-product-brief.pdf](/api/v1/resources/res_demo_product_brief_pdf/blob)
- [📊 Feature matrix CSV: feature-matrix.csv](/api/v1/resources/res_demo_feature_matrix_csv/blob)
- [📦 Sample attachment archive: ponder-attachment-demo.zip](/api/v1/resources/res_demo_attachment_bundle_zip/blob)

### Zero-Cost Serverless & Docker Self-Hosting
1. **Cloudflare Serverless (Recommended, 100% Free Forever)**: Runs entirely within Cloudflare's free tier (Workers + D1 SQLite + R2 Storage). No server bills, no VPS maintenance.
2. **Docker One-Command Deployment (VPS / NAS / Home Server)**:
   \`\`\`sh
   docker compose up -d
   \`\`\`
   Configures Docker Compose and automated daily background updates with one command. Some network environments in mainland China may require an available network proxy or a trusted registry mirror to access GHCR.

### Complete Data Freedom: Lossless ZIP Portability
Export your entire library at any time from **Profile → Import and export**. The archive contains pure Markdown files with standard YAML Front Matter, relative media paths, and full revision histories—compatible with Obsidian, VS Code, and any plain text editor.

---

> 💡 **Quick Exploration Tips**:
> 1. Click **\`</>\`** in the top right to try seamless dual-view toggling;
> 2. Explore the new **AI Infographic**, **Structured Table**, and **Visual Poster** examples in the sidebar;
> 3. Press **\`Cmd/Ctrl + E\`** to test reading protection mode against accidental edits;
> 4. Press **\`Cmd/Ctrl + O\`** to summon the Quick Switcher;
> 5. Try Notebook Web Publishing: right-click any notebook to publish it as a standalone knowledge base site;
> 6. Click the **WeChat Icon** to copy formatted rich text ready for publishing;
> 7. Click **"Share as Card"** to export a stunning social poster card;
> 8. Click **"Reset Demo Data"** in settings or the sidebar anytime to restore the demo workspace.
`,
  },
  memo_demo_poster: {
    title: "Visual Design: Ponder Geek Second Brain Poster Note",
    markdown: serializePosterDocument(DEMO_POSTER_DOCUMENT_EN),
  },
  memo_demo_infographic: {
    title: "Evolution Milestones: Ponder Architecture & Release History",
    markdown: serializeInfographicDocument(DEMO_INFOGRAPHIC_DOCUMENT_EN),
  },
  memo_demo_table: {
    title: "Delivery Tracking: Ponder Product Roadmap & Release Status",
    markdown: serializeTableDocument(DEMO_TABLE_DOCUMENT_EN),
  },
  memo_demo_architecture: {
    title: "System Architecture: Ponder Portable Full Stack & AI Collaboration",
    markdown: serializeDiagramDocument(DEMO_ARCHITECTURE_DIAGRAM_EN),
  },
  memo_demo_flowchart: {
    title: "Knowledge Workflow: From Capturing Ideas to Publishing",
    markdown: serializeDiagramDocument(DEMO_FLOWCHART_DIAGRAM_EN),
  },
  memo_demo_mind_map: {
    title: "Second Brain: A Personal Knowledge System Mind Map",
    markdown: serializeDiagramDocument(DEMO_MIND_MAP_DIAGRAM_EN),
  },
} as const;

export const DEMO_SEED_MEMOS_EN = DEMO_SEED_MEMO_METADATA.map((memo) => {
  const english = DEMO_MEMO_ENGLISH[memo.id as keyof typeof DEMO_MEMO_ENGLISH];
  if (!english) {
    return null;
  }

  return {
    ...memo,
    id: `${memo.id}_en`,
    notebookId: "nb_demo_features_en",
    title: english.title,
    markdown: memo.id === "memo_demo_overview" ? `${english.markdown}${DEMO_ATTACHMENT_MARKDOWN_EN}` : english.markdown,
  };
}).filter((memo): memo is NonNullable<typeof memo> => memo !== null);

export const DEMO_SEED_MEMOS = DEMO_SEED_MEMOS_EN;

export const DEMO_SEED_RESOURCES = [
  {
    id: "res_demo_logo",
    memoId: "memo_demo_overview_en",
    filename: "ponder-icon.svg",
    mimeType: "image/svg+xml",
    width: 1024,
    height: 1024,
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Ponder"><rect width="1024" height="1024" rx="224" fill="#ffffff"/><g fill="#000000" transform="translate(-103 82)"><path fill-rule="evenodd" d="M300 232H540A180 180 0 0 1 540 592H424V792H300ZM424 340V484H530A72 72 0 0 0 530 340Z"/><circle cx="770" cy="240" r="38"/><circle cx="868" cy="130" r="62"/></g></svg>',
  },
  {
    id: "res_demo_cat_image",
    memoId: "memo_demo_overview_en",
    filename: "cute-cat-demo.svg",
    mimeType: "image/svg+xml",
    width: 960,
    height: 540,
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" fill="none"><rect width="960" height="540" rx="32" fill="#f0fdfa"/><g transform="translate(480, 270) scale(2.2)"><path d="M-60,-20 C-60,-60 -30,-80 0,-80 C30,-80 60,-60 60,-20 C60,20 40,40 0,40 C-40,40 -60,20 -60,-20 Z" stroke="#0f766e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M-45,-68 L-55,-100 L-20,-78" stroke="#0f766e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M45,-68 L55,-100 L20,-78" stroke="#0f766e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M-30,-25 Q-20,-15 -10,-25" stroke="#0f766e" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M10,-25 Q20,-15 30,-25" stroke="#0f766e" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M-5,-10 L5,-10 L0,-5 Z" fill="#0f766e"/><path d="M0,-5 Q-5,5 -10,2 M0,-5 Q5,5 10,2" stroke="#0f766e" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M-40,-5 L-65,-8" stroke="#0f766e" stroke-width="4" stroke-linecap="round"/><path d="M-42,5 L-68,7" stroke="#0f766e" stroke-width="4" stroke-linecap="round"/><path d="M40,-5 L65,-8" stroke="#0f766e" stroke-width="4" stroke-linecap="round"/><path d="M42,5 L68,7" stroke="#0f766e" stroke-width="4" stroke-linecap="round"/><path d="M-30,35 C-30,70 -10,90 0,90 C10,90 30,70 30,35" stroke="#0f766e" stroke-width="6" stroke-linecap="round" fill="none"/><path d="M25,75 C45,75 55,60 55,45 C55,30 45,25 40,30 C35,35 40,45 45,45" stroke="#0f766e" stroke-width="6" stroke-linecap="round" fill="none"/></g></svg>',
  },
] as const;

export const DEMO_SEED_ATTACHMENT_RESOURCES = [...DEMO_SEED_RESOURCES, ...DEMO_ATTACHMENT_RESOURCES];
export const DEMO_SEED_NOTEBOOK_IDS = DEMO_SEED_NOTEBOOKS.map((notebook) => notebook.id);
export const DEMO_SEED_MEMO_IDS = DEMO_SEED_MEMOS.map((memo) => memo.id);
