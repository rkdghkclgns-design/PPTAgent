/**
 * Client-side PPTX builder with kind-aware layouts, mermaid diagrams and
 * citation footers.
 */

"use client";

import type { SlideData, SourceRef } from "./api";
import { renderMermaid, svgToPngDataUrl } from "./mermaid";

const INK_950 = "05050E";
const INK_900 = "0A0B14";
const INK_100 = "E6E7F0";
const ELECTRON = "7C5CFF";
const AURORA = "5AE0BD";
const SUNRISE = "FF8A4C";
const MUTED = "A0A3B8";

function sanitizeFilename(prompt: string): string {
  const base = prompt.slice(0, 40).replace(/[^a-zA-Z0-9가-힣_-]+/g, "-");
  const stamp = new Date().toISOString().slice(0, 10);
  return `${(base || "presentation").toLowerCase()}-${stamp}.pptx`;
}

/** Pre-render every mermaid diagram to a PNG data URL before building the PPTX. */
async function rasteriseDiagrams(slides: SlideData[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (let i = 0; i < slides.length; i++) {
    const diagram = slides[i].diagram;
    if (!diagram) continue;
    try {
      const svg = await renderMermaid(diagram, `deck-${i}`);
      if (!svg) continue;
      const png = await svgToPngDataUrl(svg, 1600, 1200);
      out.set(i, png);
    } catch (err) {
      console.warn(`diagram rasterise failed for slide ${i + 1}`, err);
    }
  }
  return out;
}

export async function downloadPptx(slides: SlideData[], prompt: string): Promise<string> {
  if (slides.length === 0) throw new Error("no slides to export");

  const PptxGenJsModule = await import("pptxgenjs");
  const PptxGenJS = PptxGenJsModule.default ?? PptxGenJsModule;
  const pptx = new (PptxGenJS as any)();

  pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in
  pptx.title = prompt.slice(0, 80);
  pptx.author = "PPTAgent Studio";
  pptx.company = "PPTAgent";

  const diagrams = await rasteriseDiagrams(slides);

  for (const slide of slides) {
    const s = pptx.addSlide();
    s.background = { color: INK_950 };
    const diagramPng = diagrams.get(slide.index);

    switch (slide.kind) {
      case "cover":
        renderCover(s, slide);
        break;
      case "objectives":
        renderObjectives(s, slide);
        break;
      case "summary":
        renderSummary(s, slide);
        break;
      case "qna":
        renderQnA(s, slide);
        break;
      default:
        renderContent(s, slide, diagramPng);
    }

    if (slide.notes) s.addNotes(slide.notes);
    addSourcesFooter(s, slide.sources);
    addPageNumber(s, slide.index);
  }

  const filename = sanitizeFilename(prompt);
  await pptx.writeFile({ fileName: filename });
  return filename;
}

// ---------------------------------------------------------------------------
// Per-kind renderers
// ---------------------------------------------------------------------------

function renderCover(s: any, slide: SlideData) {
  if (slide.imageUrl) {
    s.addImage({
      data: slide.imageUrl,
      x: 0,
      y: 0,
      w: 13.333,
      h: 7.5,
      sizing: { type: "cover", w: 13.333, h: 7.5 },
      transparency: 40,
    });
  }
  s.addShape("rect", {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    fill: { color: INK_950, transparency: 30 },
    line: { color: INK_950, width: 0 },
  });
  s.addText("COVER", {
    x: 0.6,
    y: 3.0,
    w: 12,
    h: 0.5,
    fontFace: "Inter",
    fontSize: 14,
    color: ELECTRON,
    charSpacing: 5,
  });
  s.addText(slide.title, {
    x: 0.6,
    y: 3.5,
    w: 12,
    h: 2.4,
    fontFace: "Inter",
    fontSize: 58,
    bold: true,
    color: INK_100,
    valign: "top",
  });
  if (slide.bullets?.[0]) {
    s.addText(slide.bullets[0], {
      x: 0.6,
      y: 5.9,
      w: 12,
      h: 0.8,
      fontFace: "Inter",
      fontSize: 22,
      color: MUTED,
    });
  }
}

function renderObjectives(s: any, slide: SlideData) {
  s.addText("학습 목표 · OBJECTIVES", {
    x: 0.5, y: 0.45, w: 12.3, h: 0.5,
    fontFace: "Inter", fontSize: 14, color: AURORA, charSpacing: 4,
  });
  s.addText(slide.title, {
    x: 0.5, y: 0.95, w: 12.3, h: 1.1,
    fontFace: "Inter", fontSize: 34, bold: true, color: INK_100, valign: "middle",
  });
  s.addShape("rect", {
    x: 0.5, y: 2.05, w: 1.2, h: 0.1,
    fill: { color: AURORA }, line: { color: AURORA, width: 0 },
  });
  slide.bullets.forEach((bullet, i) => {
    const y = 2.5 + i * 0.85;
    if (y > 6.8) return;
    s.addShape("ellipse", {
      x: 0.5, y, w: 0.5, h: 0.5,
      fill: { color: INK_900 },
      line: { color: AURORA, width: 1.5 },
    });
    s.addText(String(i + 1), {
      x: 0.5, y, w: 0.5, h: 0.5,
      fontFace: "Inter", fontSize: 16, bold: true, color: AURORA, align: "center", valign: "middle",
    });
    s.addText(bullet, {
      x: 1.2, y: y - 0.05, w: 11, h: 0.6,
      fontFace: "Inter", fontSize: 18, color: INK_100, valign: "middle",
    });
  });
}

function renderContent(s: any, slide: SlideData, diagramPng?: string) {
  const hasVisual = Boolean(slide.imageUrl || diagramPng);
  const leftW = hasVisual ? 6.7 : 12.3;

  s.addText(slide.title, {
    x: 0.5, y: 0.45, w: leftW, h: 1.1,
    fontFace: "Inter", fontSize: 30, bold: true, color: INK_100, valign: "middle",
  });
  s.addShape("rect", {
    x: 0.5, y: 1.55, w: 0.9, h: 0.08,
    fill: { color: ELECTRON }, line: { color: ELECTRON, width: 0 },
  });
  if (slide.bullets?.length) {
    s.addText(
      slide.bullets.map((b) => ({
        text: b,
        options: { breakLine: true, bullet: { code: "2022" } },
      })),
      {
        x: 0.5, y: 1.9, w: leftW, h: 4.5,
        fontFace: "Inter", fontSize: 16, color: INK_100, valign: "top", paraSpaceAfter: 8,
      },
    );
  }

  if (hasVisual) {
    const visualSrc = diagramPng ?? slide.imageUrl;
    if (visualSrc) {
      s.addImage({
        data: visualSrc,
        x: 7.4, y: 0.9, w: 5.4, h: 5.4,
        sizing: { type: "contain", w: 5.4, h: 5.4 },
      });
    }
    const caption = diagramPng ? "Diagram · Mermaid" : slide.imagePrompt?.slice(0, 120);
    if (caption) {
      s.addText(caption, {
        x: 7.4, y: 6.35, w: 5.4, h: 0.4,
        fontFace: "Inter", fontSize: 9, color: MUTED, italic: true, valign: "top",
      });
    }
  }
}

function renderSummary(s: any, slide: SlideData) {
  s.addText("SUMMARY", {
    x: 0.5, y: 0.45, w: 12.3, h: 0.5,
    fontFace: "Inter", fontSize: 14, color: SUNRISE, charSpacing: 4,
  });
  s.addText(slide.title, {
    x: 0.5, y: 0.95, w: 12.3, h: 1.1,
    fontFace: "Inter", fontSize: 34, bold: true, color: INK_100, valign: "middle",
  });
  s.addShape("rect", {
    x: 0.5, y: 2.05, w: 1.2, h: 0.1,
    fill: { color: SUNRISE }, line: { color: SUNRISE, width: 0 },
  });
  const cols = slide.bullets.length > 3 ? 2 : 1;
  const rowH = 1.3;
  slide.bullets.slice(0, 6).forEach((bullet, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const w = cols === 2 ? 6.0 : 12.3;
    const x = 0.5 + col * 6.4;
    const y = 2.5 + row * rowH;
    s.addShape("roundRect", {
      x, y, w, h: rowH - 0.2,
      fill: { color: SUNRISE, transparency: 88 },
      line: { color: SUNRISE, width: 1 },
      rectRadius: 0.1,
    });
    s.addText(bullet, {
      x: x + 0.3, y: y + 0.1, w: w - 0.6, h: rowH - 0.4,
      fontFace: "Inter", fontSize: 15, color: INK_100, valign: "middle",
    });
  });
}

function renderQnA(s: any, slide: SlideData) {
  s.addShape("ellipse", {
    x: 5.7, y: 1.5, w: 1.9, h: 1.9,
    fill: { color: ELECTRON, transparency: 70 },
    line: { color: ELECTRON, width: 2 },
  });
  s.addText("?", {
    x: 5.7, y: 1.5, w: 1.9, h: 1.9,
    fontFace: "Inter", fontSize: 80, bold: true, color: INK_100, align: "center", valign: "middle",
  });
  s.addText(slide.title, {
    x: 0.5, y: 3.8, w: 12.3, h: 1.2,
    fontFace: "Inter", fontSize: 44, bold: true, color: INK_100, align: "center", valign: "middle",
  });
  if (slide.bullets?.[0]) {
    s.addText(slide.bullets[0], {
      x: 1.5, y: 5.1, w: 10.3, h: 0.7,
      fontFace: "Inter", fontSize: 18, color: MUTED, align: "center",
    });
  }
}

// ---------------------------------------------------------------------------
// Footer elements
// ---------------------------------------------------------------------------

function addSourcesFooter(s: any, sources?: SourceRef[]) {
  if (!sources || sources.length === 0) return;
  const text = sources
    .map((src, i) => `[${i + 1}] ${src.label}${src.url ? ` (${src.url})` : ""}`)
    .join("   ");
  s.addText(text, {
    x: 0.5, y: 6.95, w: 11.5, h: 0.45,
    fontFace: "Inter", fontSize: 9, color: AURORA, italic: true, valign: "top",
  });
}

function addPageNumber(s: any, index: number) {
  s.addText(`${index + 1}`, {
    x: 12.5, y: 7.0, w: 0.6, h: 0.35,
    fontFace: "Inter", fontSize: 10, color: AURORA, align: "right",
  });
}
