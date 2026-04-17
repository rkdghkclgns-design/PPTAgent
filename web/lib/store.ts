"use client";

import { create } from "zustand";

import { DEFAULT_MODELS, type ModelSlot } from "./models";
import type { AttachmentPayload, ModelOverrides, SlideData } from "./api";

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
  overrides: ModelOverrides;
  attachments: AttachmentEntry[];

  status: JobStatus;
  slides: SlideData[];
  activeSlide: number;
  progress: number;
  error: string | null;
  sampleMode: boolean;
  pptxUrl: string | null;

  setPrompt: (value: string) => void;
  setSlideCount: (value: number) => void;
  setIncludeImages: (value: boolean) => void;
  setLanguage: (value: "ko" | "en") => void;
  setModel: (slot: ModelSlot, id: string) => void;
  addAttachment: (att: AttachmentEntry) => void;
  removeAttachment: (id: string) => void;

  beginJob: () => void;
  updateProgress: (percent: number) => void;
  setSlides: (slides: SlideData[], sampleMode?: boolean) => void;
  setActiveSlide: (index: number) => void;
  succeed: (pptxUrl?: string | null) => void;
  fail: (error: string) => void;
  reset: () => void;
}

const initial = {
  prompt: "",
  slideCount: 8,
  includeImages: true,
  language: "ko" as const,
  overrides: { ...DEFAULT_MODELS } as ModelOverrides,
  attachments: [] as AttachmentEntry[],
  status: "idle" as JobStatus,
  slides: [] as SlideData[],
  activeSlide: 0,
  progress: 0,
  error: null as string | null,
  sampleMode: false,
  pptxUrl: null as string | null,
};

export const useStudioStore = create<StudioState>((set) => ({
  ...initial,
  setPrompt: (value) => set({ prompt: value }),
  setSlideCount: (value) =>
    set({ slideCount: Math.max(1, Math.min(100, Math.round(value))) }),
  setIncludeImages: (value) => set({ includeImages: value }),
  setLanguage: (value) => set({ language: value }),
  setModel: (slot, id) =>
    set((s) => ({ overrides: { ...s.overrides, [slot]: id } })),
  addAttachment: (att) => set((s) => ({ attachments: [...s.attachments, att] })),
  removeAttachment: (id) =>
    set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),

  beginJob: () =>
    set({
      status: "running",
      slides: [],
      activeSlide: 0,
      progress: 0,
      error: null,
      sampleMode: false,
      pptxUrl: null,
    }),
  updateProgress: (percent) =>
    set((s) => ({ progress: Math.max(s.progress, Math.min(1, percent)) })),
  setSlides: (slides, sampleMode = false) =>
    set({ slides, activeSlide: 0, sampleMode }),
  setActiveSlide: (index) => set({ activeSlide: index }),
  succeed: (pptxUrl) => set({ status: "succeeded", progress: 1, pptxUrl: pptxUrl ?? null }),
  fail: (error) => set({ status: "failed", error }),
  reset: () => set({ ...initial }),
}));
