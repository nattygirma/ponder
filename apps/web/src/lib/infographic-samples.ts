export type InfographicSampleCategory =
  | "sequence"
  | "compare"
  | "list"
  | "quadrant"
  | "hierarchy"
  | "relation"
  | "chart";

export type InfographicSample = {
  id: string;
  category: InfographicSampleCategory;
  template: string;
  titleEn: string;
  titleJa?: string;
  descEn: string;
  descJa?: string;
  syntaxEn: string;
};

export const INFOGRAPHIC_SAMPLE_CATEGORIES: Array<{
  id: InfographicSampleCategory;
  key: string;
  labelEn: string;
  labelJa: string;
}> = [
  { id: "sequence", key: "sequenceCategory", labelEn: "Sequence", labelJa: "順序・工程" },
  { id: "compare", key: "comparisonCategory", labelEn: "Comparison", labelJa: "比較・SWOT" },
  { id: "list", key: "listCategory", labelEn: "List", labelJa: "リスト" },
  { id: "quadrant", key: "quadrantCategory", labelEn: "Quadrant", labelJa: "四象限" },
  { id: "hierarchy", key: "hierarchyCategory", labelEn: "Hierarchy", labelJa: "階層・マインドマップ" },
  { id: "relation", key: "relationCategory", labelEn: "Relation", labelJa: "関係ネットワーク" },
  { id: "chart", key: "chartCategory", labelEn: "Chart", labelJa: "チャート" },
];

