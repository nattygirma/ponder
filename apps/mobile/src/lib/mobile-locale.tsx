import { DEFAULT_MEMO_TITLE, getMemoSaveErrorReasonKey } from "@ponder/shared";
import { enUS, ja, pl, ru } from "@ponder/shared/i18n";
import { resolveSupportedLocale } from "@ponder/shared/i18n/locales";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  readMobileLocalePreference,
  writeMobileLocalePreference,
  type MobileLocalePreference,
} from "./preferences";

type SupportedMobileLocale = "en-US" | "ja" | "pl" | "ru";
export type MobileLocale = SupportedMobileLocale;
type MobileLocaleContextValue = {
  preference: MobileLocalePreference;
  resolvedLocale: SupportedMobileLocale;
  setPreference: (preference: MobileLocalePreference) => void;
  translate: (value: string) => string;
};

type TranslationPair = { source: string; target: string; pattern?: RegExp; placeholders?: string[] };

const mobileOnlyJapanese = new Map<string, string>([
  ["OK", "OK"],
  ["OK", "OK"],
  ["Sign in", "ログイン"],
  ["Could not delete", "削除できませんでした"],
  ["Deleting", "削除しています"],
  ["Restoring", "復元しています"],
  ["Could not restore", "復元できませんでした"],
  ["Could not create", "作成できませんでした"],
  ["Please try again", "再試行してください"],
  ["Check your network and try again", "ネットワークを確認して再試行してください"],
  ["Cannot reach the instance right now. Try again later.", "現在インスタンスに接続できません。しばらくしてから再試行してください。"],
  ["Try a different keyword", "別のキーワードで試してください"],
  ["No matching notes", "一致するノートはありません"],
  ["Retry loading", "再読み込み"],
  ["Create a notebook first", "先にノートブックを作成してください"],
  ["Could not upload the attachment", "添付をアップロードできませんでした"],
  ["Saving", "保存しています"],
  ["Preparing", "準備しています"],
  ["Local draft", "ローカル下書き"],
  ["Not saved", "未保存"],
  ["The note data is missing, so the rich text editor cannot open.", "ノートのデータがないため、リッチテキストエディタを開けません。"],
  ["Could not load the note", "ノートを読み込めませんでした"],
  ["Starts editing and moves focus to the title", "編集を開始してタイトルにフォーカスします"],
  ["Edit note title", "ノートのタイトルを編集"],
  ["Change the note's notebook", "ノートのノートブックを変更"],
  ["Select a version to preview and restore it.", "履歴を選ぶとプレビューして復元できます。"],
  ["The attachment cannot be read right now.", "現在添付を読み込めません。"],
  ["The resource cannot be read right now.", "現在リソースを読み込めません。"],
  ["Wait for the note to finish syncing.", "ノートの同期が終わるまでお待ちください。"],
  ["Could not read the resource", "リソースを読み込めませんでした"],
  ["Download canceled", "ダウンロードをキャンセルしました"],
  ["This device cannot open the system share sheet", "この端末ではシステムの共有シートを開けません"],
  ["Signed in, but the server did not return a mobile session. Make sure the server is updated to a version that supports app sign-in.", "サインインしましたが、サーバーがモバイルセッションを返しませんでした。サーバーがアプリのサインインに対応したバージョンに更新されているか確認してください。"],
  ["New notebook", "新しいノートブック"],
  ["Create notebook", "ノートブックを作成"],
  ["Notebook name", "ノートブック名"],
  ["Top level", "最上位"],
  ["Under {{name}}", "「{{name}}」の下"],
  ["No notebooks", "ノートブックがありません"],
  ["Create a notebook to start taking notes.", "ノートブックを作成して記録を始めましょう。"],
  ["Could not create the notebook. Try again.", "ノートブックを作成できませんでした。再試行してください。"],
  ["Connection is not ready", "接続の準備ができていません"],
  ["Notebook created", "ノートブックを作成しました"],
  ["The local cache could not update. Syncing again now.", "端末のキャッシュを更新できませんでした。再同期しています。"],
  ["No notes directly in this notebook", "このノートブック直下にノートはありません"],
  ["Could not save the \"Show notes from sub-notebooks\" setting. Please try again.", "「サブノートブックのノートを表示」の設定を保存できませんでした。しばらくしてから再試行してください。"],
  ["Its sub-notebooks still contain {{count}} notes. Open a sub-notebook to see them, or turn on \"Show notes from sub-notebooks\" in Settings.", "サブノートブックにはまだ {{count}} 件のノートがあります。サブノートブックを開くか、設定で「サブノートブックのノートを表示」をオンにしてください。"],
  ["Back", "戻る"],
  ["Close dialog", "ダイアログを閉じる"],
  ["Switch to dark mode", "ダークモードに切り替え"],
  ["Switch to light mode", "ライトモードに切り替え"],
  ["Finish editing", "編集を終える"],
  ["Finish creating note", "ノート作成を終える"],
  ["Edit Markdown source", "Markdown ソースを編集"],
  ["Resources", "リソース"],
  ["Note list actions", "ノート一覧の操作"],
  ["Search", "検索"],
  ["Search titles, content, or tags", "タイトル、本文、タグを検索"],
  ["Enter a keyword to search", "キーワードを入力して検索"],
  ["Search the local synced cache with instant results", "端末内の同期キャッシュを検索し、結果をすぐ表示します"],
  ["Note actions", "ノート操作"],
  ["AI note assistant", "AI ノートアシスタント"],
  ["Version history", "版履歴"],
  ["Share note", "ノートを共有"],
  ["Share as image", "画像として共有"],
  ["Select note", "ノートを選択"],
  ["Copy note ID", "ノート ID をコピー"],
  ["Copy note ID after sync", "同期後にノート ID をコピー"],
  ["Note ID copied", "ノート ID をコピーしました"],
  ["Could not copy note ID", "ノート ID をコピーできませんでした"],
  ["Could not share", "共有できませんでした"],
  ["Could not create a share link. Check your connection and try again.", "共有リンクを作成できませんでした。接続を確認して再試行してください。"],
  ["Sync conflict", "同期の競合"],
  ["Sync failed", "同期に失敗しました"],
  ["Pending sync", "同期待ち"],
  ["Synced", "同期済み"],
  ["Sync now", "今すぐ同期"],
  ["View sync status and retry now", "同期状態を見て今すぐ再試行"],
  ["Local changes are waiting to upload. You can retry sync now.", "ローカルの変更はまだアップロード待ちです。今すぐ同期を再試行できます。"],
  ["Local changes could not upload. You can retry sync now.", "ローカルの変更をアップロードできませんでした。今すぐ同期を再試行できます。"],
  ["Local changes could not upload. They remain on this device and you can retry now.", "ローカルの変更をアップロードできませんでした。内容は端末に残っており、今すぐ再試行できます。"],
  ["Local changes are pending upload. Pull to refresh or tap to sync now.", "ローカルの変更はアップロード待ちです。下に引くか、ここをタップして今すぐ同期できます。"],
  ["Review and resolve the sync conflict", "同期の競合を確認して解消"],
  ["The cloud note was updated in another tab, on another device, or while you were offline. Copy your local draft, then use the cloud version before editing again.", "クラウド上のノートが他のタブ、他の端末、またはオフライン中に更新されたため、ローカル下書きで上書きできません。先に下書きをコピーし、クラウド版を採用してから編集を続けてください。"],
  ["The cloud note was updated in another tab, on another device, or while you were offline. Copy your local draft, then use the cloud version before editing again.", "クラウド上のノートが他のタブ、他の端末、またはオフライン中に更新されました。先に下書きをコピーし、クラウド版を採用してから編集を続けてください。"],
  ["View history", "履歴を見る"],
  ["Use cloud version", "クラウド版を使う"],
  ["Use cloud and reload", "クラウド版を使って再読み込み"],
  ["Could not use the cloud version", "クラウド版を使えませんでした"],
  ["Copy local draft", "ローカル下書きをコピー"],
  ["Local draft copied to the clipboard.", "ローカル下書きをクリップボードにコピーしました。"],
  ["There is no local draft to copy.", "コピーできるローカル下書きはありません。"],
  ["Copied", "コピーしました"],
  ["More", "その他"],
  ["Failed to load", "読み込めませんでした"],
  ["Please try again later", "しばらくしてから再試行してください"],
  ["Retry", "再試行"],
  ["Image upload failed", "画像のアップロードに失敗しました"],
  ["Check your connection and try again", "接続を確認して再試行してください"],
  ["Add image or attachment", "画像または添付を追加"],
  ["Take a photo or choose from your library or device", "撮影、ライブラリ、またはファイルから選ぶ"],
  ["Close image source picker", "画像ソースの選択を閉じる"],
  ["Take photo", "写真を撮る"],
  ["Choose from library", "ライブラリから選ぶ"],
  ["Choose file", "ファイルを選ぶ"],
  ["Camera access required", "カメラの許可が必要です"],
  ["Allow Ponder to use the camera to take photos and insert them into notes.", "カメラで撮影してノートに入れるには、Ponder のカメラ使用を許可してください。"],
  ["Camera access is disabled. Open system settings and allow Ponder to use the camera.", "カメラの許可がオフです。システム設定で Ponder のカメラ使用を許可してください。"],
  ["Open settings", "設定を開く"],
  ["The system could not restore the previously selected image. Please try again.", "前回選んだ画像をシステムが復元できませんでした。再試行してください。"],
  ["Exit the new note?", "新しいノートを閉じますか？"],
  ["The content is saved as a local draft and will be restored the next time you create a note.", "内容はローカル下書きとして保存済みで、次に新規作成するときに復元されます。"],
  ["Keep editing", "編集を続ける"],
  ["Discard draft", "下書きを捨てる"],
  ["Keep and exit", "残して閉じる"],
  ["Discard local changes?", "ローカルの変更を捨てますか？"],
  ["This removes the queued local change without modifying the server note.", "この操作は同期待ちの記録だけを消し、サーバー上のノートは変更しません。"],
  ["Discard", "捨てる"],
  ["New note is syncing", "新しいノートを同期しています"],
  ["Local images can be uploaded after the first sync. Image links can already be pasted into the note.", "初回同期のあとでローカル画像をアップロードできます。画像リンクは今すぐ本文に貼れます。"],
  ["Save changes?", "変更を保存しますか？"],
  ["This note has unsaved changes.", "このノートには未保存の変更があります。"],
  ["Discard changes", "変更を捨てる"],
  ["Unable to open resource", "リソースを開けません"],
  ["No installed app can open this link.", "このリンクを開けるアプリがありません。"],
  ["Deleted notes cannot receive attachments. Restore the note first.", "削除済みノートには添付をアップロードできません。先に復元してください。"],
  ["Image preview", "画像プレビュー"],
  ["Zoom in", "拡大"],
  ["Zoom out", "縮小"],
  ["Previous image", "前の画像"],
  ["Next image", "次の画像"],
  ["Open original file", "元のファイルを開く"],
  ["Password updated", "パスワードを更新しました"],
  ["Use the new password the next time you sign in.", "次回のログインから新しいパスワードを使ってください。"],
  ["Edit note", "ノートを編集"],
  ["Notebook", "ノートブック"],
  ["Note title", "ノートのタイトル"],
  ["Note tags", "ノートのタグ"],
  ["Choose notebook", "ノートブックを選ぶ"],
  ["Select existing tags or enter a name to create a new one", "既存のタグを選ぶか、名前を入力して新規作成"],
  ["Filter by tag", "タグで絞り込み"],
  ["Choose a tag to view only notes with that tag", "タグを選ぶと、そのタグのノートだけを表示します"],
  ["Search tags", "タグを検索"],
  ["No matching tags", "一致するタグはありません"],
  ["Search or enter a new tag", "検索するか、新しいタグを入力"],
  ["No matching tags. You can create a new one.", "一致する既存タグはありません。新規作成できます。"],
  ["Create", "作成"],
  ["{{count}} notes", "{{count}} 件のノート"],
  ["Refresh tokens", "トークンを更新"],
  ["Token name", "トークン名"],
  ["No content preview", "本文プレビューはありません"],
  ["Native runtime startup", "ネイティブ実行環境の起動"],
  ["Launch to JavaScript execution", "JS 実行までの起動"],
  ["Launch to session/cache ready", "セッション/キャッシュ準備までの起動"],
  ["Launch to workspace first frame", "ワークスペース初回描画までの起動"],
  ["Launch to list data ready", "一覧データ準備までの起動"],
  ["Launch to interaction idle", "操作可能になるまでの起動"],
  ["Latest local editor startup", "直近のローカルエディタ起動"],
  ["Starting editor", "エディタを起動しています"],
  ["The editor is taking too long to start", "エディタの起動に時間がかかっています"],
  ["Preparing the local editor. Your note is safe.", "ローカルエディタを準備しています。ノートの内容は失われません。"],
  ["The local editor did not start in time. You can retry or go back; your current draft will not be lost.", "ローカルエディタが時間内に起動しませんでした。再試行するか戻ってください。下書きは失われません。"],
  ["Unavailable", "利用できません"],
  ["Not recorded", "未記録"],
  ["Searching", "検索中"],
  ["Exit search", "検索を終了"],
  ["Reset", "リセット"],
  ["Pinned", "ピン留め"],
  ["Tagged", "タグあり"],
  ["Untagged", "タグなし"],
  ["Syncing your notes", "ノートを同期しています"],
  ["Preparing your notes for the first sync…", "初回同期を準備しています…"],
  ["Loading notes", "ノートを読み込んでいます"],
  ["Loading notebooks and notes…", "ノートブックとノートを読み込んでいます…"],
  ["Sync paused", "同期を一時停止しました"],
  ["Loaded notes remain available. Check your connection and retry.", "読み込み済みのノートは使えます。接続を確認して再試行してください。"],
  ["{{count}} selected", "{{count}} 件を選択"],
  ["Results: {{count}}", "結果: {{count}} 件"],
  ["Filter: {{filter}} · {{count}} notes", "絞り込み: {{filter}} · {{count}} 件"],
  ["Loaded {{loaded}} of {{total}} notes", "{{loaded}} / {{total}} 件のノートを読み込み済み"],
  ["New from template", "テンプレートから作成"],
  ["Template", "テンプレート"],
  ["Choose a template to get started. Every template can be edited or deleted on the web.", "テンプレートを選んで始めます。テンプレートの編集と削除はウェブからできます。"],
  ["Templates could not load. Please try again later.", "テンプレートを読み込めませんでした。しばらくしてから再試行してください。"],
  ["No templates yet. Create one or save a note as a template on the web.", "テンプレートはまだありません。ウェブで作成するか、よく使うノートをテンプレートとして保存できます。"],
  ["Loading templates", "テンプレートを読み込んでいます"],
  ["New note", "新しいノート"],
  ["Choose how to create", "作成方法を選ぶ"],
  ["Blank note", "空白のノート"],
  ["Start with an empty page", "空白のページから書き始める"],
  ["Use meeting notes, weekly reviews, and more", "会議メモや週報などの型を使う"],
  ["Apply template?", "テンプレートを適用しますか？"],
  ["The current content will be replaced by the template.", "現在の内容はテンプレートの内容に置き換わります。"],
  ["Replace", "置き換え"],
  ["Close", "閉じる"],
  ["Keeps this device signed in and signs out other sessions.", "この端末のログインは維持し、他の端末のセッションは終了します。"],
  ["Add tags", "タグを追加"],
  ["Generating smart tags", "スマートタグを生成しています"],
  ["Could not generate smart tags", "スマートタグを生成できませんでした"],
  ["Smart tags added", "スマートタグを追加しました"],
  ["No new tags fit this note.", "このノートに合う新しいタグはありません。"],
  ["No matching notebooks", "一致するノートブックはありません"],
  ["Preferences", "環境設定"],
  ["Choose the language used in the app.", "アプリの表示言語を切り替えます。"],
  ["Compress large images on this device before upload.", "大きな画像はアップロード前にこの端末で圧縮し、容量を抑えます。"],
  ["Restored your unfinished local draft", "前回の未完成の下書きを復元しました"],
  ["Connect to your self-hosted notes", "セルフホストのノートスペースに接続"],
  ["Password for first sign-in", "初回ログインのパスワード"],
  ["GitHub repository", "GitHub リポジトリ"],
  ["Something went wrong. Please try again.", "操作に失敗しました。しばらくしてから再試行してください。"],
  ["Clipping article", "記事を取り込んでいます"],
  ["Extracting the title, body, and image links…", "タイトル、本文、画像リンクを抽出しています…"],
  ["Article extraction failed", "本文を取り込めませんでした"],
  ["The article link was kept. Share it again later to retry.", "記事リンクは残してあります。あとから再共有してやり直せます。"],
  ["The page finished loading, but there was no article text to clip.", "ページの読み込みは終わりましたが、取り込める本文がありません。"],
  ["The WeChat article took too long to load.", "WeChat 記事の読み込みがタイムアウトしました。"],
  ["No article text was found to clip.", "取り込める本文が見つかりません。"],
  ["Could not read the WeChat article text.", "WeChat 記事の本文を読み取れませんでした。"],
  ["Could not load the WeChat article.", "WeChat 記事を読み込めませんでした。"],
  ["The WeChat article request failed (HTTP {{status}}).", "WeChat 記事のリクエストに失敗しました（HTTP {{status}}）。"],
  ["Could not read the shared image", "共有された画像を読み取れませんでした"],
  ["Share it again and retry.", "もう一度共有してから再試行してください。"],
  ["Unable to save images", "画像を保存できませんでした"],
  ["Create a notebook in Ponder first.", "先に Ponder でノートブックを作成してください。"],
  ["Shared image", "共有された画像"],
  ["Shared images ({{count}})", "共有された画像（{{count}} 枚）"],
  ["Could not read the shared content", "共有された内容を読み取れませんでした"],
  ["The shared content has no recognizable web link or image.", "共有された内容に、認識できるウェブリンクも画像もありません。"],
  ["Unable to save clip", "クリップを保存できませんでした"],
  ["Could not clip the page", "ページを取り込めませんでした"],
  ["Could not read the shared page. Try again later.", "共有されたページを読み取れませんでした。しばらくしてから再試行してください。"],
  ["Edit note title: {{title}}", "ノートのタイトルを編集: {{title}}"],
  ["Create tag {{name}}", "タグ {{name}} を作成"],
  ["Tag {{name}}", "タグ {{name}}"],
  ["{{label}}, update available", "{{label}}、アップデートがあります"],
  ["The attachment could not be read completely. Choose the file again.", "添付ファイルを最後まで読み込めませんでした。ファイルを選び直してください。"],
]);

