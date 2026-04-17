/**
 * Next.js config — tuned for dual-target builds:
 *
 *   1. Local dev / Vercel       → standard SSR build (`next dev`, `next build`)
 *   2. GitHub Pages             → static export with a /PPTAgent basePath
 *
 * Switch is driven by `DEPLOY_TARGET=pages` (set by the Pages workflow).
 *
 * Caveats for the Pages target:
 *   - `rewrites()` is silently ignored by `next export`, so the client must
 *     hit the FastAPI origin directly. Set NEXT_PUBLIC_API_ORIGIN to the full
 *     URL of the deployed API (e.g. https://pptagent-api.fly.dev).
 *   - Image optimisation is disabled because GitHub Pages has no optimizer.
 */

const isPages = process.env.DEPLOY_TARGET === "pages";
const repoName = "PPTAgent";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  // Static export for GitHub Pages
  ...(isPages
    ? {
        output: "export",
        basePath: `/${repoName}`,
        assetPrefix: `/${repoName}/`,
        trailingSlash: true,
      }
    : {}),
  images: isPages
    ? { unoptimized: true }
    : {
        remotePatterns: [
          { protocol: "https", hostname: "**.supabase.co" },
          { protocol: "https", hostname: "images.unsplash.com" },
        ],
      },
  ...(isPages
    ? {}
    : {
        async rewrites() {
          const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:7870";
          return [{ source: "/proxy/:path*", destination: `${apiOrigin}/:path*` }];
        },
      }),
};

export default nextConfig;
