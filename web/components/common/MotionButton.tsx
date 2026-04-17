"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef } from "react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";

type MotionButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  children?: React.ReactNode;
};

const variantClass: Record<Variant, string> = {
  primary:
    "bg-[linear-gradient(135deg,hsl(var(--electron))_0%,hsl(var(--electron-glow))_100%)] text-white shadow-halo hover:brightness-[1.05]",
  secondary:
    "bg-card text-foreground border border-border hover:border-electron/50 hover:bg-muted",
  ghost: "bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60",
};

const sizeClass = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-14 px-7 text-base",
};

export const MotionButton = forwardRef<HTMLButtonElement, MotionButtonProps>(
  (
    { className, variant = "primary", size = "md", iconLeft, iconRight, children, ...rest },
    ref,
  ) => {
    return (
      <motion.button
        ref={ref}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 28 }}
        className={cn(
          "focus-ring inline-flex items-center justify-center gap-2 rounded-2xl font-semibold tracking-tight transition",
          variantClass[variant],
          sizeClass[size],
          className,
        )}
        {...rest}
      >
        {iconLeft}
        <span className="min-w-0 truncate">{children}</span>
        {iconRight}
      </motion.button>
    );
  },
);

MotionButton.displayName = "MotionButton";
