/**
 * Drag handles that resize an embed frame, as Notion's do: pills on the left and right edges set
 * the width, a pill on the bottom edge sets the height, and the bottom corners set both.
 *
 * Adapted from AppFlowy-Web (https://github.com/AppFlowy-IO/AppFlowy-Web), Copyright AppFlowy, AGPL-3.0:
 * src/components/editor/components/blocks/google-drive/DriveResizeHandles.tsx (the pointer-capture
 * gesture, the draft size while dragging, cancelling on lost capture and the arrow-key steps) and
 * drive-data.ts (driveSize). AppFlowy's top handle became Notion's two bottom corners, its width
 * and height factors became a width percentage and a pixel height, and Slate's block data became
 * the TipTap node's attributes.
 */
import { useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { clampEmbedSize, MAX_EMBED_HEIGHT, MIN_EMBED_HEIGHT, MIN_EMBED_WIDTH } from "@ponder/shared";
import { cn } from "@/lib/utils";

export type EmbedSize = { width: number; height: number };

type Side = "left" | "right" | "bottom" | "bottom-left" | "bottom-right";

const LABELS: Record<Side, string> = {
  left: "pages.embeds.resizeLeft",
  right: "pages.embeds.resizeRight",
  bottom: "pages.embeds.resizeBottom",
  "bottom-left": "pages.embeds.resizeCorner",
  "bottom-right": "pages.embeds.resizeCorner",
};

/** A player keeps its shape, so only its width changes. */
const sidesFor = (heightLocked: boolean): Side[] => (heightLocked ? ["left", "right"] : ["left", "right", "bottom", "bottom-left", "bottom-right"]);

const clampWidth = (value: number, containerWidth: number) =>
  Math.min(100, Math.max(Math.max(MIN_EMBED_WIDTH, Math.min(100, (120 / containerWidth) * 100)), value));
const clampHeight = (value: number) => Math.min(MAX_EMBED_HEIGHT, Math.max(MIN_EMBED_HEIGHT, value));

export function EmbedResizeHandles({
  container,
  size,
  heightLocked,
  onDraft,
  onCommit,
}: {
  /** The column the frame sits in, whose width 100% is. */
  container: RefObject<HTMLElement | null>;
  size: EmbedSize;
  heightLocked: boolean;
  onDraft: (value?: EmbedSize) => void;
  onCommit: (value: EmbedSize) => void;
}) {
  const { t } = useTranslation();
  const cleanup = useRef<() => void>(undefined);

  // A remote resize must cancel a gesture started from the old size, as unmounting does.
  useEffect(() => () => cleanup.current?.(), [size.width, size.height]);

  return (
    <>
      {sidesFor(heightLocked).map((side) => {
        const horizontal = side === "left" || side === "right" || side.startsWith("bottom-");
        const vertical = side.startsWith("bottom");
        return (
          <button
            key={side}
            type="button"
            className={cn("ponder-embed-resize", `ponder-embed-resize-${side}`)}
            aria-label={t(LABELS[side])}
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              cleanup.current?.();
              const width = container.current?.clientWidth;
              if (!width) return;
              const initial = size;
              const { clientX, clientY, pointerId } = event;
              const handle = event.currentTarget;
              let next = initial;
              // Cross-origin frames swallow moves despite pointer capture, so mark the gesture
              // before the first move and let the frame ignore the pointer meanwhile.
              onDraft(initial);
              handle.setPointerCapture(pointerId);
              const move = (moveEvent: PointerEvent) => {
                // The frame is centred, so a side moves half as far as the width changes.
                const dx = ((moveEvent.clientX - clientX) / width) * 100 * 2;
                const dy = moveEvent.clientY - clientY;
                const towardLeft = side === "left" || side === "bottom-left" ? -1 : 1;
                next = {
                  width: horizontal ? clampWidth(initial.width + dx * towardLeft, width) : initial.width,
                  height: vertical ? clampHeight(initial.height + dy) : initial.height,
                };
                onDraft(next);
              };
              const dispose = () => {
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", commit);
                handle.removeEventListener("pointercancel", cancel);
                handle.removeEventListener("lostpointercapture", cancel);
                if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
                cleanup.current = undefined;
              };
              const commit = () => {
                dispose();
                onDraft(undefined);
                onCommit(clampEmbedSize(next.width, next.height));
              };
              const cancel = () => {
                dispose();
                onDraft(undefined);
              };
              cleanup.current = cancel;
              handle.addEventListener("pointermove", move);
              handle.addEventListener("pointerup", commit);
              handle.addEventListener("pointercancel", cancel);
              handle.addEventListener("lostpointercapture", cancel);
            }}
            onKeyDown={(event) => {
              const keys = [...(horizontal ? ["ArrowLeft", "ArrowRight"] : []), ...(vertical ? ["ArrowUp", "ArrowDown"] : [])];
              if (!keys.includes(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              const containerWidth = container.current?.clientWidth || 120;
              const grow = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
              const towardLeft = side === "left" || side === "bottom-left" ? -1 : 1;
              const sideways = event.key === "ArrowLeft" || event.key === "ArrowRight";
              onCommit(clampEmbedSize(
                sideways ? clampWidth(size.width + grow * towardLeft * 5, containerWidth) : size.width,
                sideways ? size.height : clampHeight(size.height + grow * 20),
              ));
            }}
          />
        );
      })}
    </>
  );
}