export const INFOGRAPHIC_SAMPLES: InfographicSample[] = [
  // 1. sequence
  {
    id: "sequence-steps",
    category: "sequence",
    template: "sequence-steps-simple",
    titleEn: "Product Development Lifecycle",
    titleJa: "製品開発ライフサイクル",
    descEn: "Standard agile workflow from discovery to deployment",
    descJa: "要件定義からリリースまでの標準アジャイル開発フロー",
    syntaxEn: `infographic sequence-steps-simple
data
  title Product Development Lifecycle
  desc Key stages from discovery to production launch
  sequences
    - label Discovery & Specs
      desc Gather user feedback and define key requirements
    - label UI & Prototype
      desc Design user flows and high-fidelity mockups
    - label Agile Sprint
      desc Full-stack engineering and feature implementation
    - label Quality Assurance
      desc Automated tests, regression audits, and performance checks
    - label Production Release
      desc Phased rollout and real-time observability`,
  },
  {
    id: "sequence-timeline",
    category: "sequence",
    template: "sequence-timeline-done-list",
    titleEn: "Company Milestones Timeline",
    titleJa: "企業の主要マイルストーン",
    descEn: "Key turning points from inception to scale",
    descJa: "創業からスケール期までの重要マイルストーン",
    syntaxEn: `infographic sequence-timeline-done-list
data
  title Company Milestones Timeline
  desc Key turning points from inception to scale
  sequences
    - label 2022 Founding
      desc Core team assembled and seed round completed
    - label 2023 Product 1.0
      desc Surpassed first 10,000 active users
    - label 2024 Monetization
      desc Enterprise collaboration launched with break-even revenue
    - label 2025 Global Expansion
      desc Multi-region compliance and localized deployments`,
  },
  {
    id: "sequence-roadmap",
    category: "sequence",
    template: "sequence-roadmap-vertical-simple",
    titleEn: "Architecture Evolution Roadmap",
    titleJa: "技術アーキテクチャのロードマップ",
    descEn: "Infrastructure modernization and cloud-native journey",
    descJa: "インフラ刷新とクラウドネイティブ化の歩み",
    syntaxEn: `infographic sequence-roadmap-vertical-simple
data
  title Architecture Evolution Roadmap
  desc Infrastructure modernization and cloud-native journey
  sequences
    - label Phase 1: Modular Monolith
      desc Decouple core domain models and define clean contracts
    - label Phase 2: Containerization
      desc Adopt Kubernetes for declarative deployments and scaling
    - label Phase 3: Service Mesh
      desc Introduce Istio for traffic control and fine-grained telemetry
    - label Phase 4: AIOps Automation
      desc Autonomous anomaly detection and self-healing alerts`,
  },

  // 2. compare
  {
    id: "compare-vs",
    category: "compare",
    template: "compare-binary-horizontal-compact-card-vs",
    titleEn: "Cloud-Native vs Traditional Hosting",
    titleJa: "クラウドネイティブと従来運用の比較",
    descEn: "Architectural agility and infrastructure cost trade-offs",
    descJa: "拡張性と運用コストの包括的な比較分析",
    syntaxEn: `infographic compare-binary-horizontal-compact-card-vs
data
  title Cloud-Native vs Traditional Hosting
  desc Architectural agility and infrastructure cost trade-offs
  compares
    - label Traditional Dedicated Server
      desc Fixed on-premise hardware and manual maintenance
      children
        - label Scalability
          desc Provisioning new hardware takes weeks or months
        - label Resource Utilization
          desc Peak-provisioned servers sit idle most of the day
        - label Operational Overhead
          desc Manual patching and slower disaster recovery
    - label Cloud-Native Platform
      desc Containerized orchestration with on-demand autoscaling
      children
        - label Scalability
          desc Sub-second auto-scaling handles traffic spikes seamlessly
        - label Resource Utilization
          desc Dynamic multi-tenant scheduling cuts infrastructure cost 40%
        - label Operational Overhead
          desc Automated CI/CD pipelines and self-healing nodes`,
  },
  {
    id: "compare-swot",
    category: "compare",
    template: "compare-swot",
    titleEn: "Strategic SWOT Analysis",
    titleJa: "製品戦略の SWOT 分析",
    descEn: "Internal strengths/weaknesses and external market opportunities/threats",
    descJa: "内部の強み・弱みと外部の機会・脅威の網羅分析",
    syntaxEn: `infographic compare-swot
data
  title Strategic SWOT Analysis
  desc Internal strengths/weaknesses and external market environment
  compares
    - label Strengths
      children
        - label Proprietary Tech
          desc Industry-leading offline-first sync algorithms
        - label Rapid Execution
          desc Flat engineering team with bi-weekly stable releases
    - label Weaknesses
      children
        - label Brand Awareness
          desc Early stage market presence still expanding
        - label Mobile Parity
          desc Advanced cross-platform interactions still maturing
    - label Opportunities
      children
        - label Remote Collaboration
          desc Global demand for lightweight self-hosted knowledge bases
        - label AI Agent Ecosystem
          desc Model Context Protocol unlocks novel assistant workflows
    - label Threats
      children
        - label Incumbent Bundling
          desc Big-tech suites offering free bundled alternatives
        - label Compliance Complexity
          desc Stricter multi-region data residency and audits`,
  },
  {
    id: "compare-arrow",
    category: "compare",
    template: "compare-binary-horizontal-simple-arrow",
    titleEn: "Engineering Workflow Evolution",
    titleJa: "エンジニアリング体系の進化",
    descEn: "Transition from manual operations to modern automated workflows",
    descJa: "手動オペレーションから自動化パイプラインへの進化",
    syntaxEn: `infographic compare-binary-horizontal-simple-arrow
data
  title Engineering Workflow Evolution
  desc Transition from manual tasks to fully automated pipelines
  compares
    - label Legacy: Manual & Fragmented
      desc Ad-hoc scripts and tribal knowledge
      children
        - label Release Cadence
          desc Monthly batch releases with accumulated risk
        - label Quality Gate
          desc Manual QA passes with high escape rates
    - label Modern: Continuous & Automated
      desc Git push triggers end-to-end verification
      children
        - label Release Cadence
          desc Trunk-based development deployable anytime
        - label Quality Gate
          desc 90% test coverage with automated branch protection`,
  },

  // 3. list
  {
    id: "list-grid",
    category: "list",
    template: "list-grid-simple",
    titleEn: "Team Collaboration Principles",
    titleJa: "チーム協調の 5 大原則",
    descEn: "Fostering a transparent, autonomous, and predictable culture",
    descJa: "自律的で予測可能な高効率エンジニアリング文化",
    syntaxEn: `infographic list-grid-simple
data
  title Team Collaboration Principles
  desc Fostering a transparent, autonomous, and predictable culture
  lists
    - label Async First
      desc Document decisions clearly to minimize disruptive meetings
    - label Docs as Code
      desc Core architecture and standards reviewed in Markdown
    - label Small Iterations
      desc Merge short-lived branches frequently to derisk integration
    - label Automated Verification
      desc Strict unit and integration gates catch regressions early
    - label Value Focused
      desc Prioritize user outcome and polish over bureaucracy`,
  },
  {
    id: "list-pyramid",
    category: "list",
    template: "list-pyramid-compact-card",
    titleEn: "DIKW Knowledge Hierarchy",
    titleJa: "DIKW ピラミッドモデル",
    descEn: "Cognitive progression from raw facts to actionable wisdom",
    descJa: "データから知恵への認知の階層的ステップ",
    syntaxEn: `infographic list-pyramid-compact-card
data
  title DIKW Knowledge Hierarchy
  desc Cognitive progression from raw facts to actionable wisdom
  lists
    - label Wisdom
      desc Foresight, strategic clarity, and principled judgment
    - label Knowledge
      desc Contextual understanding, mental models, and expertise
    - label Information
      desc Structured, organized, and relational data points
    - label Data
      desc Objective facts, signals, and raw observations`,
  },

  // 4. quadrant
  {
    id: "quadrant-matrix",
    category: "quadrant",
    template: "compare-quadrant-quarter-simple-card",
    titleEn: "Eisenhower Priority Matrix",
    titleJa: "時間管理のマトリクス",
    descEn: "Allocate focus and bandwidth by importance and urgency",
    descJa: "重要度と緊急度で優先順位を整理する枠組み",
    syntaxEn: `infographic compare-quadrant-quarter-simple-card
data
  title Eisenhower Priority Matrix
  desc Allocate focus and bandwidth by importance and urgency
  compares
    - label Q1: Urgent & Important
      desc Production crises, hard deadlines, and pressing issues
    - label Q2: Not Urgent but Important
      desc Strategic planning, refactoring, learning, and self-care
    - label Q3: Urgent but Not Important
      desc Unplanned interruptions, trivial requests, and busywork
    - label Q4: Not Urgent & Not Important
      desc Distractions, mindless browsing, and low-value tasks`,
  },

  // 5. hierarchy
  {
    id: "hierarchy-mindmap",
    category: "hierarchy",
    template: "hierarchy-mindmap-branch-gradient-lined-palette",
    titleEn: "Modern Web Architecture",
    titleJa: "モダン Web フルスタック体系",
    descEn: "Core technical components of modern web applications",
    descJa: "モダン Web アプリケーションの要素と技術選定",
    syntaxEn: `infographic hierarchy-mindmap-branch-gradient-lined-palette
data
  title Modern Web Architecture
  desc Core technical components of modern web applications
  root
    label Full-Stack Stack
    children
      - label Frontend Layer
        desc React & Vite reactive interfaces
      - label Backend Services
        desc Hono on edge serverless runtime
      - label Storage Layer
        desc D1 SQLite & R2 object storage
      - label AI Synergy
        desc Model Context Protocol tools`,
  },

  // 6. relation
  {
    id: "relation-network",
    category: "relation",
    template: "relation-network-simple-circle-node",
    titleEn: "Distributed Microservice Mesh",
    titleJa: "分散サービス・トポロジー",
    descEn: "Invocations and data pipelines between core services",
    descJa: "マイクロサービス間の連携とデータフロー",
    syntaxEn: `infographic relation-network-simple-circle-node
data
  title Distributed Microservice Mesh
  desc Invocations and data pipelines between core services
  nodes
    - id gateway
      label API Gateway
      desc Ingress routing and TLS termination
    - id auth
      label Auth Service
      desc Token validation and RBAC enforcement
    - id note
      label Note Core
      desc Content revision engine and SQLite storage
    - id sync
      label Sync Engine
      desc Offline cursors and conflict resolution
  relations
    - from gateway
      to auth
    - from gateway
      to note
    - from note
      to sync`,
  },

  // 7. chart
  {
    id: "chart-donut",
    category: "chart",
    template: "chart-pie-donut-plain-text",
    titleEn: "User Acquisition Breakdown",
    titleJa: "ユーザー獲得チャネル比率",
    descEn: "Share of new active users across primary channels",
    descJa: "新規アクティブユーザーの獲得チャネル内訳",
    syntaxEn: `infographic chart-pie-donut-plain-text
data
  title User Acquisition Breakdown
  desc Share of new active users across primary channels
  values
    - label Open Source Word-of-Mouth
      value 45
    - label Organic Search
      value 25
    - label Tech Blogs & Social
      value 18
    - label Developer Events
      value 12`,
  },
  {
    id: "chart-column",
    category: "chart",
    template: "chart-column-simple",
    titleEn: "Quarterly Feature Delivery",
    titleJa: "四半期ごとの機能リリース速度",
    descEn: "Number of major customer-facing capabilities shipped",
    descJa: "過去 4 四半期に提供した主要機能の推移",
    syntaxEn: `infographic chart-column-simple
data
  title Quarterly Feature Delivery
  desc Number of major customer-facing capabilities shipped
  values
    - label Q1
      value 18
    - label Q2
      value 26
    - label Q3
      value 35
    - label Q4
      value 42`,
  },
];

export function getSampleSyntax(sample: InfographicSample, lang?: string): string {
  return sample.syntaxEn;
}

export function getSampleTitle(sample: InfographicSample, lang?: string): string {
  if (lang && lang.toLowerCase().startsWith("ja")) return sample.titleJa ?? sample.titleEn;
  return sample.titleEn;
}

export function getSampleDesc(sample: InfographicSample, lang?: string): string {
  if (lang && lang.toLowerCase().startsWith("ja")) return sample.descJa ?? sample.descEn;
  return sample.descEn;
}
