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
      const events = [...s.events, ev];
      let { slides, activeSlide, progress, pptxUrl } = s;
      if (typeof ev.percent === "number") progress = Math.max(progress, ev.percent);
      if (ev.stage === "design" && typeof ev.slide_index === "number") {
        const idx = ev.slide_index;
        const next = [...slides];
        next[idx] = {
          index: idx,
          imageUrl: ev.slide_preview_url ?? next[idx]?.imageUrl,
          title: ev.message,
        };
        slides = next;
        activeSlide = idx;
      }
      if (ev.pptx_url) pptxUrl = ev.pptx_url;
      return { events, slides, activeSlide, progress, pptxUrl };
    }),
  setActiveSlide: (index) => set({ activeSlide: index }),
  reset: () => set({ ...initialState }),
}));
