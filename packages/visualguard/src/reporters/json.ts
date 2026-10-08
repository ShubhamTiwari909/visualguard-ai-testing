import type { Reporter } from "../core/run.js";

/** Prints the manifest as JSON (`--json`). */
export function jsonReporter(stream: NodeJS.WritableStream = process.stdout): Reporter {
  return {
    name: "json",
    onRunEnd(manifest) {
      stream.write(`${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}
