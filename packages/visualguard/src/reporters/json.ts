/**
 * @file Reporter that prints the final manifest as JSON.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { Reporter } from "../core/run.js";

/**
 * Prints the manifest as JSON (`--json`).
 *
 * Create a reporter that writes the final manifest as formatted JSON to the chosen stream.
 * Accepting a stream supports stdout, files or tests.
 */
export function jsonReporter(stream: NodeJS.WritableStream = process.stdout): Reporter {
  return {
    name: "json",
    /**
     * Serialize the completed run with a final newline. This callback emits machine-readable
     * data rather than progress messages.
     */
    onRunEnd(manifest) {
      stream.write(`${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}
