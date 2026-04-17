/**
 * Client-side PPTX builder.
 *
 * Takes the SlideData[] returned by the `generate` Edge Function and emits a
 * .pptx file directly in the browser via pptxgenjs. No server upload step,
 * no signed URL - the file lives on the user's disk immediately.
 */

"use client";

import type { SlideData } from "./api";

const INK_950 = "05050E";
const INK_100 = "E6E7F0";
const ELECTRON = "7C5CFF";
const AURORA = "5AE0BD";
const MUTED = "A0A3B8";

function sanitizeFilename(prompt: string): string {
  const base = prompt.slice(0, 40).replace(/[^a-zA-Z0-9가-힣_-]+/g, "-");
  const stamp = new Date().toISOString().slice(0, 10);
  return `${(base || "presentation").toLowerCase()}-${stamp}.pptx`;
}

export async function downloadPptx(
  slides: SlideData[],
  prompt: string,
): Promise<string> {
  if (slides.length === 0) {
    throw new Error("no slides to export");
  }
  // Lazy import so the pptxgenjs bundle only lands when the user actually
  // downloads a deck.
  const PptxGenJsModule = await import("pptxgenjs");
  const PptxGenJS = PptxGenJsModule.default ?? PptxGenJsModule;
  const pptx = new (PptxGenJS as any)();

  pptx.layout = "LAYOUT_WIDE"; // 13.3 x 7.5 in (16:9)
  pptx.title = prompt.slice(0, 80);
  pptx.author = "PPTAgent Studio";
  pptx.company = "PPTAgent";

  for (const slide of slides) {
    const s = pptx.addSlide();
    s.background = { color: INK_950 };

    const hasImage = Boolean(slide.imageUrl);
    // Left column for text; right column for the reference image. If there is
    // no image we give the text full width.
    const leftW = hasImage ? 6.7 : 12.3;

    // Title
    s.addText(slide.title || "", {
      x: 0.5,
      y: 0.45,
      w: leftW,
      h: 1.1,
      fontFace: "Inter",
      fontSize: 30,
      bold: true,
      color: INK_100,
      valign: "middle",
    });

    // Electron accent bar under the title
    s.addShape("rect", {
      x: 0.5,
      y: 1.55,
      w: 0.9,
      h: 0.08,
      fill: { color: ELECTRON },
      line: { color: ELECTRON, width: 0 },
    });

    // Bullets
    if (slide.bullets?.length) {
      s.addText(
        slide.bullets.map((b) => ({ text: b, options: { breakLine: true, bullet: { code: "2022" } } })),
        {
          x: 0.5,
          y: 1.9,
          w: leftW,
          h: 4.5,
          fontFace: "Inter",
          fontSize: 16,
          color: INK_100,
          valign: "top",
          paraSpaceAfter: 8,
        },
      );
    }

    // Speaker notes -> real PPTX notes pane
    if (slide.notes) {
      s.addNotes(slide.notes);
    }

    // Reference image on the right
    if (hasImage && slide.imageUrl) {
      s.addImage({
        data: slide.imageUrl,
        x: 7.4,
        y: 0.9,
        w: 5.4,
        h: 5.4,
        sizing: { type: "cover", w: 5.4, h: 5.4 },
      });
      // Thin caption with the image prompt so the user remembers what they
      // asked for.
      if (slide.imagePrompt) {
        s.addText(slide.imagePrompt.slice(0, 120), {
          x: 7.4,
          y: 6.35,
          w: 5.4,
          h: 0.4,
          fontFace: "Inter",
          fontSize: 9,
          color: MUTED,
          italic: true,
          valign: "top",
        });
      }
    }

    // Page number
    s.addText(`${slide.index + 1}`, {
      x: 12.5,
      y: 7.0,
      w: 0.6,
      h: 0.35,
      fontFace: "Inter",
      fontSize: 10,
      color: AURORA,
      align: "right",
    });
  }

  const filename = sanitizeFilename(prompt);
  await pptx.writeFile({ fileName: filename });
  return filename;
}
