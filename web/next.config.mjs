/**
 * Next.js config - two targets share the same source tree:
 *
 *   1. Local dev / Vercel   -> standard SSR (`next dev`, `next build`)
 *   2. GitHub Pages         -> `next export` at /PPTAgent basePath
 *
 * The browser talks to Supabase directly, so there is no /proxy rewrite -
 * it would be silently dropped by `next export` anyway. Attachments aren't
 * supported in this branch (the generate flow doesn't need them yet).
 */

const isPages = process.env.DEPLOY_TARGET === "pages";
const repoName = "PPTAgent";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
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
};

export default nextConfig;
