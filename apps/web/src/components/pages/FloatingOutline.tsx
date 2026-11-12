/**
 * Notion's floating table of contents: short lines at the right edge of a long page, one per
 * heading, that open into the list of headings on hover or focus.
 *
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0:
 * src/components/editor/components/blocks/outline/DockableOutline.tsx and dockable-outline.scss.
 * The hover and focus handling, Escape, placement and list scrolling are AppFlowy's; the track
 * and marker became Notion's lines, the display-mode menu is gone (Notion has none), and the
 * page option `toc` turns it off.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/core";
import { flattenHeadings, nestHeadings } from "@ponder/shared";
import { jumpToHeading, useActiveHeading, usePageHeadings } from "./outlineNavigation";

const ROW_HEIGHT = 28;
const LINE_GAP = 8;
const PANEL_CHROME_HEIGHT = 24;
/** Notion shows it once a page has a few headings. */
const MIN_HEADINGS = 3;

export const FloatingOutline = ({ editor, scrollContainer, hidden = false }: { editor: Editor | null; scrollContainer: HTMLElement | null; hidden?: boolean }) => {
  const { headings } = usePageHeadings(editor, 3);
  if (!editor || hidden || headings.length < MIN_HEADINGS) return null;
  return <FloatingOutlinePanel editor={editor} viewport={scrollContainer} />;
};

const FloatingOutlinePanel = ({ editor, viewport }: { editor: Editor; viewport: HTMLElement | null }) => {
  const { t } = useTranslation();
  const panelId = useId();
  const { headings } = usePageHeadings(editor, 3);
  const items = useMemo(() => flattenHeadings(nestHeadings(headings)), [headings]);
  const activeId = useActiveHeading(editor, headings, true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [bounds, setBounds] = useState<{ top: number; right: number; maxHeight: number }>();
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const skipTriggerFocus = useRef(false);
  const keyboardInput = useRef(true);
  const expanded = hovered || focused;
  const title = t("pages.blocks.tocLabel");
  const panelHeight = Math.min(items.length * ROW_HEIGHT + PANEL_CHROME_HEIGHT, bounds?.maxHeight ?? 0);

  const cancelClose = useCallback(() => clearTimeout(closeTimer.current), []);
  const open = useCallback(() => {
    cancelClose();
    setHovered(true);
  }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHovered(false), 300);
  }, [cancelClose]);

  useEffect(() => {
    const onPointerDown = () => {
      keyboardInput.current = false;
      setFocused(false);
    };
    const onKeyDown = () => {
      keyboardInput.current = true;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelClose();
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [cancelClose]);

  // Sits at the right edge of the page area, starting level with the page's content.
  useEffect(() => {
    const root = editor.view.dom as HTMLElement;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = viewport?.getBoundingClientRect();
      const bottom = Math.min(window.innerHeight, rect?.bottom ?? window.innerHeight);
      const viewportTop = Math.max(0, rect?.top ?? 0);
      const top = Math.max(viewportTop + 96, Math.min(viewportTop + 200, root.getBoundingClientRect().top));
      const next = {
        top,
        right: Math.max(0, window.innerWidth - (rect?.right ?? window.innerWidth)),
        maxHeight: Math.max(ROW_HEIGHT, bottom - top - 48),
      };
      setBounds((previous) => (previous?.top === next.top && previous.right === next.right && previous.maxHeight === next.maxHeight ? previous : next));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    if (viewport) observer.observe(viewport);
    observer.observe(root);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    update();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [editor, viewport]);

  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!expanded || !list || !row) return;
    // Scroll only the outline's list; scrollIntoView would move the page too.
    const top = row.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight) list.scrollTop = top + ROW_HEIGHT - list.clientHeight;
  }, [activeId, expanded, panelHeight]);

  if (!bounds) return null;
  const linesHeight = Math.min(items.length * LINE_GAP, bounds.maxHeight);

  return createPortal(
    <div
      className="ponder-floating-toc"
      data-floating-toc=""
      data-expanded={expanded}
      style={{ top: bounds.top, right: bounds.right + 12, height: Math.max(linesHeight, expanded ? panelHeight : 0) } as CSSProperties}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
      onFocusCapture={() => setFocused(keyboardInput.current)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
          scheduleClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") {
          setFocused(true);
          return;
        }
        event.stopPropagation();
        cancelClose();
        setHovered(false);
        setFocused(false);
        if (document.activeElement !== triggerRef.current) {
          skipTriggerFocus.current = true;
          triggerRef.current?.focus({ preventScroll: true });
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="ponder-floating-toc-trigger"
        aria-label={t("pages.blocks.floatingTocShow")}
        aria-expanded={expanded}
        aria-controls={panelId}
        tabIndex={expanded ? -1 : 0}
        style={{ height: linesHeight }}
        onClick={open}
        onFocus={() => {
          if (skipTriggerFocus.current) {
            skipTriggerFocus.current = false;
            setFocused(false);
          } else open();
        }}
      >
        {items.map(({ heading }) => (
          <span
            key={heading.id}
            className="ponder-floating-toc-line"
            data-level={heading.level}
            data-active={heading.id === activeId ? "" : undefined}
          />
        ))}
      </button>
      <nav id={panelId} aria-label={title} aria-hidden={!expanded} className="ponder-floating-toc-panel" style={{ maxHeight: bounds.maxHeight }}>
        <div ref={listRef} className="ponder-floating-toc-list">
          {items.map(({ heading, indent }) => (
            <button
              key={heading.id}
              type="button"
              aria-current={heading.id === activeId ? "location" : undefined}
              className="ponder-floating-toc-item"
              style={{ paddingLeft: 10 + indent * 14 }}
              tabIndex={expanded ? 0 : -1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => jumpToHeading(editor, heading)}
            >
              <span className="truncate">{heading.text || t("pages.blocks.untitled")}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>,
    document.body,
  );
};
