import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";

export const collections = {
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        description: z.string().min(15),
        audience: z.enum(["developer", "reviewer", "operator", "contributor"]),
        docType: z.enum(["tutorial", "how-to", "explanation", "reference"]),
        channel: z.enum(["published", "source", "both"]),
        lastReviewed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        minimumVersion: z.string().optional(),
        sourcePaths: z.array(z.string()).default([]),
      }),
    }),
  }),
};
