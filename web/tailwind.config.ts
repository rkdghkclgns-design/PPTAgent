import type { Config } from "tailwindcss";

/**
 * Dribbble-style design tokens.
 *
 * Palette: Deep Space charcoal, Electron Purple (signature), warm off-white
 * Aurora accent, and sparing use of a Sunrise highlight. All values are
 * exposed as CSS variables in globals.css so dark/light modes can swap them.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.25rem",
      screens: { "2xl": "1440px" },
    },
    extend: {
      colors: {
        // Brand
        ink: {
          50: "hsl(var(--ink-50))",
          100: "hsl(var(--ink-100))",
          200: "hsl(var(--ink-200))",
          300: "hsl(var(--ink-300))",
          400: "hsl(var(--ink-400))",
          500: "hsl(var(--ink-500))",
          600: "hsl(var(--ink-600))",
          700: "hsl(var(--ink-700))",
          800: "hsl(var(--ink-800))",
          900: "hsl(var(--ink-900))",
          950: "hsl(var(--ink-950))",
        },
        electron: {
          DEFAULT: "hsl(var(--electron))",
          soft: "hsl(var(--electron-soft))",
          glow: "hsl(var(--electron-glow))",
        },
        aurora: "hsl(var(--aurora))",
        sunrise: "hsl(var(--sunrise))",

        // Semantic
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        "card-foreground": "hsl(var(--card-foreground))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        border: "hsl(var(--border))",
        ring: "hsl(var(--ring))",
        destructive: "hsl(var(--destructive))",
      },
      fontFamily: {
        // Pretendard (한글 + 영문 지원)을 최우선으로 두고, 실패 시 Inter/Satoshi로 폴백.
        sans: ["Pretendard", "var(--font-inter)", "system-ui", "sans-serif"],
        display: ["Pretendard", "var(--font-satoshi)", "var(--font-inter)", "system-ui", "sans-serif"],
        serif: ["\"Noto Serif KR\"", "Georgia", "serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "display-xl": ["5.75rem", { lineHeight: "1", letterSpacing: "-0.04em", fontWeight: "700" }],
        "display-lg": ["4rem", { lineHeight: "1.02", letterSpacing: "-0.035em", fontWeight: "700" }],
        "display-md": ["3rem", { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "700" }],
        "display-sm": ["2.25rem", { lineHeight: "1.1", letterSpacing: "-0.025em", fontWeight: "600" }],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 8px)",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
      },
      boxShadow: {
        glass:
          "inset 0 1px 0 hsl(0 0% 100% / 0.06), 0 1px 2px hsl(0 0% 0% / 0.3), 0 20px 40px -20px hsl(var(--electron) / 0.25)",
        halo: "0 0 0 1px hsl(var(--electron) / 0.35), 0 0 60px hsl(var(--electron-glow) / 0.45)",
        soft: "0 1px 0 hsl(0 0% 100% / 0.04), 0 30px 60px -30px hsl(0 0% 0% / 0.6)",
      },
      backgroundImage: {
        "mesh-aurora":
          "radial-gradient(60% 60% at 20% 0%, hsl(var(--electron-glow) / 0.22) 0%, transparent 60%)," +
          "radial-gradient(50% 50% at 100% 20%, hsl(var(--aurora) / 0.18) 0%, transparent 60%)," +
          "radial-gradient(40% 40% at 50% 100%, hsl(var(--sunrise) / 0.12) 0%, transparent 60%)",
        "grid-faint":
          "linear-gradient(hsl(var(--border)) 1px, transparent 1px)," +
          "linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)",
      },
      backgroundSize: {
        "grid-24": "24px 24px",
      },
      keyframes: {
        shimmer: {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        breathing: {
          "0%, 100%": { opacity: "0.8", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.015)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        shimmer: "shimmer 6s ease-in-out infinite",
        breathing: "breathing 4s ease-in-out infinite",
        "fade-up": "fade-up 600ms cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
