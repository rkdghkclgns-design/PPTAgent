import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "PPTAgent Studio",
    template: "%s · PPTAgent Studio",
  },
  description:
    "Prompt-to-deck studio powered by PPTAgent. Deep research, free-form visual design, and agentic slide generation - wrapped in a Dribbble-grade interface.",
  applicationName: "PPTAgent Studio",
  keywords: [
    "PPT",
    "PowerPoint",
    "AI",
    "Gemini",
    "Imagen",
    "Agent",
    "Slide Generation",
    "Supabase",
  ],
  authors: [{ name: "PPTAgent" }],
  openGraph: {
    type: "website",
    title: "PPTAgent Studio",
    description: "AI-native presentation studio on top of PPTAgent.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#06060c" },
    { media: "(prefers-color-scheme: light)", color: "#f6f7fb" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className={`${inter.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">
        {children}
        <Toaster
          theme="dark"
          position="top-right"
          toastOptions={{
            className:
              "!bg-card !text-foreground !border !border-border/70 !shadow-glass backdrop-blur-xl",
          }}
        />
      </body>
    </html>
  );
}
