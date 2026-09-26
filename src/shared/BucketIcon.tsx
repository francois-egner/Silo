import type { SVGProps } from "react";

/** Open bucket with side bail — traced from the Silo bucket glyph. */
export function BucketIcon({
  size = 24,
  className,
  strokeWidth = 2,
  ...props
}: SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number | string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      <ellipse cx="12" cy="5.2" rx="8.2" ry="3" />
      <path d="M3.8 5.2 6.2 19.5Q12 22.2 17.8 19.5L20.2 5.2" />
      <circle cx="10.8" cy="10" r="1" fill="currentColor" stroke="none" />
      <path d="M10.8 10C14 14.5 18.5 16 21.5 13.5" />
    </svg>
  );
}
