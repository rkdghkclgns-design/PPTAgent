"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

import { isApiReachable } from "@/lib/api";
import { cn } from "@/lib/utils";

type Status = "checking" | "live" | "demo";

/**
 * Minimal status pill. In the live state we show a calm green dot only,
 * without the previous tooltip + warning copy - there's nothing for the user
 * to do when everything works. In the demo state we collapse the badge to a
 * small amber chip with a screen-reader-only explanation and no hover popup.
 */
export function ConnectionBadge() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let alive = true;
    isApiReachable().then((ok) => {
      if (alive) setStatus(ok ? "live" : "demo");
    });
    return () => {
      alive = false;
    };
  }, []);

  if (status === "checking") {
    return (
      <span className="hidden h-2 w-2 rounded-full bg-muted-foreground/40 md:inline-block"
            aria-label="Checking connection" />
    );
  }

  if (status === "live") {
    return (
      <motion.span
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className={cn(
          "hidden items-center gap-1.5 rounded-full border border-aurora/30 bg-aurora/10 px-2 py-1 text-[11px] font-medium text-aurora md:inline-flex",
        )}
        aria-label="Connected"
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-aurora/60 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-aurora" />
        </span>
        Live
      </motion.span>
    );
  }

  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="hidden items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground md:inline-flex"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
      Preview
      <span className="sr-only">Supabase is not configured; showing sample data.</span>
    </motion.span>
  );
}
