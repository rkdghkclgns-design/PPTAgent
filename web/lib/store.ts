/**
 * Global Zustand store for the Studio page.
 *
 * Kept deliberately small - most state lives inside components and URL. The
 * store owns (1) the current prompt/attachments/models draft, (2) the live
 * event stream buffer, (3) the currently-selected slide in the preview.
 */

"use client";

import { create } from "zustand";

import { DEFAULT_MODELS, type ModelSlot } from "./models";
import type { GenerateEvent, GenerateJob, ModelOverrides } from "./api";

export interface SlidePreview {
  index: number;
  imageUrl?: string;
  title?: string;
}

interface StudioState {
  prompt: string;
  attachments: { name: string; objectPath: string; size: number }[];
  pages: string | null;
  overrides: ModelOverrides;

  job: GenerateJob | null;
  events: GenerateEvent[];
  slides: SlidePreview[];
  activeSlide: number;
  progress: number;
  pptxUrl: string | null;

  setPrompt: (value: string) => void;
  setPages: (value: string | null) => void;
  setModel: (slot: ModelSlot, id: string) => void;
  addAttachment: (att: { name: string; objectPath: string; size: number }) => void;
  removeAttachment: (objectPath: string) => void;
  setJob: (job: GenerateJob | null) => void;
  appendEvent: (ev: GenerateEvent) => void;
  setActiveSlide: (index: number) => void;
  reset: () => void;
}

const initialState = {
  prompt: "",
  attachments: [],
  pages: null,
  overrides: { ...DEFAULT_MODELS } as ModelOverrides,
  job: null,
  events: [],
  slides: [],
  activeSlide: 0,
  progress: 0,
  pptxUrl: null,
};

export const useStudioStore = create<StudioState>((set) => ({
  ...initialState,
  setPrompt: (value) => set({ prompt: value }),
  setPages: (value) => set({ pages: value }),
  setModel: (slot, id) =>
    set((s) => ({ overrides: { ...s.overrides, [slot]: id } })),
  addAttachment: (att) =>
    set((s) => ({ attachments: [...s.attachments, att] })),
  removeAttachment: (objectPath) =>
    set((s) => ({
      attachments: s.attachments.filter((a) => a.objectPath !== objectPath),
    })),
  setJob: (job) => set({ job, events: [], slides: [], progress: 0, pptxUrl: null }),
  appendEvent: (ev) =>
    set((s) => {
      const progress =
        typeof ev.percent === "number" ? Math.max(s.progress, ev.percent) : s.progress;
      const [slides, activeSlide] =
        ev.stage === "design" && typeof ev.slide_index === "number"
          ? (() => {
              const idx = ev.slide_index;
              const next = s.slides.slice();
              next[idx] = {
                index: idx,
                imageUrl: ev.slide_preview_url ?? next[idx]?.imageUrl,
                title: ev.message,
              };
              return [next, idx] as const;
            })()
          : ([s.slides, s.activeSlide] as const);
      return {
        events: [...s.events, ev],
        slides,
        activeSlide,
        progress,
        pptxUrl: ev.pptx_url ?? s.pptxUrl,
      };
    }),
  setActiveSlide: (index) => set({ activeSlide: index }),
  reset: () => set({ ...initialState }),
}));
