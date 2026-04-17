"use client";

import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type GlassCardProps = HTMLAttributes<HTMLDivElement> & {
  /** Adds a soft purple halo glow on hover. */
  interactive?: boolean;
  /** Uses a heavier blur/inset shadow - good for hero panels. */
  elevated?: boolean;
};

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, interactive, elevated, children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "glass relative rounded-3xl p-6 transition",
          elevated ? "shadow-glass" : "shadow-soft",
          interactive &&
            "cursor-pointer hover:-translate-y-0.5 hover:shadow-halo hover:border-electron/40",
          className,
        )}
        {...rest}
      >
        <span className="noise-layer rounded-[inherit]" aria-hidden />
        {children}
      </div>
    );
  },
);

GlassCard.displayName = "GlassCard";
