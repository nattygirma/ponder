import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type KeyboardEventHandler } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type MemoTitleInputProps = {
  ariaLabel?: string;
  className?: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  readOnly?: boolean;
  value: string;
  /** Long titles wrap instead of truncating, and Enter is left to the caller. */
  multiline?: boolean;
} & Omit<ComponentPropsWithoutRef<"input">, "onChange" | "value">;

export const MemoTitleInput = forwardRef<HTMLInputElement, MemoTitleInputProps>(({
  ariaLabel,
  className,
  onValueChange,
  placeholder,
  readOnly = false,
  value,
  multiline = false,
  ...props
}, ref) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Callers only focus and select, which both elements support.
  useImperativeHandle(ref, () => (multiline ? textareaRef.current : inputRef.current) as HTMLInputElement);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const fit = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    fit();
    // The title's size changes with the screen (a phone title is smaller), so refit when it is resized or rotated.
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      fit();
    });
    observer.observe(textarea);
    let disposed = false;
    document.fonts?.ready.then(() => {
      if (!disposed) fit();
    });
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [multiline, value]);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    let disposed = false;
    const measure = () => {
      if (!disposed) setTruncated(input.scrollWidth > input.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(input);
    document.fonts.ready.then(measure);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [value, className]);

  if (multiline) {
    return (
      <textarea
        ref={textareaRef}
        aria-label={ariaLabel ?? placeholder}
        className={cn("block w-full min-w-0 resize-none overflow-hidden whitespace-pre-wrap break-words rounded-md border-0 bg-transparent outline-none", className)}
        maxLength={160}
        onChange={(event) => onValueChange(event.target.value.replace(/[\r\n]+/g, " "))}
        onKeyDown={props.onKeyDown as unknown as KeyboardEventHandler<HTMLTextAreaElement>}
        placeholder={placeholder}
        readOnly={readOnly}
        rows={1}
        value={value}
      />
    );
  }

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <input
            {...props}
            ref={inputRef}
            aria-label={ariaLabel ?? placeholder}
            className={cn(
              "block w-full min-w-0 truncate rounded-md border-0 bg-transparent px-2 py-1 text-sm font-semibold leading-tight text-slate-900 outline-none transition placeholder:text-slate-300 hover:bg-slate-100/60 focus-visible:bg-muted focus-visible:shadow-[inset_3px_0_0_rgb(var(--slate-950-rgb))] read-only:text-slate-600 read-only:hover:bg-transparent read-only:focus-visible:bg-transparent read-only:focus-visible:shadow-none sm:text-base",
              className
            )}
            maxLength={160}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={placeholder}
            readOnly={readOnly}
            value={value}
          />
        </TooltipTrigger>
        {truncated && value && (
          <TooltipContent side="bottom" className="max-w-[min(32rem,calc(100vw-2rem))] break-words">
            {value}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
});

MemoTitleInput.displayName = "MemoTitleInput";
