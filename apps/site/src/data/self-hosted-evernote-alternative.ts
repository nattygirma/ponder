export const alternativePageCopy = {
  "en-US": {
    eyebrow: "Self-hosted notes",
    title: "A self-hosted Evernote alternative with Docker and Cloudflare",
    description:
      "Ponder is an open-source, AI-native notes workspace with the classic Evernote three-pane layout. Run it on Cloudflare's free tier, or install the same app with Docker on a VPS, NAS, or home server.",
    lead: [
      "Ponder is for people who still want a reliable, open, self-hosted personal knowledge base. The stack is open source. Notes live in SQLite you control, with a REST API, MCP, and a documented Evernote ENEX migration path.",
      "It is not a social timeline and not a folder of local Markdown files. The workspace stays close to classic Evernote: notebook tree, note list, editor.",
    ],
    fitTitle: "Who it is for",
    fit: [
      "You want Evernote-style notebooks, not a timeline or a file vault.",
      "You want to self-host instead of paying a notes SaaS or hitting device caps.",
      "You want Cloudflare's free tier, or a one-line Docker install on a VPS or NAS.",
      "You want coding agents such as Claude Code, Codex, or WorkBuddy to read and organize notes through native MCP & ACP.",
    ],
    notFitTitle: "Who it is not for",
    notFit: [
      "If you need default end-to-end encryption like Joplin, Ponder does not advertise E2EE. The boundary is that you host the instance.",
      "If you need Notion-style databases and block workspaces, stay on Notion or a Notion-like app. Ponder is a notes workspace.",
      "If you only want local files and no server, Obsidian or a Markdown folder may fit better.",
    ],
    compareTitle: "How it differs from common options",
    compareIntro:
      "Joplin is the usual self-hosted Evernote alternative in English search results. Ponder is closer to the classic three-pane notes app, and it ships both Cloudflare free-tier hosting and Docker. The table only records facts that can be checked in this repository or in those products' public docs. It is not a ranking of which tool is better overall.",
    compareHeaders: ["", "Hosting", "Layout", "Clients", "Evernote import"],
    compareRows: [
      ["Ponder", "Cloudflare free tier or Docker", "Three-pane notebooks", "macOS / Windows / Linux / iOS / Android / clipper", "Documented ENEX + MCP flow"],
      ["Evernote", "Vendor cloud, not self-hosted", "Three-pane notebooks", "All major platforms", "—"],
      ["Joplin", "Joplin Server or your sync target", "Notebooks", "Official apps", "ENEX supported"],
      ["Obsidian", "Local files; official sync is paid", "File vault", "All major platforms", "Community tools"],
      ["Memos", "Self-hostable", "Timeline cards", "Web-first", "Not this migration path"],
    ],
    pathsTitle: "What to do next",
    paths: [
      {
        title: "Self-host on Cloudflare",
        summary: "The default for personal use if you do not want to run a server. A personal library typically fits about 150,000 short notes and 50,000 images.",
        href: "/blog/ai-agent-deploy-cloudflare",
        cta: "Open the Cloudflare guide",
      },
      {
        title: "Self-host with Docker",
        summary: "The same application, installed with one command on a VPS, NAS, or home server. Storage scales with your disk or S3-compatible bucket.",
        href: "/docker-deploy",
        cta: "Open the Docker guide",
      },
      {
        title: "Migrate from Evernote",
        summary: "Use ENEX, evernote-backup, and Ponder MCP to keep notebook hierarchy, attachments, and timestamps.",
        href: "/blog/evernote-migration-guide",
        cta: "Open the Evernote guide",
      },
      {
        title: "Migrate from Notion",
        summary: "Use Notion MCP together with Ponder MCP and let an AI assistant copy pages across.",
        href: "/blog/notion-migration-guide",
        cta: "Open the Notion guide",
      },
    ],
    faqTitle: "FAQ",
    faqs: [
      {
        question: "What is a self-hosted Evernote alternative?",
        answer:
          "A notes app you deploy yourself, with data in your account or on your hardware, and a workflow close to Evernote notebooks and the three-pane workspace. Ponder is built for that, plus open source, MCP, and Cloudflare or Docker hosting.",
      },
      {
        question: "Can I run it with Docker?",
        answer:
          "Yes. There is a one-line installer and a full Docker guide for amd64 and arm64, with local files or S3-compatible object storage. Cloudflare and Docker run the same application.",
      },
      {
        question: "Can I import Evernote notes?",
        answer:
          "Yes. The documented flow uses ENEX, evernote-backup, and an MCP import script. It preserves created/updated timestamps and nested notebooks. Spot-check notes with images after import.",
      },
      {
        question: "Is Cloudflare actually free for personal use?",
        answer:
          "A personal deployment can run within Cloudflare's free quotas, with no extra server to rent. Quotas follow Cloudflare's current limits; move to a paid plan or Docker if you outgrow them.",
      },
      {
        question: "Are there iOS and Android apps?",
        answer:
          "Yes. Android is on Google Play and iOS is on the App Store. The iOS app currently requires an Apple ID from outside mainland China. Web Clipper extensions are on Chrome, Edge, and Firefox.",
      },
      {
        question: "Is Ponder affiliated with Evernote?",
        answer:
          "No. Ponder is an independent open-source alternative. Migration guides only cover data you already own. Evernote is a trademark of its respective owner.",
      },
    ],
  },
  ja: {
    eyebrow: "セルフホストのノート",
    title: "Docker と Cloudflare で動く、セルフホストの Evernote 代替",
    description:
      "Ponder はオープンソースで AI ネイティブなノート作業領域です。Evernote の三ペインを残し、Cloudflare 無料枠か、VPS / NAS / 自宅サーバーの Docker で同じアプリを動かせます。",
    lead: [
      "長く Evernote を使い、信頼できて開かれていて、自分で置ける個人知識ベースが欲しい人向けです。スタックはオープンソース。ノートは自分で制御する SQLite にあり、REST API、MCP、文書化された ENEX 移行があります。",
      "タイムライン型の断片ノートでも、ローカル Markdown フォルダでもありません。ノートブックツリー、ノート一覧、編集エリアという古典的な三ペインです。",
    ],
    fitTitle: "向いている人",
    fit: [
      "タイムラインやファイル倉庫ではなく、Evernote 型のノートブックが欲しい。",
      "ノート SaaS や端末数の課金をやめ、自分でホストしたい。",
      "Cloudflare 無料枠か、VPS / NAS への Docker 一行インストールが欲しい。",
      "Claude Code や Codex、WorkBuddy などの Agent に、ネイティブ MCP や ACP でノートを連携させたい。",
    ],
    notFitTitle: "向いていない人",
    notFit: [
      "Joplin のような既定のエンドツーエンド暗号が必要なら、Ponder は E2EE を売りにしていません。境界は「インスタンスを自分でホストする」ことです。",
      "Notion 型のデータベースとブロック作業領域が必要なら、Notion か同類を続けてください。Ponder はノート作業領域です。",
      "サーバーなしのローカルフォルダだけでよければ、Obsidian や Markdown ディレクトリの方が合うことがあります。",
    ],
    compareTitle: "よくある選択肢との違い",
    compareIntro:
      "英語圏の検索では Joplin が定番の自前 Evernote 代替です。Ponder は古典的な三ペインに近く、Cloudflare 無料枠と Docker の両方を出しています。表はリポジトリと公開ドキュメントで確認できる事実だけです。総合ランキングではありません。",
    compareHeaders: ["", "ホスト", "レイアウト", "クライアント", "Evernote 取り込み"],
    compareRows: [
      ["Ponder", "Cloudflare 無料枠または Docker", "三ペインのノートブック", "macOS / Windows / Linux / iOS / Android / Clipper", "文書化された ENEX + MCP"],
      ["Evernote", "ベンダークラウド、自前不可", "三ペインのノートブック", "主要プラットフォーム", "—"],
      ["Joplin", "Joplin Server または任意の同期", "ノートブック", "公式マルチ端", "ENEX 対応"],
      ["Obsidian", "ローカルファイル。公式同期は有料", "ファイル倉庫", "主要プラットフォーム", "コミュニティ手段"],
      ["Memos", "自前運用可", "タイムラインのカード", "Web 中心", "同じ移行経路ではない"],
    ],
    pathsTitle: "次にすること",
    paths: [
      {
        title: "Cloudflare で自前運用",
        summary: "サーバーを持ちたくない個人向け。個人規模なら短いノート約 15 万、画像約 5 万が目安。",
        href: "/blog/ai-agent-deploy-cloudflare",
        cta: "Cloudflare 導入を見る",
      },
      {
        title: "Docker で自前運用",
        summary: "同じアプリを、VPS、NAS、自宅サーバーへ一行で入れられます。保存先はディスクや S3 互換バケットで伸ばせます。",
        href: "/docker-deploy",
        cta: "Docker 導入を見る",
      },
      {
        title: "Evernote から移行",
        summary: "ENEX、evernote-backup、Ponder MCP で階層、添付、タイムスタンプを残します。",
        href: "/blog/evernote-migration-guide",
        cta: "Evernote ガイドを見る",
      },
      {
        title: "Notion から移行",
        summary: "Notion MCP と Ponder MCP を使い、AI アシスタントにページを渡します。",
        href: "/blog/notion-migration-guide",
        cta: "Notion ガイドを見る",
      },
    ],
    faqTitle: "よくある質問",
    faqs: [
      {
        question: "セルフホストの Evernote 代替とは何ですか？",
        answer:
          "自分で導入し、データは自分のアカウントか機材に置き、Evernote のノートブックと三ペインに近い作業領域を持つノートアプリです。Ponder はそのために作り、オープンソース、MCP、Cloudflare / Docker を足しています。",
      },
      {
        question: "Docker で動かせますか？",
        answer:
          "できます。一行インストーラと、amd64 / arm64、ローカル保存または S3 互換オブジェクトストレージの Docker ガイドがあります。Cloudflare と Docker は同じアプリです。",
      },
      {
        question: "Evernote を取り込めますか？",
        answer:
          "できます。文書化された流れは ENEX、evernote-backup、MCP 取り込みスクリプトです。作成・更新時刻と入れ子ノートブックを残します。画像付きノートは取り込み後に抜き取り確認してください。",
      },
      {
        question: "Cloudflare の個人利用は本当に無料ですか？",
        answer:
          "Cloudflare の無料枠内で動かせ、サーバーを別途借りる必要はありません。枠は Cloudflare の方針に従います。足りなくなったら有料プランか Docker へ移せます。",
      },
      {
        question: "iOS と Android アプリはありますか？",
        answer:
          "あります。Android は Google Play、iOS は App Store です。iOS は現時点で中国本土以外の Apple ID が必要です。Chrome / Edge / Firefox の Clipper もあります。",
      },
      {
        question: "Ponder と Evernote の関係は？",
        answer:
          "提携も後援もありません。Ponder は独立したオープンソースの代替です。移行ガイドは、すでに自分で持っているデータだけを扱います。Evernote は権利者の商標です。",
      },
    ],
  },
  pl: {
    eyebrow: "Samodzielnie hostowane notatki",
    title: "Samodzielnie hostowana alternatywa dla Evernote z Dockerem i Cloudflare",
    description:
      "Ponder to otwartoźródłowy, natywnie wspierający AI obszar roboczy do notatek z klasycznym trzypanelowym układem Evernote. Uruchom go w darmowym planie Cloudflare albo zainstaluj tę samą aplikację w Dockerze na VPS, NAS lub domowym serwerze.",
    lead: [
      "Ponder jest dla osób, które wciąż chcą niezawodnej, otwartej, samodzielnie hostowanej osobistej bazy wiedzy. Cały stos jest otwartoźródłowy. Notatki są przechowywane w kontrolowanej przez Ciebie bazie SQLite, z REST API, MCP i udokumentowaną ścieżką migracji ENEX z Evernote.",
      "To nie jest społecznościowa oś czasu ani folder lokalnych plików Markdown. Obszar roboczy pozostaje bliski klasycznemu Evernote: drzewo notatników, lista notatek, edytor.",
    ],
    fitTitle: "Dla kogo",
    fit: [
      "Chcesz notatników w stylu Evernote, a nie osi czasu czy magazynu plików.",
      "Chcesz hostować samodzielnie zamiast płacić za SaaS do notatek lub trafiać na limity urządzeń.",
      "Chcesz korzystać z darmowego planu Cloudflare albo zainstalować Dockera jedną linią na VPS lub NAS.",
      "Chcesz, by agenci programistyczni, tacy jak Claude Code, Codex czy WorkBuddy, czytali i porządkowali notatki przez natywne MCP i ACP.",
    ],
    notFitTitle: "Dla kogo nie",
    notFit: [
      "Jeśli potrzebujesz domyślnego szyfrowania end-to-end jak w Joplin – Ponder nie reklamuje E2EE. Granicą bezpieczeństwa jest to, że sam hostujesz instancję.",
      "Jeśli potrzebujesz baz danych i bloków w stylu Notion, zostań przy Notion lub podobnej aplikacji. Ponder to obszar roboczy do notatek.",
      "Jeśli chcesz tylko lokalnych plików bez serwera, lepiej sprawdzi się Obsidian lub folder z plikami Markdown.",
    ],
    compareTitle: "Czym różni się od popularnych opcji",
    compareIntro:
      "W anglojęzycznych wynikach wyszukiwania typową samodzielnie hostowaną alternatywą dla Evernote jest Joplin. Ponder jest bliższy klasycznej trzypanelowej aplikacji do notatek i oferuje zarówno hosting w darmowym planie Cloudflare, jak i Dockera. Tabela zawiera wyłącznie fakty, które można sprawdzić w tym repozytorium lub w publicznej dokumentacji tych produktów. Nie jest to ranking, które narzędzie jest ogólnie lepsze.",
    compareHeaders: ["", "Hosting", "Układ", "Klienty", "Import z Evernote"],
    compareRows: [
      ["Ponder", "Darmowy plan Cloudflare lub Docker", "Notatniki w trzech panelach", "macOS / Windows / Linux / iOS / Android / Clipper", "Udokumentowany proces ENEX + MCP"],
      ["Evernote", "Chmura dostawcy, bez samodzielnego hostingu", "Notatniki w trzech panelach", "Wszystkie główne platformy", "—"],
      ["Joplin", "Joplin Server lub wybrany cel synchronizacji", "Notatniki", "Oficjalne aplikacje", "Obsługa ENEX"],
      ["Obsidian", "Pliki lokalne; oficjalna synchronizacja jest płatna", "Magazyn plików", "Wszystkie główne platformy", "Narzędzia społeczności"],
      ["Memos", "Możliwy samodzielny hosting", "Karty na osi czasu", "Głównie web", "Nie ta ścieżka migracji"],
    ],
    pathsTitle: "Co dalej",
    paths: [
      {
        title: "Samodzielny hosting w Cloudflare",
        summary: "Domyślny wybór do użytku osobistego, jeśli nie chcesz utrzymywać serwera. Osobista biblioteka zwykle mieści ok. 150 000 krótkich notatek i 50 000 obrazów.",
        href: "/blog/ai-agent-deploy-cloudflare",
        cta: "Otwórz poradnik Cloudflare",
      },
      {
        title: "Samodzielny hosting z Dockerem",
        summary: "Ta sama aplikacja instalowana jednym poleceniem na VPS, NAS lub domowym serwerze. Magazyn rośnie razem z dyskiem lub zasobnikiem zgodnym z S3.",
        href: "/docker-deploy",
        cta: "Otwórz poradnik Dockera",
      },
      {
        title: "Migracja z Evernote",
        summary: "Użyj ENEX, evernote-backup i Ponder MCP, aby zachować hierarchię notatników, załączniki i znaczniki czasu.",
        href: "/blog/evernote-migration-guide",
        cta: "Otwórz poradnik Evernote",
      },
      {
        title: "Migracja z Notion",
        summary: "Użyj Notion MCP razem z Ponder MCP i pozwól asystentowi AI skopiować strony.",
        href: "/blog/notion-migration-guide",
        cta: "Otwórz poradnik Notion",
      },
    ],
    faqTitle: "Najczęstsze pytania",
    faqs: [
      {
        question: "Czym jest samodzielnie hostowana alternatywa dla Evernote?",
        answer:
          "To aplikacja do notatek, którą wdrażasz samodzielnie, z danymi na Twoim koncie lub sprzęcie i sposobem pracy bliskim notatnikom i trzypanelowemu obszarowi roboczemu Evernote. Ponder powstał właśnie w tym celu, a do tego jest otwartoźródłowy, obsługuje MCP i hosting w Cloudflare lub Dockerze.",
      },
      {
        question: "Czy mogę uruchomić go w Dockerze?",
        answer:
          "Tak. Dostępny jest instalator w jednej linii i pełny poradnik Dockera dla amd64 i arm64, z plikami lokalnymi lub magazynem obiektów zgodnym z S3. Cloudflare i Docker uruchamiają tę samą aplikację.",
      },
      {
        question: "Czy mogę zaimportować notatki z Evernote?",
        answer:
          "Tak. Udokumentowany proces wykorzystuje ENEX, evernote-backup i skrypt importu MCP. Zachowuje daty utworzenia i aktualizacji oraz zagnieżdżone notatniki. Po imporcie wyrywkowo sprawdź notatki z obrazami.",
      },
      {
        question: "Czy Cloudflare naprawdę jest darmowy do użytku osobistego?",
        answer:
          "Osobiste wdrożenie może działać w ramach darmowych limitów Cloudflare, bez wynajmowania dodatkowego serwera. Limity zależą od aktualnych zasad Cloudflare; jeśli przestaną wystarczać, przejdź na płatny plan lub Dockera.",
      },
      {
        question: "Czy są aplikacje na iOS i Androida?",
        answer:
          "Tak. Aplikacja na Androida jest w Google Play, a na iOS w App Store. Aplikacja na iOS wymaga obecnie Apple ID spoza Chin kontynentalnych. Rozszerzenia Web Clipper są dostępne dla Chrome, Edge i Firefox.",
      },
      {
        question: "Czy Ponder jest powiązany z Evernote?",
        answer:
          "Nie. Ponder to niezależna, otwartoźródłowa alternatywa. Poradniki migracji dotyczą wyłącznie danych, które już do Ciebie należą. Evernote jest znakiem towarowym swojego właściciela.",
      },
    ],
  },
} as const;
