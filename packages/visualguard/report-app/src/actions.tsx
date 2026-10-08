import { useState } from "react";
import { serverInfo, type JobResult } from "./data";
import { CopyButton } from "./ui";

const quoteArg = (value: string) =>
  /^[\w/.-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;

/**
 * "Accept change": through the local API when served by `visualguard report`, otherwise a CLI
 * command to copy (static reports can't write files).
 */
export function JobActions({ job }: { job: JobResult }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [message, setMessage] = useState<string>();
  const server = serverInfo();
  const acceptable =
    (job.status === "review" || job.status === "regression") &&
    job.captures.production &&
    job.captures.staging;
  if (!acceptable) return null;

  const command = `npx visualguard accept ${quoteArg(job.route)} --viewport ${quoteArg(job.viewport)}`;
  if (!server) return <CopyButton text={command} label="Copy accept command" />;

  const accept = async () => {
    setState("busy");
    try {
      const response = await fetch("./api/accept", {
        method: "POST",
        headers: { "content-type": "application/json", "x-visualguard-token": server.token },
        body: JSON.stringify({ jobId: job.id }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      window.location.reload();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      {state === "error" && (
        <span role="alert" className="text-xs text-red-700 dark:text-red-300">
          {message}
        </span>
      )}
      <button
        type="button"
        onClick={accept}
        disabled={state === "busy"}
        title="Record these screenshots in visualguard.accepted.json so this change passes from now on"
        className="rounded-md bg-teal-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60 dark:bg-teal-600 dark:hover:bg-teal-500"
      >
        {state === "busy" ? "Accepting…" : "Accept change"}
      </button>
    </span>
  );
}
