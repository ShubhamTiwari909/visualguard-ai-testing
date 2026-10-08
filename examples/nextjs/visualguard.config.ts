import { defineConfig } from "visualguard";

// Production: `pnpm build && pnpm start` (port 3101), from good code.
// Staging: `pnpm dev` (port 3100), after `pnpm seed` adds three regressions.
export default defineConfig({
  baseURL: {
    production: "http://localhost:3101",
    staging: "http://localhost:3100",
  },
  routes: { discover: ["nextjs"] },
  viewports: {
    desktop: { width: 1280, height: 800 },
  },
  stabilize: {
    freezeTime: "2026-01-01T00:00:00Z",
    // Next.js dev mode shows an indicator in the corner.
    hide: ["nextjs-portal"],
  },
  ai: {
    provider: "gemini",
    model: "gemini-flash-latest",
  },
  fix: {
    enabled: true,
    include: ["app/**", "components/**"],
    verify: {
      server: { command: "pnpm dev", url: "http://localhost:3100", readyTimeoutMs: 90_000 },
      commands: ["pnpm exec tsc --noEmit"],
    },
  },
});
