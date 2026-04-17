"use client";

/**
 * Browser-only mermaid renderer.
 *
 * Mermaid is heavy (~1MB gzipped). We lazy-import it so the initial studio
 * bundle stays lean, and we cache a singleton init. Returns an SVG string
 * ready to drop into <img src=data:image/svg+xml;base64,...> or a PPTX.
 */

let mermaidInit: Promise<typeof import("mermaid").default> | null = null;

function getMermaid() {
  if (!mermaidInit) {
    mermaidInit = import("mermaid").then((mod) => {
      const m = mod.default;
      m.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "dark",
        themeVariables: {
          background: "#05050E",
          primaryColor: "#7C5CFF",
          primaryTextColor: "#E6E7F0",
          primaryBorderColor: "#7C5CFF",
          lineColor: "#5AE0BD",
          secondaryColor: "#151531",
          tertiaryColor: "#10101F",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: "15px",
        },
        fontFamily: "Inter, system-ui, sans-serif",
      });
      return m;
    });
  }
  return mermaidInit;
}

/** Render mermaid source to an SVG string. Falls back to null on parse error. */
export async function renderMermaid(code: string, id: string): Promise<string | null> {
  try {
    const m = await getMermaid();
    const clean = code.trim();
    const result = await m.render(`mm-${id}-${Math.random().toString(36).slice(2, 8)}`, clean);
    return result.svg;
  } catch (err) {
    console.warn("mermaid render failed", err);
    return null;
  }
}

/** Convert an SVG string to a base64 data URL. */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

/** Convert an SVG string to a PNG data URL by rasterising on a canvas. */
export async function svgToPngDataUrl(svg: string, width = 1600, height = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas 2d unavailable"));
      ctx.fillStyle = "#05050E";
      ctx.fillRect(0, 0, width, height);
      // Preserve aspect ratio - fit SVG within the canvas.
      const ratio = Math.min(width / img.width, height / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;
      ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = svgToDataUrl(svg);
  });
}
