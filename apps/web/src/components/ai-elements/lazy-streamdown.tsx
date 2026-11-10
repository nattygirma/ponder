import { type ComponentProps, lazy, Suspense } from "react";
import type { Streamdown as StreamdownComponent } from "streamdown";
import { cn } from "@/lib/utils";

export type StreamdownProps = ComponentProps<typeof StreamdownComponent>;

const LoadedStreamdown = lazy(() => import("streamdown").then((module) => ({ default: module.Streamdown })));
// Streamdown with the CJK plugin, for chat replies.
const LoadedStreamdownCjk = lazy(() =>
  Promise.all([import("streamdown"), import("@streamdown/cjk")]).then(([{ Streamdown }, { cjk }]) => {
    const plugins = { cjk };
    return { default: (props: StreamdownProps) => <Streamdown plugins={plugins} {...props} /> };
  }),
);

const PlainText = ({ className, children }: StreamdownProps) => (
  <div className={cn("whitespace-pre-wrap", className)}>{typeof children === "string" ? children : null}</div>
);

/**
 * Streamdown, loaded with the first message it renders rather than with the workspace: it imports Mermaid
 * and its parsers up front. Until it's loaded the text shows as it is.
 */
export function Streamdown({ cjk, ...props }: StreamdownProps & { cjk?: boolean }) {
  const Loaded = cjk ? LoadedStreamdownCjk : LoadedStreamdown;
  return (
    <Suspense fallback={<PlainText {...props} />}>
      <Loaded {...props} />
    </Suspense>
  );
}
