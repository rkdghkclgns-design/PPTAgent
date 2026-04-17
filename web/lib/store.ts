"use client";

import { create } from "zustand";

import { DEFAULT_MODELS, type ModelSlot } from "./models";
import type { ModelOverrides, SlideData } from "./api";

export type JobStatus = "idle" | "running" | "succeeded" | "failed";

interface StudioState {
  prompt: string;
  slideCount: number;
  includeImages: boolean;
  language: "ko" | "en";
  overrides: ModelOverrides;

  status: JobStatus;
  slides: SlideData[];
  activeSlide: number;
  progress: number;
  error: string | null;
  pptxUrl: string | null;

  setPrompt: (value: string) => void;
  setSlideCount: (value: number) => void;
  setIncludeImages: (value: boolean) => void;
  setLanguage: (value: "ko" | "en") => void;
  setModel: (slot: ModelSlot, id: string) => void;

  beginJob: () => void;
  updateProgress: (percent: number) => void;
  setSlides: (slides: SlideData[]) => void;
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
  status: "idle" as JobStatus,
  slides: [] as SlideData[],
  activeSlide: 0,
  progress: 0,
  error: null as string | null,
  pptxUrl: null as string | null,
};

export const useStudioStore = create<StudioState>((set) => ({
  ...initial,
  setPrompt: (value) => set({ prompt: value }),
  setSlideCount: (value) =>
    set({ slideCount: Math.max(1, Math.min(25, Math.round(value))) }),
  setIncludeImages: (value) => set({ includeImages: value }),
  setLanguage: (value) => set({ language: value }),
  setModel: (slot, id) =>
    set((s) => ({ overrides: { ...s.overrides, [slot]: id } })),

  beginJob: () =>
    set({
      status: "running",
      slides: [],
      activeSlide: 0,
      progress: 0,
      error: null,
      pptxUrl: null,
    }),
  updateProgress: (percent) =>
    set((s) => ({ progress: Math.max(s.progress, Math.min(1, percent)) })),
  setSlides: (slides) => set({ slides, activeSlide: 0 }),
  setActiveSlide: (index) => set({ activeSlide: index }),
  succeed: (pptxUrl) => set({ status: "succeeded", progress: 1, pptxUrl: pptxUrl ?? null }),
  fail: (error) => set({ status: "failed", error }),
  reset: () => set({ ...initial }),
}));
