"use client";

import { motion } from "framer-motion";

/**
 * Ambient background: soft aurora mesh + slow-breathing particles + faint
 * grid. Rendered once at the root of full-screen pages. All animations use
 * transform/opacity only so the main thread stays clear.
 */
export function NoiseBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 grid-backdrop opacity-40" />
      <motion.div
        className="absolute -top-40 left-1/2 h-[720px] w-[1200px] -translate-x-1/2 rounded-full bg-electron/25 blur-3xl"
        animate={{ opacity: [0.55, 0.8, 0.55], scale: [1, 1.04, 1] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-[-220px] right-[-80px] h-[520px] w-[520px] rounded-full bg-aurora/20 blur-3xl"
        animate={{ opacity: [0.45, 0.7, 0.45], x: [0, 20, 0] }}
        transition={{ duration: 11, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
      />
      <motion.div
        className="absolute top-1/3 left-[-140px] h-[360px] w-[360px] rounded-full bg-sunrise/18 blur-3xl"
        animate={{ opacity: [0.3, 0.55, 0.3], y: [0, -16, 0] }}
        transition={{ duration: 13, repeat: Infinity, ease: "easeInOut", delay: 1.6 }}
      />
      <div className="noise-layer" />
    </div>
  );
}
