export const VIEWPORT_PRESETS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024, hasTouch: true },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
} as const;

export type ViewportPreset = keyof typeof VIEWPORT_PRESETS;
export type AIProviderName = "gemini" | "ollama" | "none";

export interface InitAnswers {
  production: string;
  /** Undefined when the staging URL comes from VISUALGUARD_STAGING_URL (e.g. per-PR previews). */
  staging?: string;
  routes: string[];
  /** Dynamic routes that need params; written as commented examples. */
  dynamicRoutes: string[];
  viewports: ViewportPreset[];
  ai: AIProviderName;
  aiModel?: string;
}

const quote = (value: string) => JSON.stringify(value);

function viewportLine(name: ViewportPreset): string {
  const preset = VIEWPORT_PRESETS[name] as Record<string, number | boolean>;
  const fields = Object.entries(preset)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
  return `    ${name}: { ${fields} },`;
}

/** Renders `visualguard.config.ts` from the init answers. */
export function renderConfig(answers: InitAnswers): string {
  const lines: string[] = [];
  lines.push(`import { defineConfig } from "visualguard";`, "", "export default defineConfig({");

  lines.push("  baseURL: {", `    production: ${quote(answers.production)},`);
  if (answers.staging) {
    lines.push("    // In CI, VISUALGUARD_STAGING_URL overrides this (e.g. a per-PR preview URL).");
    lines.push(`    staging: ${quote(answers.staging)},`);
  } else {
    lines.push("    // Staging comes from VISUALGUARD_STAGING_URL or --staging <url>.");
  }
  lines.push("  },", "");

  lines.push("  routes: [");
  for (const route of answers.routes) lines.push(`    ${quote(route)},`);
  if (answers.dynamicRoutes.length > 0) {
    lines.push("    // Dynamic routes need params, one job per entry:");
    for (const route of answers.dynamicRoutes.slice(0, 5)) {
      const params = [...route.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)]
        .map((match) => `${match[1]!.replace(/^\[?\.\.\./, "")}: "example"`)
        .join(", ");
      lines.push(`    // { path: ${quote(route)}, params: [{ ${params} }] },`);
    }
  }
  lines.push("  ],", "");

  lines.push("  viewports: {");
  for (const name of answers.viewports) lines.push(viewportLine(name));
  lines.push("  },", "");

  lines.push(
    "  stabilize: {",
    "    // Freeze Date so pages that show the current time render the same on both sites.",
    `    freezeTime: "2026-01-01T00:00:00Z",`,
    "    // Hide or mask content that changes on every load (ads, live prices, carousels).",
    "    // Mask fixed-size containers: masked areas keep their size.",
    `    // hide: [".promo-banner"],`,
    `    // mask: ["[data-testid=live-price]"],`,
    "  },",
    "",
  );

  lines.push("  ai: {", `    provider: ${quote(answers.ai)},`);
  if (answers.aiModel) lines.push(`    model: ${quote(answers.aiModel)},`);
  if (answers.ai === "gemini")
    lines.push("    // Reads GEMINI_API_KEY from the environment or .env.local.");
  if (answers.ai === "ollama")
    lines.push("    // Uses OLLAMA_HOST (default http://127.0.0.1:11434).");
  lines.push("  },");

  lines.push("});", "");
  return lines.join("\n");
}
