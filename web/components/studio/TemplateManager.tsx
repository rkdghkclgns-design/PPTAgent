"use client";

import { Bookmark, BookmarkCheck, Check, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  deleteTemplate,
  getDefaultTemplateId,
  listTemplates,
  saveTemplate,
  setDefaultTemplate,
  type DeckTemplate,
} from "@/lib/templates";
import { cn } from "@/lib/utils";
import { useStudioStore } from "@/lib/store";

/**
 * Sidebar widget above MODEL ROUTING. Lets the user:
 *  - Save the current Studio settings (slide count, language, deck type,
 *    include-images toggle, model overrides) as a named template.
 *  - Load a saved template into the Studio in one click.
 *  - Pin one template as the default that auto-applies on page load.
 *  - Delete templates they no longer want.
 *
 * Stored in localStorage via `lib/templates.ts`.
 */
export function TemplateManager() {
  const slideCount = useStudioStore((s) => s.slideCount);
  const includeImages = useStudioStore((s) => s.includeImages);
  const language = useStudioStore((s) => s.language);
  const deckType = useStudioStore((s) => s.deckType);
  const overrides = useStudioStore((s) => s.overrides);
  const applyTemplate = useStudioStore((s) => s.applyTemplate);

  const [templates, setTemplates] = useState<DeckTemplate[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [showNameInput, setShowNameInput] = useState(false);
  const [name, setName] = useState("");
  const [autoApplied, setAutoApplied] = useState(false);

  const refresh = () => {
    setTemplates(listTemplates());
    setDefaultId(getDefaultTemplateId());
  };

  // Initial load + auto-apply default template once per session.
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    if (autoApplied) return;
    const defId = getDefaultTemplateId();
    if (!defId) return;
    const tpl = listTemplates().find((t) => t.id === defId);
    if (tpl) applyTemplate(tpl);
    setAutoApplied(true);
  }, [applyTemplate, autoApplied]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveTemplate({
      name: trimmed,
      slideCount,
      includeImages,
      language,
      deckType,
      overrides,
    });
    setName("");
    setShowNameInput(false);
    refresh();
  };

  const handleApply = (tpl: DeckTemplate) => {
    applyTemplate(tpl);
  };

  const handleDelete = (id: string) => {
    if (!window.confirm("이 양식을 삭제하시겠습니까?")) return;
    deleteTemplate(id);
    refresh();
  };

  const handleToggleDefault = (id: string) => {
    const next = defaultId === id ? null : id;
    setDefaultTemplate(next);
    setDefaultId(next);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          저장된 양식
        </p>
        <button
          onClick={() => setShowNameInput((v) => !v)}
          className="text-[11px] font-medium text-electron hover:text-electron/80"
        >
          {showNameInput ? "취소" : "+ 현재 설정 저장"}
        </button>
      </div>

      {showNameInput && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              else if (e.key === "Escape") setShowNameInput(false);
            }}
            placeholder="예: 강의용 기본 양식"
            className="focus-ring flex-1 rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1.5 text-xs"
          />
          <button
            onClick={handleSave}
            className="rounded-lg bg-electron px-2.5 py-1.5 text-xs font-medium text-background transition hover:bg-electron/90 disabled:opacity-50"
            disabled={!name.trim()}
          >
            저장
          </button>
        </div>
      )}

      {templates.length === 0 && !showNameInput && (
        <p className="text-xs text-muted-foreground">
          자주 쓰는 설정을 저장해 두면 다음에도 한 번에 불러올 수 있습니다.
        </p>
      )}

      {templates.length > 0 && (
        <ul className="space-y-1.5">
          {templates.map((tpl) => (
            <li
              key={tpl.id}
              className="group flex items-center gap-2 rounded-xl border border-border/70 bg-muted/30 px-2.5 py-2 transition hover:border-electron/40"
            >
              <button
                onClick={() => handleApply(tpl)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title="이 양식으로 현재 설정 덮어쓰기"
              >
                <Check className="h-3.5 w-3.5 shrink-0 text-aurora opacity-60 group-hover:opacity-100" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{tpl.name}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {tpl.slideCount}장 · {tpl.language === "ko" ? "한국어" : "English"} · {tpl.deckType}
                  </p>
                </div>
              </button>
              <button
                onClick={() => handleToggleDefault(tpl.id)}
                className={cn(
                  "shrink-0 rounded-md p-1 transition",
                  defaultId === tpl.id ? "text-electron" : "text-muted-foreground hover:text-foreground",
                )}
                title={defaultId === tpl.id ? "기본 양식 해제" : "기본 양식으로 지정 (다음 접속 시 자동 적용)"}
              >
                {defaultId === tpl.id ? (
                  <BookmarkCheck className="h-4 w-4" />
                ) : (
                  <Bookmark className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={() => handleDelete(tpl.id)}
                className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:text-destructive"
                title="삭제"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
