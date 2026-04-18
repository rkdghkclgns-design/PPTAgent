"use client";

import { create } from "zustand";

import { DEFAULT_MODELS, type ModelSlot } from "./models";
import type {
  AttachmentPayload,
  DeckType,
  GenerateProvider,
  ModelOverrides,
  SlideData,
} from "./api";

export type JobStatus = "idle" | "running" | "succeeded" | "failed";

export interface AttachmentEntry extends AttachmentPayload {
  /** Uniquely identify the attachment card so we can remove it. */
  id: string;
  /** Byte size for the thumbnail meta line. */
  size: number;
}

interface StudioState {
  prompt: string;
  slideCount: number;
  includeImages: boolean;
  language: "ko" | "en";
  deckType: DeckType;
  overrides: ModelOverrides;
  attachments: AttachmentEntry[];

  status: JobStatus;
  slides: SlideData[];
  activeSlide: number;
  progress: number;
  error: string | null;
  sampleMode: boolean;
  provider: GenerateProvider | null;
  providerNote: string | null;
  pptxUrl: string | null;

  setPrompt: (value: string) => void;
  setSlideCount: (value: number) => void;
  setIncludeImages: (value: boolean) => void;
  setLanguage: (value: "ko" | "en") => void;
  setDeckType: (value: DeckType) => void;
  setModel: (slot: ModelSlot, id: string) => void;
  applyTemplate: (tpl: {
    slideCount: number;
    includeImages: boolean;
    language: "ko" | "en";
    deckType: DeckType;
    overrides: ModelOverrides;
  }) => void;
  addAttachment: (att: AttachmentEntry) => void;
  removeAttachment: (id: string) => void;

  beginJob: () => void;
  updateProgress: (percent: number) => void;
  setSlides: (
    slides: SlideData[],
    meta?: { provider?: GenerateProvider; note?: string | null; sampleMode?: boolean },
  ) => void;
  setActiveSlide: (index: number) => void;
  updateSlide: (index: number, patch: Partial<SlideData>) => void;
  succeed: (pptxUrl?: string | null) => void;
  fail: (error: string) => void;
  reset: () => void;
}

const initial = {
  prompt: "",
  slideCount: 8,
  includeImages: true,
  language: "ko" as const,
  deckType: "generic" as DeckType,
  overrides: { ...DEFAULT_MODELS } as ModelOverrides,
  attachments: [] as AttachmentEntry[],
  status: "idle" as JobStatus,
  slides: [] as SlideData[],
  activeSlide: 0,
  progress: 0,
  error: null as string | null,
  sampleMode: false,
  provider: null as GenerateProvider | null,
  providerNote: null as string | null,
  pptxUrl: null as string | null,
};

export const useStudioStore = create<StudioState>((set) => ({
  ...initial,
  setPrompt: (value) => set({ prompt: value }),
  setSlideCount: (value) =>
    set({ slideCount: Math.max(1, Math.min(100, Math.round(value))) }),
  setIncludeImages: (value) => set({ includeImages: value }),
  setLanguage: (value) => set({ language: value }),
  setDeckType: (value) => set({ deckType: value }),
  setModel: (slot, id) =>
    set((s) => ({ overrides: { ...s.overrides, [slot]: id } })),
  addAttachment: (att) => set((s) => ({ attachments: [...s.attachments, att] })),
  removeAttachment: (id) =>
    set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),

  applyTemplate: (tpl) =>
    set({
      slideCount: tpl.slideCount,
      includeImages: tpl.includeImages,
      language: tpl.language,
      deckType: tpl.deckType,
      overrides: { ...tpl.overrides },
    }),

  beginJob: () =>
    set({
      status: "running",
      slides: [],
      activeSlide: 0,
      progress: 0,
      error: null,
      sampleMode: false,
      provider: null,
      providerNote: null,
      pptxUrl: null,
    }),
  updateProgress: (percent) =>
    set((s) => ({ progress: Math.max(s.progress, Math.min(1, percent)) })),
  setSlides: (slides, meta) =>
    set({
      slides,
      activeSlide: 0,
      sampleMode: meta?.sampleMode ?? meta?.provider === "sample",
      provider: meta?.provider ?? null,
      providerNote: meta?.note ?? null,
    }),
  setActiveSlide: (index) => set({ activeSlide: index }),
  updateSlide: (index, patch) =>
    set((s) => {
      if (index < 0 || index >= s.slides.length) return {};
      const next = s.slides.slice();
      next[index] = { ...next[index], ...patch };
      return { slides: next };
    }),
  succeed: (pptxUrl) => set({ status: "succeeded", progress: 1, pptxUrl: pptxUrl ?? null }),
  fail: (error) => set({ status: "failed", error }),
  reset: () => set({ ...initial }),
}));