const mobileOnlyPolish = new Map<string, string>([
  ["OK", "OK"],
  ["OK", "OK"],
  ["Sign in", "Zaloguj się"],
  ["Could not delete", "Nie udało się usunąć"],
  ["Deleting", "Usuwanie"],
  ["Restoring", "Przywracanie"],
  ["Could not restore", "Nie udało się przywrócić"],
  ["Could not create", "Nie udało się utworzyć"],
  ["Please try again", "Spróbuj ponownie"],
  ["Check your network and try again", "Sprawdź sieć i spróbuj ponownie"],
  ["Cannot reach the instance right now. Try again later.", "Nie można teraz połączyć się z instancją. Spróbuj ponownie później."],
  ["Try a different keyword", "Spróbuj innego słowa kluczowego"],
  ["No matching notes", "Brak pasujących notatek"],
  ["Retry loading", "Wczytaj ponownie"],
  ["Create a notebook first", "Najpierw utwórz notatnik"],
  ["Could not upload the attachment", "Nie udało się przesłać załącznika"],
  ["Saving", "Zapisywanie"],
  ["Preparing", "Przygotowywanie"],
  ["Local draft", "Wersja robocza na urządzeniu"],
  ["Not saved", "Nie zapisano"],
  ["The note data is missing, so the rich text editor cannot open.", "Brak danych notatki, więc nie można otworzyć edytora tekstu sformatowanego."],
  ["Could not load the note", "Nie udało się wczytać notatki"],
  ["Starts editing and moves focus to the title", "Rozpoczyna edycję i przenosi fokus na tytuł"],
  ["Edit note title", "Edytuj tytuł notatki"],
  ["Change the note's notebook", "Zmień notatnik tej notatki"],
  ["Select a version to preview and restore it.", "Wybierz wersję, aby ją podejrzeć i przywrócić."],
  ["The attachment cannot be read right now.", "Nie można teraz odczytać załącznika."],
  ["The resource cannot be read right now.", "Nie można teraz odczytać zasobu."],
  ["Wait for the note to finish syncing.", "Poczekaj na zakończenie synchronizacji notatki."],
  ["Could not read the resource", "Nie udało się odczytać zasobu"],
  ["Download canceled", "Pobieranie anulowane"],
  ["This device cannot open the system share sheet", "Na tym urządzeniu nie można otworzyć systemowego okna udostępniania"],
  ["Signed in, but the server did not return a mobile session. Make sure the server is updated to a version that supports app sign-in.", "Zalogowano, ale serwer nie zwrócił sesji mobilnej. Upewnij się, że serwer jest zaktualizowany do wersji obsługującej logowanie w aplikacji."],
  ["New notebook", "Nowy notatnik"],
  ["Create notebook", "Utwórz notatnik"],
  ["Notebook name", "Nazwa notatnika"],
  ["Top level", "Najwyższy poziom"],
  ["Under {{name}}", "W notatniku „{{name}}”"],
  ["No notebooks", "Brak notatników"],
  ["Create a notebook to start taking notes.", "Utwórz notatnik, aby zacząć robić notatki."],
  ["Could not create the notebook. Try again.", "Nie udało się utworzyć notatnika. Spróbuj ponownie."],
  ["Connection is not ready", "Połączenie nie jest jeszcze gotowe"],
  ["Notebook created", "Notatnik utworzony"],
  ["The local cache could not update. Syncing again now.", "Nie udało się zaktualizować lokalnej pamięci podręcznej. Trwa ponowna synchronizacja."],
  ["No notes directly in this notebook", "Brak notatek bezpośrednio w tym notatniku"],
  ["Could not save the \"Show notes from sub-notebooks\" setting. Please try again.", "Nie udało się zapisać ustawienia „Pokazuj notatki z podnotatników”. Spróbuj ponownie później."],
  ["Its sub-notebooks still contain {{count}} notes. Open a sub-notebook to see them, or turn on \"Show notes from sub-notebooks\" in Settings.", "Notatki w podnotatnikach: {{count}}. Otwórz podnotatnik, aby je zobaczyć, lub włącz w ustawieniach opcję „Pokazuj notatki z podnotatników”."],
  ["Back", "Wstecz"],
  ["Close dialog", "Zamknij okno"],
  ["Switch to dark mode", "Przełącz na ciemny motyw"],
  ["Switch to light mode", "Przełącz na jasny motyw"],
  ["Finish editing", "Zakończ edycję"],
  ["Finish creating note", "Zakończ tworzenie notatki"],
  ["Edit Markdown source", "Edytuj źródło Markdown"],
  ["Resources", "Zasoby"],
  ["Note list actions", "Działania na liście notatek"],
  ["Search", "Szukaj"],
  ["Search titles, content, or tags", "Szukaj w tytułach, treści lub tagach"],
  ["Enter a keyword to search", "Wpisz słowo kluczowe, aby wyszukać"],
  ["Search the local synced cache with instant results", "Przeszukuj lokalną kopię zsynchronizowanych notatek z natychmiastowymi wynikami"],
  ["Note actions", "Działania na notatce"],
  ["AI note assistant", "Asystent AI notatek"],
  ["Version history", "Historia wersji"],
  ["Share note", "Udostępnij notatkę"],
  ["Share as image", "Udostępnij jako obraz"],
  ["Select note", "Wybierz notatkę"],
  ["Copy note ID", "Kopiuj ID notatki"],
  ["Copy note ID after sync", "ID notatki można skopiować po synchronizacji"],
  ["Note ID copied", "Skopiowano ID notatki"],
  ["Could not copy note ID", "Nie udało się skopiować ID notatki"],
  ["Could not share", "Nie udało się udostępnić"],
  ["Could not create a share link. Check your connection and try again.", "Nie udało się utworzyć linku udostępniania. Sprawdź połączenie i spróbuj ponownie."],
  ["Sync conflict", "Konflikt synchronizacji"],
  ["Sync failed", "Synchronizacja nie powiodła się"],
  ["Pending sync", "Oczekuje na synchronizację"],
  ["Synced", "Zsynchronizowano"],
  ["Sync now", "Synchronizuj teraz"],
  ["View sync status and retry now", "Zobacz stan synchronizacji i spróbuj ponownie"],
  ["Local changes are waiting to upload. You can retry sync now.", "Lokalne zmiany czekają na przesłanie. Możesz teraz ponowić synchronizację."],
  ["Local changes could not upload. You can retry sync now.", "Nie udało się przesłać lokalnych zmian. Możesz teraz ponowić synchronizację."],
  ["Local changes could not upload. They remain on this device and you can retry now.", "Nie udało się przesłać lokalnych zmian. Pozostają na tym urządzeniu i możesz teraz spróbować ponownie."],
  ["Local changes are pending upload. Pull to refresh or tap to sync now.", "Lokalne zmiany czekają na przesłanie. Przeciągnij w dół lub dotknij, aby zsynchronizować teraz."],
  ["Review and resolve the sync conflict", "Przejrzyj i rozwiąż konflikt synchronizacji"],
  ["The cloud note was updated in another tab, on another device, or while you were offline. Copy your local draft, then use the cloud version before editing again.", "Notatka w chmurze została zmieniona w innej karcie, na innym urządzeniu lub gdy byłeś offline, więc lokalny szkic nie może jej nadpisać. Skopiuj lokalny szkic, a potem użyj wersji z chmury i kontynuuj edycję."],
  ["The cloud note was updated in another tab, on another device, or while you were offline. Copy your local draft, then use the cloud version before editing again.", "Notatka w chmurze została zmieniona w innej karcie, na innym urządzeniu lub gdy byłeś offline. Skopiuj lokalny szkic, a potem użyj wersji z chmury i kontynuuj edycję."],
  ["View history", "Zobacz historię"],
  ["Use cloud version", "Użyj wersji z chmury"],
  ["Use cloud and reload", "Użyj wersji z chmury i wczytaj ponownie"],
  ["Could not use the cloud version", "Nie udało się użyć wersji z chmury"],
  ["Copy local draft", "Kopiuj lokalny szkic"],
  ["Local draft copied to the clipboard.", "Skopiowano lokalny szkic do schowka."],
  ["There is no local draft to copy.", "Brak lokalnego szkicu do skopiowania."],
  ["Copied", "Skopiowano"],
  ["More", "Więcej"],
  ["Failed to load", "Nie udało się wczytać"],
  ["Please try again later", "Spróbuj ponownie później"],
  ["Retry", "Spróbuj ponownie"],
  ["Image upload failed", "Nie udało się przesłać obrazu"],
  ["Check your connection and try again", "Sprawdź połączenie i spróbuj ponownie"],
  ["Add image or attachment", "Dodaj obraz lub załącznik"],
  ["Take a photo or choose from your library or device", "Zrób zdjęcie lub wybierz z galerii albo z plików urządzenia"],
  ["Close image source picker", "Zamknij wybór źródła obrazu"],
  ["Take photo", "Zrób zdjęcie"],
  ["Choose from library", "Wybierz z galerii"],
  ["Choose file", "Wybierz plik"],
  ["Camera access required", "Wymagany dostęp do aparatu"],
  ["Allow Ponder to use the camera to take photos and insert them into notes.", "Zezwól Ponder na używanie aparatu, aby robić zdjęcia i wstawiać je do notatek."],
  ["Camera access is disabled. Open system settings and allow Ponder to use the camera.", "Dostęp do aparatu jest wyłączony. Otwórz ustawienia systemu i zezwól Ponder na używanie aparatu."],
  ["Open settings", "Otwórz ustawienia"],
  ["The system could not restore the previously selected image. Please try again.", "System nie mógł przywrócić ostatnio wybranego obrazu. Spróbuj ponownie."],
  ["Exit the new note?", "Zamknąć nową notatkę?"],
  ["The content is saved as a local draft and will be restored the next time you create a note.", "Treść zapisano jako lokalny szkic. Zostanie przywrócona przy następnym tworzeniu notatki."],
  ["Keep editing", "Kontynuuj edycję"],
  ["Discard draft", "Odrzuć szkic"],
  ["Keep and exit", "Zachowaj i zamknij"],
  ["Discard local changes?", "Odrzucić lokalne zmiany?"],
  ["This removes the queued local change without modifying the server note.", "Usuwa to oczekującą lokalną zmianę bez modyfikowania notatki na serwerze."],
  ["Discard", "Odrzuć"],
  ["New note is syncing", "Trwa synchronizacja nowej notatki"],
  ["Local images can be uploaded after the first sync. Image links can already be pasted into the note.", "Lokalne obrazy można przesłać po pierwszej synchronizacji. Linki do obrazów możesz wkleić do treści już teraz."],
  ["Save changes?", "Zapisać zmiany?"],
  ["This note has unsaved changes.", "Ta notatka ma niezapisane zmiany."],
  ["Discard changes", "Odrzuć zmiany"],
  ["Unable to open resource", "Nie można otworzyć zasobu"],
  ["No installed app can open this link.", "Żadna zainstalowana aplikacja nie może otworzyć tego linku."],
  ["Deleted notes cannot receive attachments. Restore the note first.", "Do usuniętej notatki nie można przesyłać załączników. Najpierw ją przywróć."],
  ["Image preview", "Podgląd obrazu"],
  ["Zoom in", "Powiększ"],
  ["Zoom out", "Pomniejsz"],
  ["Previous image", "Poprzedni obraz"],
  ["Next image", "Następny obraz"],
  ["Open original file", "Otwórz oryginalny plik"],
  ["Password updated", "Zaktualizowano hasło"],
  ["Use the new password the next time you sign in.", "Przy następnym logowaniu użyj nowego hasła."],
  ["Edit note", "Edytuj notatkę"],
  ["Notebook", "Notatnik"],
  ["Note title", "Tytuł notatki"],
  ["Note tags", "Tagi notatki"],
  ["Choose notebook", "Wybierz notatnik"],
  ["Select existing tags or enter a name to create a new one", "Wybierz istniejące tagi lub wpisz nazwę, aby utworzyć nowy"],
  ["Filter by tag", "Filtruj według tagu"],
  ["Choose a tag to view only notes with that tag", "Wybierz tag, aby zobaczyć tylko notatki z tym tagiem"],
  ["Search tags", "Szukaj tagów"],
  ["No matching tags", "Brak pasujących tagów"],
  ["Search or enter a new tag", "Szukaj lub wpisz nowy tag"],
  ["No matching tags. You can create a new one.", "Brak pasujących tagów. Możesz utworzyć nowy."],
  ["Create", "Utwórz"],
  ["{{count}} notes", "Notatki: {{count}}"],
  ["Refresh tokens", "Odśwież tokeny"],
  ["Token name", "Nazwa tokenu"],
  ["No content preview", "Brak podglądu treści"],
  ["Native runtime startup", "Uruchamianie natywnego środowiska"],
  ["Launch to JavaScript execution", "Od uruchomienia do wykonania JavaScript"],
  ["Launch to session/cache ready", "Od uruchomienia do gotowości sesji/pamięci podręcznej"],
  ["Launch to workspace first frame", "Od uruchomienia do pierwszej klatki obszaru roboczego"],
  ["Launch to list data ready", "Od uruchomienia do gotowości danych listy"],
  ["Launch to interaction idle", "Od uruchomienia do gotowości na interakcję"],
  ["Latest local editor startup", "Ostatnie uruchomienie lokalnego edytora"],
  ["Starting editor", "Uruchamianie edytora"],
  ["The editor is taking too long to start", "Uruchamianie edytora trwa zbyt długo"],
  ["Preparing the local editor. Your note is safe.", "Przygotowywanie lokalnego edytora. Twoja notatka jest bezpieczna."],
  ["The local editor did not start in time. You can retry or go back; your current draft will not be lost.", "Lokalny edytor nie uruchomił się na czas. Spróbuj ponownie lub wróć – bieżący szkic nie zostanie utracony."],
  ["Unavailable", "Niedostępne"],
  ["Not recorded", "Nie zarejestrowano"],
  ["Searching", "Wyszukiwanie"],
  ["Exit search", "Zamknij wyszukiwanie"],
  ["Reset", "Resetuj"],
  ["Pinned", "Przypięte"],
  ["Tagged", "Z tagami"],
  ["Untagged", "Bez tagów"],
  ["Syncing your notes", "Synchronizowanie notatek"],
  ["Preparing your notes for the first sync…", "Przygotowywanie pierwszej synchronizacji…"],
  ["Loading notes", "Wczytywanie notatek"],
  ["Loading notebooks and notes…", "Wczytywanie notatników i notatek…"],
  ["Sync paused", "Synchronizacja wstrzymana"],
  ["Loaded notes remain available. Check your connection and retry.", "Wczytane notatki są nadal dostępne. Sprawdź połączenie i spróbuj ponownie."],
  ["{{count}} selected", "Zaznaczono: {{count}}"],
  ["Results: {{count}}", "Wyniki: {{count}}"],
  ["Filter: {{filter}} · {{count}} notes", "Filtr: {{filter}} · notatki: {{count}}"],
  ["Loaded {{loaded}} of {{total}} notes", "Wczytane notatki: {{loaded}} z {{total}}"],
  ["New from template", "Nowa z szablonu"],
  ["Template", "Szablony"],
  ["Choose a template to get started. Every template can be edited or deleted on the web.", "Wybierz szablon, aby szybko zacząć. Każdy szablon można edytować lub usunąć w wersji webowej."],
  ["Templates could not load. Please try again later.", "Nie udało się wczytać szablonów. Spróbuj ponownie później."],
  ["No templates yet. Create one or save a note as a template on the web.", "Brak szablonów. Utwórz szablon w wersji webowej lub zapisz notatkę jako szablon."],
  ["Loading templates", "Wczytywanie szablonów"],
  ["New note", "Nowa notatka"],
  ["Choose how to create", "Wybierz sposób tworzenia"],
  ["Blank note", "Pusta notatka"],
  ["Start with an empty page", "Zacznij od pustej strony"],
  ["Use meeting notes, weekly reviews, and more", "Użyj gotowych struktur, np. notatek ze spotkań czy podsumowań tygodnia"],
  ["Apply template?", "Zastosować szablon?"],
  ["The current content will be replaced by the template.", "Bieżąca treść zostanie zastąpiona treścią szablonu."],
  ["Replace", "Zastąp"],
  ["Close", "Zamknij"],
  ["Keeps this device signed in and signs out other sessions.", "To urządzenie pozostanie zalogowane, a pozostałe sesje zostaną wylogowane."],
  ["Add tags", "Dodaj tagi"],
  ["Generating smart tags", "Generowanie inteligentnych tagów"],
  ["Could not generate smart tags", "Nie udało się wygenerować inteligentnych tagów"],
  ["Smart tags added", "Dodano inteligentne tagi"],
  ["No new tags fit this note.", "Brak nowych tagów pasujących do tej notatki."],
  ["No matching notebooks", "Brak pasujących notatników"],
  ["Preferences", "Preferencje"],
  ["Choose the language used in the app.", "Wybierz język interfejsu aplikacji."],
  ["Compress large images on this device before upload.", "Kompresuj duże obrazy na tym urządzeniu przed przesłaniem."],
  ["Restored your unfinished local draft", "Przywrócono niedokończony lokalny szkic"],
  ["Connect to your self-hosted notes", "Połącz się ze swoimi samodzielnie hostowanymi notatkami"],
  ["Password for first sign-in", "Hasło do pierwszego logowania"],
  ["GitHub repository", "Repozytorium GitHub"],
  ["Something went wrong. Please try again.", "Coś poszło nie tak. Spróbuj ponownie."],
  ["Clipping article", "Zapisywanie artykułu"],
  ["Extracting the title, body, and image links…", "Wyodrębnianie tytułu, treści i linków do obrazów…"],
  ["Article extraction failed", "Nie udało się wyodrębnić treści artykułu"],
  ["The article link was kept. Share it again later to retry.", "Link do artykułu został zachowany. Udostępnij go ponownie później, aby spróbować jeszcze raz."],
  ["The page finished loading, but there was no article text to clip.", "Strona się wczytała, ale nie znaleziono treści artykułu do zapisania."],
  ["The WeChat article took too long to load.", "Wczytywanie artykułu WeChat trwało zbyt długo."],
  ["No article text was found to clip.", "Nie znaleziono treści artykułu do zapisania."],
  ["Could not read the WeChat article text.", "Nie udało się odczytać treści artykułu WeChat."],
  ["Could not load the WeChat article.", "Nie udało się wczytać artykułu WeChat."],
  ["The WeChat article request failed (HTTP {{status}}).", "Żądanie artykułu WeChat nie powiodło się (HTTP {{status}})."],
  ["Could not read the shared image", "Nie udało się odczytać udostępnionego obrazu"],
  ["Share it again and retry.", "Udostępnij ponownie i spróbuj jeszcze raz."],
  ["Unable to save images", "Nie można zapisać obrazów"],
  ["Create a notebook in Ponder first.", "Najpierw utwórz notatnik w Ponder."],
  ["Shared image", "Udostępniony obraz"],
  ["Shared images ({{count}})", "Udostępnione obrazy ({{count}})"],
  ["Could not read the shared content", "Nie udało się odczytać udostępnionej treści"],
  ["The shared content has no recognizable web link or image.", "Udostępniona treść nie zawiera rozpoznawalnego linku ani obrazu."],
  ["Unable to save clip", "Nie można zapisać wycinka"],
  ["Could not clip the page", "Nie udało się zapisać strony"],
  ["Could not read the shared page. Try again later.", "Nie udało się odczytać udostępnionej strony. Spróbuj ponownie później."],
  ["Edit note title: {{title}}", "Edytuj tytuł notatki: {{title}}"],
  ["Create tag {{name}}", "Utwórz tag {{name}}"],
  ["Tag {{name}}", "Tag {{name}}"],
  ["{{label}}, update available", "{{label}}, dostępna aktualizacja"],
  ["The attachment could not be read completely. Choose the file again.", "Nie udało się odczytać całego załącznika. Wybierz plik ponownie."],
]);

