import { join } from "node:path";
import { z } from "zod";
import type { JobResult } from "../../core/types.js";
import type { Edit } from "../../fixer/edits.js";
import { formatValue } from "../../mapping/describe.js";
import { preparedPNG } from "../images.js";
import type { AIProvider, Part, Usage } from "../provider.js";

export const PATCH_PROMPT_VERSION = "patch-v1";

export const PatchSchema = z.object({
  summary: z.string().max(400),
  confidence: z.number().min(0).max(1),
  edits: z
    .array(
      z.object({
        file: z.string(),
        search: z.string().min(1),
        replace: z.string(),
        reason: z.string().max(300),
      }),
    )
    .min(1)
    .max(6),
});

export const PATCH_SYSTEM_PROMPT = `You are a senior frontend engineer. A visual regression was found: the STAGING version of a
page differs from PRODUCTION, and production is the correct look. Change the source code so the
page looks like production again.

Rules:
- Edit only the files you are shown. Never invent files.
- Each edit is a search/replace block. "search" must be copied exactly from the file, including
  indentation and quotes, and must appear exactly once in that file. Include enough surrounding
  text to make it unique, but keep it short.
- Make the smallest change that restores production's look. Don't refactor, rename or reformat.
- The DOM changes list computed CSS values on production and staging; restoring production's
  value is usually the fix. Source may express it differently (Tailwind classes, CSS variables,
  hex colours, shorthands).
- Respond with JSON matching the provided schema, nothing else.`;

export interface PatchInput {
  job: JobResult;
  runDir: string;
  files: Array<{ path: string; excerpt: string; reasons: string[] }>;
  /** What went wrong with the previous attempt, if any. */
  feedback?: string;
  previous?: Edit[];
}

function describeJob(job: JobResult): string {
  const lines = [`Route: ${job.route}   Viewport: ${job.viewport}`];
  if (job.analysis) {
    lines.push(`Regression: ${job.analysis.title}`, job.analysis.summary);
    if (job.analysis.likelyCause) lines.push(`Likely cause: ${job.analysis.likelyCause}`);
    if (job.analysis.suggestedFix)
      lines.push(`Suggested fix: ${job.analysis.suggestedFix.description}`);
  }
  for (const finding of job.findings ?? [])
    if (finding.severity !== "info") lines.push(`Finding: ${finding.message}`);
  const deltas = job.regions.flatMap((region) => region.deltas).slice(0, 20);
  if (deltas.length > 0) {
    lines.push("DOM changes (production → staging):");
    for (const delta of deltas) {
      if (delta.kind === "style")
        lines.push(
          `  ${delta.selector}  ${delta.property}: ${formatValue(delta.production)} → ${formatValue(delta.staging)}`,
        );
      else if (delta.kind === "text")
        lines.push(`  ${delta.selector}  text: "${delta.production}" → "${delta.staging}"`);
      else if (delta.kind === "presence")
        lines.push(
          `  ${delta.selector}  ${delta.presentIn === "production" ? "missing on staging" : "added on staging"}`,
        );
      else lines.push(`  ${delta.selector}  moved/resized`);
    }
  }
  return lines.join("\n");
}

export function buildPatchParts(provider: AIProvider, input: PatchInput): Part[] {
  const parts: Part[] = [{ type: "text", text: describeJob(input.job) }];
  const region = input.job.regions.find((candidate) => candidate.crops);
  if (region?.crops && provider.capabilities.maxImages >= 2) {
    parts.push({
      type: "text",
      text: "[images] production crop, staging crop of the main changed region",
    });
    parts.push({
      type: "image",
      mimeType: "image/png",
      data: preparedPNG(join(input.runDir, region.crops.production), 768),
    });
    parts.push({
      type: "image",
      mimeType: "image/png",
      data: preparedPNG(join(input.runDir, region.crops.staging), 768),
    });
  }
  for (const file of input.files) {
    parts.push({
      type: "text",
      text: `File: ${file.path}  (why: ${file.reasons.join(", ")})\n\`\`\`\n${file.excerpt}\n\`\`\``,
    });
  }
  if (input.feedback) {
    const previous = input.previous
      ?.map(
        (edit) =>
          `- ${edit.file}: replace ${JSON.stringify(edit.search)} with ${JSON.stringify(edit.replace)}`,
      )
      .join("\n");
    parts.push({
      type: "text",
      text: `Your previous attempt did not work.\n${previous ? `Previous edits:\n${previous}\n` : ""}Problem: ${input.feedback}\nPropose different edits.`,
    });
  }
  parts.push({ type: "text", text: "Return JSON matching the schema." });
  return parts;
}

export interface PatchOutput {
  summary: string;
  confidence: number;
  edits: Edit[];
  usage: Usage;
}

export async function generatePatch(provider: AIProvider, input: PatchInput): Promise<PatchOutput> {
  const { data, usage } = await provider.generate({
    system: PATCH_SYSTEM_PROMPT,
    parts: buildPatchParts(provider, input),
    schema: PatchSchema,
  });
  return {
    summary: data.summary,
    confidence: data.confidence,
    edits: data.edits.map((edit) => ({ ...edit, file: edit.file.replace(/^\.\//, "") })),
    usage,
  };
}
