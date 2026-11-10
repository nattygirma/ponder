import { useEffect, useRef } from "react";

/** The "Search actions" box at the top of a menu; hides the rows that don't match. */
export const MenuSearch = ({ placeholder }: { placeholder: string }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const rows = () => Array.from(
    inputRef.current?.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]') ?? [],
  );
  const filter = (value: string) => {
    const needle = value.trim().toLowerCase();
    for (const row of rows()) {
      row.style.display = needle && !row.textContent?.toLowerCase().includes(needle) ? "none" : "";
    }
    inputRef.current?.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role="separator"], [data-menu-note]').forEach((element) => {
      element.style.display = needle ? "none" : "";
    });
  };
  return (
    <div className="p-1">
      <input
        ref={inputRef}
        aria-label={placeholder}
        placeholder={placeholder}
        className="h-7 w-full rounded border border-slate-200 bg-slate-50 px-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-400"
        onChange={(event) => filter(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") return;
          event.stopPropagation();
          if (event.key === "ArrowDown") {
            event.preventDefault();
            rows().find((row) => row.style.display !== "none")?.focus();
          }
        }}
      />
    </div>
  );
};
