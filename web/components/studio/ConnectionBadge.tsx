"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Cloud, CloudOff, Loader2 } from "lucide-react";

import { isApiReachable } from "@/lib/api";
import { cn } from "@/lib/utils";

type Status = "checking" | "live" | "demo";

const LABEL: Record<Status, string> = {
  checking: "연결 확인 중",
  live: "API 연결됨",
  demo: "데모 모드",
};

const HINT: Record<Status, string> = {
  checking: "헬스체크 중입니다.",
  live: "FastAPI · Supabase · Google 모델이 모두 연결된 상태입니다.",
  demo: "FastAPI 가 아직 배포되지 않아 샘플 데이터로 미리 보기 중입니다. " +
    "NEXT_PUBLIC_API_ORIGIN 시크릿 등록 + 백엔드 배포 후 자동 전환됩니다.",
};

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

  const Icon = status === "checking" ? Loader2 : status === "live" ? Cloud : CloudOff;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group relative hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium md:inline-flex",
        status === "live"
          ? "border-aurora/50 bg-aurora/10 text-aurora"
          : status === "demo"
            ? "border-sunrise/40 bg-sunrise/10 text-sunrise"
            : "border-border/60 bg-muted/50 text-muted-foreground",
      )}
      title={HINT[status]}
    >
      <Icon className={cn("h-3.5 w-3.5", status === "checking" && "animate-spin")} />
      {LABEL[status]}
      <span className="absolute right-0 top-[calc(100%+6px)] hidden w-64 rounded-xl border border-border/60 bg-card/90 p-3 text-[11px] leading-relaxed text-muted-foreground shadow-glass backdrop-blur-xl group-hover:block">
        {HINT[status]}
      </span>
    </motion.div>
  );
}
