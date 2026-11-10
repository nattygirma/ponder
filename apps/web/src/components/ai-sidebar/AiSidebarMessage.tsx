import { lazy, memo, Suspense } from "react";
import { cn } from "@/lib/utils";

// Streamdown and its plugins bring Mermaid, Shiki and KaTeX with them (several hundred KB). They load
// with the first AI message instead of with the workspace; until then the message shows as plain text.
const AiSidebarMessageContent = lazy(() =>
  import("./AiSidebarMessageContent").then((module) => ({ default: module.AiSidebarMessageContent })),
);

type AiSidebarMessageProps = { children: string; className?: string; isAnimating?: boolean };

export const AiSidebarMessage = memo(
  (props: AiSidebarMessageProps) => (
    <Suspense
      fallback={
        <div className={cn("ai-sidebar-message size-full whitespace-pre-wrap [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", props.className)}>
          {props.children}
        </div>
      }
    >
      <AiSidebarMessageContent {...props} />
    </Suspense>
  ),
  (prev, next) => prev.children === next.children && prev.isAnimating === next.isAnimating && prev.className === next.className,
);

AiSidebarMessage.displayName = "AiSidebarMessage";
