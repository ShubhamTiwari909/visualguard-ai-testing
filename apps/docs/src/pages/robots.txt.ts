export const prerender = true;

export function GET() {
  const production = process.env.DOCS_PRODUCTION === "true";
  const origin = process.env.DOCS_SITE_URL || "https://shubhamtiwari909.github.io";
  const base = (process.env.DOCS_BASE_PATH || "/").replace(/\/$/, "");
  const text = production
    ? `User-agent: *\nAllow: /\nSitemap: ${origin.replace(/\/$/, "")}${base}/sitemap-index.xml\n`
    : "User-agent: *\nDisallow: /\n";
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
