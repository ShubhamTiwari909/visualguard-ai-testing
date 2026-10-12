/**
 * @file Builds React/Tailwind assets under dist/report-app in the layout expected by the HTML
 * reporter.
 *
 * This file is read by development/build tooling. Its exported object configures that tool; it
 * is not a visual-test run or an application page.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

// Built into dist/report-app. The HTML reporter inlines the JS and CSS into one index.html per
// run, because module scripts cannot be loaded from file:// URLs.
export default defineConfig({
  root,
  base: "./",
  plugins: [tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("../dist/report-app", import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 100_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        assetFileNames: "assets/[name][extname]",
        codeSplitting: false,
      },
    },
  },
});
