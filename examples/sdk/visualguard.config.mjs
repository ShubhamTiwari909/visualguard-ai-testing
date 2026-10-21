import { defineConfig } from "visualguard";

export default defineConfig({
  // Supply VISUALGUARD_PRODUCTION_URL and VISUALGUARD_STAGING_URL in the environment.
  routes: ["/"],
  viewports: { desktop: { width: 1440, height: 900 } },
  ai: { provider: "none" },
  output: { dir: ".visualguard", keepRuns: 10 },
  // To capture one section, enable:
  // screenshot: { selector: '[data-visualguard="checkout"]' },
});
