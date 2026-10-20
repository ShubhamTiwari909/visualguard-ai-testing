import type { ProjectTestExecution } from "../shared/project-tests";

const stages = {
  starting: "Starting the browser…",
  capturing: "Capturing screenshots…",
  comparing: "Comparing and analyzing…",
  uploading: "Uploading test results…",
  finalizing: "Saving the result link…",
};

export function ExecutionProgress({ execution }: { execution: ProjectTestExecution }) {
  const { progress, status } = execution;
  const terminal = status === "completed" || status === "failed";
  const comparisons = Boolean(progress?.totalJobs);
  const measured =
    comparisons && (terminal || progress?.stage === "capturing" || progress?.stage === "comparing");
  const title =
    status === "completed"
      ? "Test finished"
      : status === "failed"
        ? "Test could not finish"
        : status === "queued"
          ? "Waiting for the runner…"
          : progress
            ? stages[progress.stage]
            : "Running visual comparison…";
  const value = measured
    ? progress!.completedJobs
    : status === "completed"
      ? 1
      : terminal
        ? 0
        : undefined;
  return (
    <div className="vg-execution-progress" data-status={status}>
      <div role="status" aria-live="polite" aria-atomic="true" className="vg-execution-heading">
        <strong>{title}</strong>
        <span className="vg-muted">Configuration v{execution.configVersion}</span>
        {comparisons && (
          <span className="vg-comparison-count">
            {progress!.completedJobs} of {progress!.totalJobs} comparisons completed
            {measured && ` (${Math.floor((progress!.completedJobs / progress!.totalJobs) * 100)}%)`}
          </span>
        )}
      </div>
      <progress
        className="vg-execution-bar"
        max={progress?.totalJobs || 1}
        value={value}
        aria-label={measured ? "Comparisons completed" : terminal ? "Test execution" : title}
      />
      {!terminal && progress?.route && (
        <p className="vg-execution-route">
          <span>{progress.route}</span>
          {progress.viewport && <span> · {progress.viewport}</span>}
        </p>
      )}
      {status === "queued" && (
        <p className="vg-muted">The connected runner will pick up this request.</p>
      )}
      {status === "running" && ["uploading", "finalizing"].includes(progress?.stage ?? "") && (
        <p className="vg-muted">
          Comparison processing has finished. Keeping the runner connected until the results are
          saved.
        </p>
      )}
      {status === "completed" && (
        <p className="vg-muted">Open the result to see its visual regression and review status.</p>
      )}
      {execution.error && (
        <p role="alert" className="vg-form-error">
          {execution.error}
        </p>
      )}
      {execution.runId && (
        <a className="vg-button" href={`/runs/${execution.runId}`}>
          View result
        </a>
      )}
    </div>
  );
}
