import { forwardRef, type SVGProps } from "react";

type AiFaceIconProps = SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string };

/**
 * Ponder AI's face: a friendly line-drawn person with a sparkle, used wherever Ponder means its
 * assistant. Drawn on Lucide's 24px grid and takes the same props, so it can stand in for any
 * Lucide icon (className sizes it, color comes from currentColor).
 */
export const AiFaceIcon = forwardRef<SVGSVGElement, AiFaceIconProps>(
  ({ size = 24, strokeWidth = 2, className, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={["lucide", "ponder-ai-face", className].filter(Boolean).join(" ")}
      data-ai-face=""
      {...props}
    >
      <path d="M11 5.5c4.1 0 7.5 3.3 7.5 7.5S15.1 20.5 11 20.5 3.5 17.2 3.5 13 6.9 5.5 11 5.5Z" />
      <path d="M4 11c2.6.2 5.4-.9 7-3 1 1.2 2.6 2 4.4 2" />
      <circle cx="8.4" cy="13.6" r="1" fill="currentColor" stroke="none" />
      <circle cx="13.6" cy="13.6" r="1" fill="currentColor" stroke="none" />
      <path d="M9.2 16.7c1.1.8 2.6.8 3.6 0" />
      <path d="M19.6 2c.3 1.32 1.08 1.68 2.4 2.4-1.32.3-1.68 1.08-2.4 2.4-.3-1.32-1.08-1.68-2.4-2.4 1.32-.3 1.68-1.08 2.4-2.4Z" fill="currentColor" stroke="none" />
    </svg>
  ),
);
AiFaceIcon.displayName = "AiFaceIcon";
