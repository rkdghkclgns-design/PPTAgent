"use client";

/**
 * Template persistence layer (localStorage-backed).
 *
 * A "template" captures every non-runtime knob the user can tune in the
 * Studio prompt panel — slide count, language, deck type, model overrides,
 * image inclusion. It does NOT include the prompt text or attachments, which
 * are per-generation content.
 *
 * We keep the schema conservative (small JSON object) so old exports can
 * still be loaded after we add fields — unknown fields are ignored, missing
 * fields fall back to current defaults.
 */

import type { DeckType, ModelOverrides } from "./api";

export interface DeckTemplate {
  /** Stable id so rename/update keeps the same slot in the list. */
  id: string;
  name: string;
  /** ISO8601 timestamp of last save. */
  savedAt: string;
  slideCount: number;
  includeImages: boolean;
  language: "ko" | "en";
  deckType: DeckType;
  overrides: ModelOverrides;
}

const STORAGE_KEY = "pptagent.templates.v1";
const DEFAULT_KEY = "pptagent.templates.default.v1";

function canUseStorage(): boolean {
  try {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

function safeRead<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("template persistence failed", err);
  }
}

function safeRemove(key: string): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function makeId(): string {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Map deprecated model IDs → current model IDs. Saved templates predate the
 * 3.1 image preview pin, so when we read them back we transparently rewrite
 * their `overrides` so the dropdown shows the right label and the request
 * payload uses the right model. Add new entries here whenever a model is
 * retired or replaced.
 */
const MODEL_ID_REWRITES: Record<string, string> = {
  "google/gemini-2.5-flash-image": "google/gemini-3.1-flash-image-preview",
};

function migrateOverrides(overrides: ModelOverrides | undefined): ModelOverrides {
  if (!overrides) return {};
  const out: ModelOverrides = {};
  (Object.entries(overrides) as Array<[keyof ModelOverrides, string | undefined]>).forEach(
    ([slot, value]) => {
      if (!value) return;
      out[slot] = MODEL_ID_REWRITES[value] ?? value;
    },
  );
  return out;
}

function migrateTemplate(t: DeckTemplate): DeckTemplate {
  const migrated = migrateOverrides(t.overrides);
  // Preserve immutability — only return a new object when something actually
  // changed, so React/Zustand referential equality still works on the no-op
  // path.
  const same =
    Object.keys(migrated).length === Object.keys(t.overrides ?? {}).length &&
    Object.entries(migrated).every(([k, v]) => (t.overrides as Record<string, string>)[k] === v);
  return same ? t : { ...t, overrides: migrated };
}

export function listTemplates(): DeckTemplate[] {
  const raw = safeRead<DeckTemplate[]>(STORAGE_KEY, []);
  const migrated = raw.map(migrateTemplate);
  // Persist migrations so the next read is a no-op and the saved template
  // visibly reflects the new model id.
  if (migrated.some((t, i) => t !== raw[i])) {
    safeWrite(STORAGE_KEY, migrated);
  }
  // Sort newest-first.
  return [...migrated].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export function saveTemplate(
  input: Omit<DeckTemplate, "id" | "savedAt"> & { id?: string },
): DeckTemplate {
  const existing = listTemplates();
  const id = input.id ?? makeId();
  const record: DeckTemplate = {
    id,
    name: input.name.trim() || "이름없는 양식",
    savedAt: new Date().toISOString(),
    slideCount: input.slideCount,
    includeImages: input.includeImages,
    language: input.language,
    deckType: input.deckType,
    overrides: { ...input.overrides },
  };
  const next = [record, ...existing.filter((t) => t.id !== id)];
  safeWrite(STORAGE_KEY, next);
  return record;
}

export function deleteTemplate(id: string): void {
  const next = listTemplates().filter((t) => t.id !== id);
  safeWrite(STORAGE_KEY, next);
  if (getDefaultTemplateId() === id) clearDefaultTemplate();
}

export function getTemplate(id: string): DeckTemplate | undefined {
  return listTemplates().find((t) => t.id === id);
}

export function setDefaultTemplate(id: string | null): void {
  if (!id) {
    safeRemove(DEFAULT_KEY);
    return;
  }
  safeWrite(DEFAULT_KEY, id);
}

export function clearDefaultTemplate(): void {
  safeRemove(DEFAULT_KEY);
}

export function getDefaultTemplateId(): string | null {
  return safeRead<string | null>(DEFAULT_KEY, null);
}

export function getDefaultTemplate(): DeckTemplate | undefined {
  const id = getDefaultTemplateId();
  return id ? getTemplate(id) : undefined;
}
