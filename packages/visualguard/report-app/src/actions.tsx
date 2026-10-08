import { useRef, useState } from "react";
import { serverInfo, type JobResult } from "./data";
import { CopyButton } from "./ui";

const quoteArg = (value: string) =>
  /^[\w/.-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;

async function callAPI<T>(name: string, body: unknown): Promise<T> {
  const server = serverInfo()!;
  const response = await fetch(`./api/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-visualguard-token": server.token },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

interface Proposal {
  ok: boolean;
  message?: string;
  diff?: string;
  summary?: string;
  source?: "heuristic" | "ai";
  edits?: unknown[];
}

const buttonClass =
  "rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2";

/** "Generate fix": propose → show the diff → apply and verify only when confirmed. */
function FixButton({ job }: { job: JobResult }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<"idle" | "proposing" | "proposed" | "applying" | "done">(
    "idle",
  );
  const [proposal, setProposal] = useState<Proposal>();
  const [result, setResult] = useState<{ ok: boolean; message: string }>();

  const propose = async () => {
    setState("proposing");
    setResult(undefined);
    dialog.current?.showModal();
    try {
      const data = await callAPI<Proposal>("fix-propose", { jobId: job.id });
      setProposal(data);
      setState(data.ok ? "proposed" : "done");
      if (!data.ok) setResult({ ok: false, message: data.message ?? "No fix could be proposed." });
    } catch (error) {
      setState("done");
      setResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  };

  const apply = async () => {
    setState("applying");
    try {
      const data = await callAPI<{ ok: boolean; message: string }>("fix-apply", {
        jobId: job.id,
        edits: proposal?.edits,
      });
      setResult(data);
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
    setState("done");
  };

  return (
    <>
      <button
        type="button"
        onClick={propose}
        className={`${buttonClass} border border-slate-300 text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800`}
      >
        Generate fix
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`fix-title-${job.id}`}
        className="m-auto w-[min(56rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="space-y-4 p-5">
          <h2 id={`fix-title-${job.id}`} className="text-base font-semibold">
            Fix <code className="font-mono">{job.route}</code> · {job.viewport}
          </h2>
          {state === "proposing" && (
            <p className="text-sm">Finding the source and proposing a change…</p>
          )}
          {proposal?.ok && (
            <>
              <p className="text-sm text-slate-700 dark:text-slate-300">
                {proposal.summary}{" "}
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  ({proposal.source === "ai" ? "proposed by the AI provider" : "deterministic"})
                </span>
              </p>
              <pre className="max-h-96 overflow-auto rounded-md bg-slate-900 p-3 font-mono text-xs leading-5 text-slate-100">
                {proposal.diff?.split("\n").map((line, index) => (
                  <div
                    key={index}
                    className={
                      line.startsWith("+") && !line.startsWith("+++")
                        ? "text-emerald-300"
                        : line.startsWith("-") && !line.startsWith("---")
                          ? "text-rose-300"
                          : line.startsWith("@@")
                            ? "text-sky-300"
                            : "text-slate-400"
                    }
                  >
                    {line || " "}
                  </div>
                ))}
              </pre>
            </>
          )}
          {state === "applying" && (
            <p className="text-sm">Applying, running checks and re-capturing the page…</p>
          )}
          {result && (
            <p
              role="status"
              className={`rounded-md p-3 text-sm ${result.ok ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "bg-rose-50 text-rose-900 dark:bg-rose-950 dark:text-rose-200"}`}
            >
              {result.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                dialog.current?.close();
                if (result?.ok) window.location.reload();
              }}
              className={`${buttonClass} text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800`}
            >
              {state === "done" ? "Close" : "Cancel"}
            </button>
            {state === "proposed" && (
              <button
                type="button"
                onClick={apply}
                className={`${buttonClass} bg-sky-700 text-white hover:bg-sky-800`}
              >
                Apply and verify
              </button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}

/**
 * Served by `visualguard report`: "Accept change" and (with fix.enabled) "Generate fix" through
 * the local API. Static reports can't change files, so they offer the CLI command instead.
 */
export function JobActions({ job }: { job: JobResult }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [message, setMessage] = useState<string>();
  const server = serverInfo();
  const actionable =
    (job.status === "review" || job.status === "regression") &&
    job.captures.production &&
    job.captures.staging;
  if (!actionable) return null;

  const command = `npx visualguard accept ${quoteArg(job.route)} --viewport ${quoteArg(job.viewport)}`;
  if (!server) return <CopyButton text={command} label="Copy accept command" />;

  const accept = async () => {
    setState("busy");
    try {
      await callAPI("accept", { jobId: job.id });
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
      {server.fixEnabled && <FixButton job={job} />}
      <button
        type="button"
        onClick={accept}
        disabled={state === "busy"}
        title="Record these screenshots in visualguard.accepted.json so this change passes from now on"
        className={`${buttonClass} bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500`}
      >
        {state === "busy" ? "Accepting…" : "Accept change"}
      </button>
    </span>
  );
}
