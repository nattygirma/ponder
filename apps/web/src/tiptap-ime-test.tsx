import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import "./styles/tiptap-ime-test.css";

type LogEntry = {
  id: number;
  event: string;
  activeElement: string;
  textLength: number;
  time: string;
  inputType?: string;
  data?: string | null;
  key?: string;
  isComposing?: boolean;
};

let nextLogId = 1;

const nowTime = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });

const activeElementLabel = () => {
  const element = document.activeElement;
  if (!element) {
    return "none";
  }

  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const className =
    element instanceof HTMLElement && element.className
      ? `.${String(element.className).trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
  const role = element.getAttribute("role");

  return `${tag}${id}${className}${role ? `[role=${role}]` : ""}`;
};

const eventPayload = (event: Event) => {
  if (event instanceof InputEvent) {
    return {
      inputType: event.inputType,
      data: event.data,
      isComposing: event.isComposing,
    };
  }

  if (event instanceof KeyboardEvent) {
    return {
      key: event.key,
      isComposing: event.isComposing,
    };
  }

  if (event instanceof CompositionEvent) {
    return {
      data: event.data,
    };
  }

  return {};
};

const TiptapImeTestApp = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [plainValue, setPlainValue] = useState("");
  const [copied, setCopied] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
        allowBase64: false,
        inline: false,
      }),
      Placeholder.configure({
        placeholder: "Test your input method here...",
      }),
    ],
    content: {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
    editorProps: {
      attributes: {
        class: "tiptap-ime-editor",
        autocapitalize: "sentences",
        autocomplete: "on",
        autocorrect: "on",
        inputmode: "text",
        spellcheck: "true",
      },
    },
  });

  const pushLog = useCallback(
    (eventName: string, event?: Event) => {
      const textLength = editor?.getText().length ?? 0;
      const entry: LogEntry = {
        id: nextLogId++,
        event: eventName,
        activeElement: activeElementLabel(),
        textLength,
        time: nowTime(),
        ...(event ? eventPayload(event) : {}),
      };

      setLogs((current) => [entry, ...current].slice(0, 80));
    },
    [editor]
  );

  useEffect(() => {
    if (!editor) {
      return;
    }

    const handleUpdate = () => pushLog("tiptap-update");
    const handleFocus = () => pushLog("tiptap-focus");
    const handleBlur = () => pushLog("tiptap-blur");

    editor.on("update", handleUpdate);
    editor.on("focus", handleFocus);
    editor.on("blur", handleBlur);
    pushLog("tiptap-ready");

    return () => {
      editor.off("update", handleUpdate);
      editor.off("focus", handleFocus);
      editor.off("blur", handleBlur);
    };
  }, [editor, pushLog]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const dom = editor.view.dom;
    const events = [
      "click",
      "focus",
      "blur",
      "keydown",
      "keyup",
      "beforeinput",
      "input",
      "compositionstart",
      "compositionupdate",
      "compositionend",
    ] as const;

    const handlers = new Map<string, EventListener>();
    for (const eventName of events) {
      const handler: EventListener = (event) => pushLog(eventName, event);
      handlers.set(eventName, handler);
      dom.addEventListener(eventName, handler);
    }

    return () => {
      for (const [eventName, handler] of handlers) {
        dom.removeEventListener(eventName, handler);
      }
    };
  }, [editor, pushLog]);

  const diagnostics = useMemo(() => {
    const dom = editor?.view.dom;

    return {
      userAgent: navigator.userAgent,
      activeElement: activeElementLabel(),
      tiptapFocused: editor?.isFocused ?? false,
      tiptapTextLength: editor?.getText().length ?? 0,
      tiptapHTMLLength: editor?.getHTML().length ?? 0,
      tiptapRole: dom?.getAttribute("role") ?? null,
      tiptapContentEditable: dom?.getAttribute("contenteditable") ?? null,
      textareaLength: plainValue.length,
    };
  }, [editor, logs, plainValue.length]);

  const copyDiagnostics = async () => {
    const body = [
      `url=${location.href}`,
      `userAgent=${diagnostics.userAgent}`,
      `activeElement=${diagnostics.activeElement}`,
      `tiptapFocused=${diagnostics.tiptapFocused}`,
      `tiptapTextLength=${diagnostics.tiptapTextLength}`,
      `tiptapHTMLLength=${diagnostics.tiptapHTMLLength}`,
      `tiptapRole=${diagnostics.tiptapRole}`,
      `tiptapContentEditable=${diagnostics.tiptapContentEditable}`,
      `textareaLength=${diagnostics.textareaLength}`,
      "",
      ...logs.map((entry) =>
        [
          entry.time,
          entry.event,
          `active=${entry.activeElement}`,
          `len=${entry.textLength}`,
          entry.inputType ? `type=${entry.inputType}` : "",
          entry.data ? `data=${JSON.stringify(entry.data)}` : "",
          entry.key ? `key=${entry.key}` : "",
          entry.isComposing !== undefined ? `composing=${entry.isComposing}` : "",
        ]
          .filter(Boolean)
          .join(" ")
      ),
    ].join("\n");

    await navigator.clipboard.writeText(body);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <main className="tiptap-ime-page">
      <header className="tiptap-ime-header">
        <div>
          <h1>Tiptap IME test</h1>
          <p>The main editor uses Tiptap / ProseMirror / contenteditable.</p>
        </div>
        <button type="button" onClick={() => void copyDiagnostics()}>
          {copied ? "Copied" : "Copy log"}
        </button>
      </header>

      <section className="tiptap-ime-panel">
        <div className="tiptap-ime-panel-title">
          <span>Tiptap editor</span>
          <button type="button" onClick={() => editor?.commands.focus("end")}>
            Focus
          </button>
        </div>
        <div className="tiptap-ime-editor-wrap">
          <EditorContent editor={editor} />
        </div>
        <div className="tiptap-ime-actions">
          <button type="button" onClick={() => editor?.chain().focus().clearContent().run()}>
            Clear
          </button>
          <button type="button" onClick={() => editor?.chain().focus().insertContent("Test text").run()}>
            Insert test text
          </button>
          <button type="button" onClick={() => editor?.chain().focus().setImage({ src: "https://appkeep.io", alt: "Test image" }).run()}>
            Insert image
          </button>
        </div>
      </section>

      <section className="tiptap-ime-panel">
        <div className="tiptap-ime-panel-title">
          <span>Native textarea comparison</span>
        </div>
        <textarea
          value={plainValue}
          autoCapitalize="sentences"
          autoComplete="on"
          autoCorrect="on"
          enterKeyHint="enter"
          inputMode="text"
          spellCheck
          placeholder="This is a native textarea, for comparing input method behaviour..."
          onChange={(event) => {
            setPlainValue(event.target.value);
            pushLog("textarea-change");
          }}
        />
      </section>

      <section className="tiptap-ime-panel tiptap-ime-diagnostics">
        <div className="tiptap-ime-panel-title">
          <span>Diagnostics</span>
        </div>
        <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
      </section>

      <section className="tiptap-ime-panel tiptap-ime-log">
        <div className="tiptap-ime-panel-title">
          <span>Event log</span>
        </div>
        <div className="tiptap-ime-log-list">
          {logs.map((entry) => (
            <div key={entry.id}>
              {entry.time} {entry.event} active={entry.activeElement} len={entry.textLength}
              {entry.inputType ? ` type=${entry.inputType}` : ""}
              {entry.data ? ` data=${JSON.stringify(entry.data)}` : ""}
              {entry.key ? ` key=${entry.key}` : ""}
              {entry.isComposing !== undefined ? ` composing=${entry.isComposing}` : ""}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
};

const root = document.getElementById("tiptap-ime-test-root");

if (!root) {
  throw new Error("Tiptap IME test root not found");
}

createRoot(root).render(
  <React.StrictMode>
    <TiptapImeTestApp />
  </React.StrictMode>
);