const flattenStrings = (value: unknown, prefix = "", output = new Map<string, string>()) => {
  if (typeof value === "string") {
    output.set(prefix, value);
    return output;
  }
  if (!value || typeof value !== "object") {
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    flattenStrings(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const createTranslationPair = (source: string, target: string): TranslationPair => {
  const placeholders: string[] = [];
  const patternSource = escapeRegExp(source).replace(/\\\{\\\{(\w+)\\\}\\\}/g, (_match, placeholder: string) => {
    placeholders.push(placeholder);
    return "(.+?)";
  });
  return {
    source,
    target,
    pattern: placeholders.length > 0 ? new RegExp(`^${patternSource}$`) : undefined,
    placeholders,
  };
};
const enStrings = flattenStrings(enUS);
const jaStrings = flattenStrings(ja);
const plStrings = flattenStrings(pl);
const ruStrings = flattenStrings(ru);

const buildTranslationPairs = (targets: Map<string, string>) =>
  Array.from(enStrings.entries()).flatMap(([key, source]) => {
    const target = targets.get(key);
    if (!target || source === target) {
      return [];
    }
    return [createTranslationPair(source, target)];
  });

const jaTranslationPairs = buildTranslationPairs(jaStrings);
const plTranslationPairs = buildTranslationPairs(plStrings);
const ruTranslationPairs = buildTranslationPairs(ruStrings);
const exactJapaneseTranslations = new Map(
  jaTranslationPairs.filter((pair) => !pair.pattern).map((pair) => [pair.source, pair.target]),
);
const exactPolishTranslations = new Map(
  plTranslationPairs.filter((pair) => !pair.pattern).map((pair) => [pair.source, pair.target]),
);
const exactRussianTranslations = new Map(
  ruTranslationPairs.filter((pair) => !pair.pattern).map((pair) => [pair.source, pair.target]),
);
const mobileJapaneseTemplateTranslations: TranslationPair[] = Array.from(mobileOnlyJapanese.entries())
  .filter(([source]) => source.includes("{{"))
  .map(([source, target]) => createTranslationPair(source, target));
const mobilePolishTemplateTranslations: TranslationPair[] = Array.from(mobileOnlyPolish.entries())
  .filter(([source]) => source.includes("{{"))
  .map(([source, target]) => createTranslationPair(source, target));
const japaneseTemplateTranslations = [
  ...mobileJapaneseTemplateTranslations,
  ...jaTranslationPairs.filter((pair) => pair.pattern),
].sort((left, right) => right.source.length - left.source.length);
const polishTemplateTranslations = [
  ...mobilePolishTemplateTranslations,
  ...plTranslationPairs.filter((pair) => pair.pattern),
].sort((left, right) => right.source.length - left.source.length);
const russianTemplateTranslations = ruTranslationPairs
  .filter((pair) => pair.pattern)
  .sort((left, right) => right.source.length - left.source.length);

type LocalizedCatalog<T> = { readonly [K in keyof T]: T[K] extends string ? string : LocalizedCatalog<T[K]> };
export type MobileCatalog = LocalizedCatalog<typeof enUS>;

// Typing every locale against the English shape makes a missing key a compile error.
const mobileCatalogs: Record<SupportedMobileLocale, MobileCatalog> = { "en-US": enUS, ja, pl, ru };

export const getMobileCatalog = (locale: SupportedMobileLocale): MobileCatalog => mobileCatalogs[locale];

export const formatMobileCopy = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in values ? String(values[name]) : match));

const resolveSystemLocale = (): SupportedMobileLocale =>
  resolveSupportedLocale(Intl.DateTimeFormat().resolvedOptions().locale);

const applyTemplateTranslations = (value: string, pairs: TranslationPair[]) => {
  for (const pair of pairs) {
    const match = pair.pattern?.exec(value);
    if (!match) {
      continue;
    }
    return (pair.placeholders ?? []).reduce(
      (translated, placeholder, index) => translated.replace(`{{${placeholder}}}`, match[index + 1] ?? ""),
      pair.target,
    );
  }
  return null;
};

export const translateMobileText = (value: string, locale: SupportedMobileLocale) => {
  if (locale === "en-US") {
    return value;
  }
  if (locale === "ja") {
    const exact = mobileOnlyJapanese.get(value) ?? exactJapaneseTranslations.get(value);
    if (exact) return exact;
    return applyTemplateTranslations(value, japaneseTemplateTranslations) ?? value;
  }
  if (locale === "pl") {
    const exact = mobileOnlyPolish.get(value) ?? exactPolishTranslations.get(value);
    if (exact) return exact;
    return applyTemplateTranslations(value, polishTemplateTranslations) ?? value;
  }
  if (locale === "ru") {
    const exact = exactRussianTranslations.get(value);
    if (exact) return exact;
    return applyTemplateTranslations(value, russianTemplateTranslations) ?? value;
  }
  return value;
};

let currentResolvedMobileLocale: SupportedMobileLocale = resolveSystemLocale();
export const translateCurrentMobileText = (value: string) => translateMobileText(value, currentResolvedMobileLocale);

/** Maps a known English server sync error to its catalog text so the localized components translate it. */
export const toMobileSyncErrorSourceText = (message: string | null) => {
  const key = message ? getMemoSaveErrorReasonKey(null, message) : null;
  return (key && enStrings.get(key)) || message;
};

export const localizeUntitledMemoTitle = (
  title: string | null | undefined,
  locale: SupportedMobileLocale,
) => {
  const trimmed = title?.trim() ?? "";
  if (trimmed && trimmed !== DEFAULT_MEMO_TITLE) {
    return trimmed;
  }
  return translateMobileText(DEFAULT_MEMO_TITLE, locale);
};

export const localizeMissingNotebookName = (locale: SupportedMobileLocale) => {
  if (locale === "ja") return "未分類";
  if (locale === "pl") return "Nieprzypisane";
  if (locale === "ru") return "Без блокнота";
  return "Uncategorized";
};

const MobileLocaleContext = createContext<MobileLocaleContextValue>({
  preference: "system",
  resolvedLocale: resolveSystemLocale(),
  setPreference: () => undefined,
  translate: (value) => value,
});

export const MobileLocaleProvider = ({ children }: { children: ReactNode }) => {
  const [preference, setPreferenceState] = useState<MobileLocalePreference>("system");

  useEffect(() => {
    let active = true;
    void readMobileLocalePreference().then((storedPreference) => {
      if (active) {
        setPreferenceState(storedPreference);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const resolvedLocale = preference === "system" ? resolveSystemLocale() : preference;
  currentResolvedMobileLocale = resolvedLocale;
  const value = useMemo<MobileLocaleContextValue>(
    () => ({
      preference,
      resolvedLocale,
      setPreference: (nextPreference) => {
        setPreferenceState(nextPreference);
        void writeMobileLocalePreference(nextPreference);
      },
      translate: (text) => translateMobileText(text, resolvedLocale),
    }),
    [preference, resolvedLocale]
  );

  return <MobileLocaleContext.Provider value={value}>{children}</MobileLocaleContext.Provider>;
};

export const useMobileLocale = () => useContext(MobileLocaleContext);
