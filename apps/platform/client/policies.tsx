import { useEffect, useState, type FormEvent } from "react";
import type { Project, RunDetail, RunPage } from "../shared/contracts";
import type {
  PolicyAssessment,
  PolicyDelivery,
  PolicyHistory,
  VisualPolicy,
} from "../shared/policies";
import { mutation } from "./auth";

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  const value = await response.json();
  if (response.status === 401) window.dispatchEvent(new Event("visualguard-auth-expired"));
  if (!response.ok) throw new Error(value.error ?? "Unable to load policy");
  return value as T;
}
const defaults: VisualPolicy = {
  mode: "informative",
  baselineSet: "main",
  targetBranch: "main",
  environment: "staging",
  requiredChecks: [],
  requireApproval: true,
  maxAgeHours: 24,
  exceptions: [],
};
function policyFields(value: VisualPolicy): VisualPolicy {
  return {
    mode: value.mode,
    baselineSet: value.baselineSet,
    targetBranch: value.targetBranch,
    environment: value.environment,
    requiredChecks: value.requiredChecks,
    requireApproval: value.requireApproval,
    maxAgeHours: value.maxAgeHours,
    repository: value.repository,
    exceptions: value.exceptions,
  };
}
function Assessment({ value }: { value: PolicyAssessment }) {
  return (
    <div className="vg-policy-result" role="status">
      <strong>
        {value.status[0]!.toUpperCase() + value.status.slice(1)} · {value.mode}
      </strong>
      <p className="vg-small vg-muted">
        Policy v{value.policyVersion} · baseline{" "}
        {value.baselineVersion ? `v${value.baselineVersion}` : "missing"} · assessed{" "}
        {new Date(value.assessedAt).toLocaleString()}
      </p>
      <ul>
        {value.reasons.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>
      {value.waivedChecks.length > 0 && (
        <p>Temporary approval exceptions: {value.waivedChecks.join(", ")}</p>
      )}
      {value.runId && <a href={`/runs/${value.runId}`}>Inspect evidence and reviews</a>}
      <p className="vg-small">
        This is a point-in-time assessment. Refresh after changing reviews, policy or baselines.
      </p>
    </div>
  );
}
export function RunPolicy({ run }: { run: RunDetail }) {
  const [value, setValue] = useState<PolicyAssessment>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const assess = async () => {
    setPending(true);
    setError("");
    setValue(undefined);
    try {
      setValue(
        await mutation(`/api/projects/${run.projectId}/policy/assess`, "POST", {
          revision: run.metadata.commit,
          runId: run.id,
        }),
      );
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Assessment failed");
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="vg-panel vg-baseline-panel">
      <div className="vg-panel-heading">
        <div>
          <h2>Visual regression policy</h2>
          <p>Check this run against the current references and review requirements.</p>
        </div>
        <button
          className="vg-button"
          disabled={pending || !/^[a-f0-9]{40}$/.test(run.metadata.commit ?? "")}
          onClick={() => void assess()}
        >
          {pending ? "Assessing…" : "Assess this run"}
        </button>
      </div>
      <p>
        <a href={`/policies?project=${encodeURIComponent(run.projectId)}`}>
          Manage project policy and GitHub checks
        </a>
      </p>
      {!/^[a-f0-9]{40}$/.test(run.metadata.commit ?? "") && (
        <p>Capture and publish a run with its full source commit to assess it.</p>
      )}
      {error && (
        <p role="alert" className="vg-form-error">
          {error}
        </p>
      )}
      {value && <Assessment value={value} />}
    </section>
  );
}
export function PoliciesPage({ projects }: { projects: Project[] }) {
  const selected = new URLSearchParams(window.location.search).get("project");
  const project =
    projects.find(
      (item) =>
        item.id === selected ||
        item.publicId === selected ||
        item.aliases?.includes(selected ?? ""),
    ) ?? projects[0];
  const [id, setId] = useState(project?.id ?? "");
  useEffect(() => {
    document.title = "Visual regression policy · VisualGuard";
  }, []);
  useEffect(() => {
    if (!id && project) setId(project.id);
  }, [id, project]);
  return (
    <main className="vg-content">
      <div className="vg-page-heading">
        <div>
          <p className="vg-eyebrow">REVIEW BEFORE RELEASE</p>
          <h1>Visual regression policy</h1>
          <p className="vg-muted">
            Required screenshots, fresh approved references, and decisions for the exact commit.
          </p>
        </div>
      </div>
      <label className="vg-baseline-project">
        Project
        <select value={id} onChange={(event) => setId(event.target.value)}>
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {id ? (
        <PolicyEditor key={id} projectId={id} />
      ) : (
        <p>Create a project to configure visual regression checks.</p>
      )}
    </main>
  );
}
function PolicyEditor({ projectId }: { projectId: string }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/policy`;
  const [history, setHistory] = useState<PolicyHistory>();
  const [draft, setDraft] = useState<VisualPolicy>(defaults);
  const [checks, setChecks] = useState("");
  const [reason, setReason] = useState("");
  const [runs, setRuns] = useState<RunPage["runs"]>([]);
  const [runId, setRunId] = useState("");
  const [revision, setRevision] = useState("");
  const [pr, setPr] = useState("");
  const [deliveries, setDeliveries] = useState<PolicyDelivery[]>([]);
  const [assessment, setAssessment] = useState<PolicyAssessment>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const [exceptionJob, setExceptionJob] = useState("");
  const [exceptionRevision, setExceptionRevision] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const [exceptionExpiry, setExceptionExpiry] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setHistory(undefined);
    setError("");
    void Promise.all([
      get<PolicyHistory>(base, abort.signal),
      get<RunPage>(
        `/api/runs?${new URLSearchParams({ project: projectId, limit: "50" })}`,
        abort.signal,
      ),
      get<{ deliveries: PolicyDelivery[] }>(base + "/deliveries", abort.signal),
    ])
      .then(([value, page, deliveries]) => {
        if (abort.signal.aborted) return;
        setHistory(value);
        setDraft(policyFields(value.current ?? defaults));
        setChecks(value.current?.requiredChecks.join("\n") ?? "");
        setRuns(page.runs);
        setDeliveries(deliveries.deliveries);
      })
      .catch((problem: Error) => {
        if (!abort.signal.aborted) setError(problem.message);
      });
    return () => abort.abort();
  }, [base, projectId, reload]);
  const task = async (work: () => Promise<void>) => {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Request failed");
    } finally {
      setPending(false);
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void task(async () => {
      const policy = {
        ...policyFields(draft),
        requiredChecks: checks
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        repository: draft.repository?.trim() || undefined,
      };
      const result = await mutation<PolicyHistory>(base, "POST", {
        expectedVersion: history?.current?.version ?? 0,
        reason,
        policy,
      });
      setHistory(result);
      setDraft(policyFields(result.current!));
      setReason("");
      setAssessment(undefined);
      setNotice("Policy saved. Reconcile tracked PRs to publish the updated assessment.");
    });
  };
  const edit = <K extends keyof VisualPolicy>(key: K, value: VisualPolicy[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  return (
    <div className="vg-baseline-stack">
      {error && (
        <div role="alert" className="vg-error">
          <p>{error}</p>
          <button
            className="vg-button"
            disabled={pending}
            onClick={() => setReload((value) => value + 1)}
          >
            Reload
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="vg-policy-result">
          {notice}
        </p>
      )}
      {!history && !error && <p>Loading policy…</p>}
      {history && (
        <>
          <section className="vg-panel vg-baseline-panel">
            <h2>
              {history.current
                ? `Policy version ${history.current.version}`
                : "Configure your first policy"}
            </h2>
            <p className="vg-muted">
              Start with informative checks while measuring repeatability. Required mode reports
              failures; repository branch rules control enforcement.
            </p>
            <form className="vg-baseline-form" onSubmit={save}>
              <fieldset className="vg-policy-fields" disabled={pending || !history.canEdit}>
                <div className="vg-policy-grid">
                  <label>
                    Rollout mode
                    <select
                      value={draft.mode}
                      onChange={(event) => edit("mode", event.target.value as VisualPolicy["mode"])}
                    >
                      <option value="informative">Informative — report without blocking</option>
                      <option value="required">Required — report success or failure</option>
                    </select>
                  </label>
                  <label>
                    Approved baseline set
                    <input
                      required
                      pattern="[a-z0-9](?:[a-z0-9]|-){0,62}"
                      value={draft.baselineSet}
                      onChange={(event) => edit("baselineSet", event.target.value)}
                    />
                  </label>
                  <label>
                    PR target branch
                    <input
                      required
                      maxLength={200}
                      value={draft.targetBranch}
                      onChange={(event) => edit("targetBranch", event.target.value)}
                    />
                  </label>
                  <label>
                    Evidence environment
                    <input
                      required
                      maxLength={100}
                      value={draft.environment}
                      onChange={(event) => edit("environment", event.target.value)}
                    />
                  </label>
                  <label>
                    Evidence valid for (hours)
                    <input
                      required
                      type="number"
                      min={1}
                      max={720}
                      value={draft.maxAgeHours}
                      onChange={(event) => edit("maxAgeHours", Number(event.target.value))}
                    />
                  </label>
                  <label>
                    GitHub repository (optional)
                    <input
                      placeholder="owner/repository"
                      value={draft.repository ?? ""}
                      onChange={(event) => edit("repository", event.target.value)}
                    />
                    <small>The server operator must allow this repository.</small>
                  </label>
                </div>
                <label>
                  Required screenshot check IDs (one per line)
                  <textarea
                    rows={4}
                    value={checks}
                    onChange={(event) => setChecks(event.target.value)}
                  />
                  <small>
                    Leave empty to require every check in the approved baseline. Every captured
                    check is still assessed.
                  </small>
                </label>
                <label className="vg-baseline-confirm">
                  <input
                    type="checkbox"
                    checked={draft.requireApproval}
                    onChange={(event) => edit("requireApproval", event.target.checked)}
                  />
                  Require reviewer approval for changed screenshots
                </label>
                <details>
                  <summary>
                    Temporary visual approval exceptions ({draft.exceptions.length})
                  </summary>
                  <p className="vg-muted">
                    Exceptions expire within seven days and waive only a missing visual approval.
                    Rejections, missing screenshots and capture failures still block.
                  </p>
                  <ul className="vg-policy-exceptions">
                    {draft.exceptions.map((item, index) => (
                      <li key={index}>
                        <strong>{item.jobId}</strong> · {item.revision.slice(0, 12)} · expires{" "}
                        {new Date(item.expiresAt).toLocaleString()}
                        <p>{item.reason}</p>
                        <button
                          type="button"
                          className="vg-button"
                          onClick={() =>
                            edit(
                              "exceptions",
                              draft.exceptions.filter((_, i) => i !== index),
                            )
                          }
                        >
                          Remove exception
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="vg-policy-grid">
                    <label>
                      Screenshot check ID
                      <input
                        value={exceptionJob}
                        onChange={(event) => setExceptionJob(event.target.value)}
                      />
                    </label>
                    <label>
                      Exact commit
                      <input
                        value={exceptionRevision}
                        onChange={(event) => setExceptionRevision(event.target.value)}
                      />
                    </label>
                    <label>
                      Expiry
                      <input
                        type="datetime-local"
                        value={exceptionExpiry}
                        onChange={(event) => setExceptionExpiry(event.target.value)}
                      />
                    </label>
                    <label>
                      Exception reason
                      <input
                        value={exceptionReason}
                        maxLength={1000}
                        onChange={(event) => setExceptionReason(event.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="vg-button"
                    disabled={
                      !exceptionJob ||
                      !/^[a-f0-9]{40}$/.test(exceptionRevision) ||
                      !exceptionExpiry ||
                      !exceptionReason.trim()
                    }
                    onClick={() => {
                      edit("exceptions", [
                        ...draft.exceptions,
                        {
                          jobId: exceptionJob,
                          revision: exceptionRevision,
                          expiresAt: new Date(exceptionExpiry).toISOString(),
                          reason: exceptionReason,
                        },
                      ]);
                      setExceptionJob("");
                      setExceptionRevision("");
                      setExceptionExpiry("");
                      setExceptionReason("");
                    }}
                  >
                    Add to draft
                  </button>
                </details>
                <label>
                  Reason for policy change
                  <textarea
                    required
                    maxLength={2000}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <button className="vg-button vg-button-primary">
                  {pending ? "Saving…" : "Save new policy version"}
                </button>
              </fieldset>
            </form>
            {!history.canEdit && (
              <p className="vg-muted">A project maintainer can change this policy.</p>
            )}
          </section>
          <section className="vg-panel vg-baseline-panel">
            <h2>Assess visual evidence</h2>
            <form
              className="vg-baseline-form"
              onSubmit={(event) => {
                event.preventDefault();
                void task(async () => {
                  setAssessment(undefined);
                  setAssessment(
                    await mutation(base + "/assess", "POST", {
                      revision,
                      ...(runId ? { runId } : {}),
                    }),
                  );
                });
              }}
            >
              <label>
                Evidence run
                <select
                  value={runId}
                  disabled={pending}
                  onChange={(event) => {
                    setRunId(event.target.value);
                    setAssessment(undefined);
                    const run = runs.find((item) => item.id === event.target.value);
                    setRevision(run?.metadata.commit ?? "");
                    setPr(String(run?.metadata.pullRequest ?? ""));
                  }}
                >
                  <option value="">Latest evidence for the entered commit</option>
                  {runs.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.name ?? `Run #${run.number}`} ·{" "}
                      {run.metadata.commit?.slice(0, 12) ?? "no source commit"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Exact candidate commit
                <input
                  required
                  pattern="[a-f0-9]{40}"
                  value={revision}
                  disabled={pending}
                  onChange={(event) => {
                    setRevision(event.target.value);
                    setAssessment(undefined);
                  }}
                />
              </label>
              <button className="vg-button" disabled={pending}>
                Assess current policy
              </button>
            </form>
            {assessment && <Assessment value={assessment} />}
          </section>
          <section className="vg-panel vg-baseline-panel">
            <h2>GitHub PR checks</h2>
            <p className="vg-muted">
              Reconciliation verifies the live PR head and refreshes its check. Run it after
              uploading evidence or changing reviews, references, access or policy.
            </p>
            <p>
              {history.githubConfigured
                ? "GitHub delivery is configured."
                : "GitHub delivery needs a server credential, an allowed repository, and a saved repository policy."}
            </p>
            {history.canEdit && (
              <form
                className="vg-baseline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void task(async () => {
                    await mutation(base + "/reconcile", "POST", { pullRequest: Number(pr) });
                    setDeliveries(
                      (await get<{ deliveries: PolicyDelivery[] }>(base + "/deliveries"))
                        .deliveries,
                    );
                    setNotice("GitHub check reconciled for the current PR commit.");
                  });
                }}
              >
                <label>
                  Pull request number
                  <input
                    type="number"
                    min={1}
                    max={2147483647}
                    required
                    value={pr}
                    disabled={pending}
                    onChange={(event) => setPr(event.target.value)}
                  />
                </label>
                <button className="vg-button" disabled={pending || !history.githubConfigured}>
                  Reconcile GitHub check
                </button>
              </form>
            )}
            <ul className="vg-policy-exceptions">
              {deliveries.map((item) => (
                <li key={item.pullRequest}>
                  <strong>PR #{item.pullRequest}</strong> ·{" "}
                  {item.revision.slice(0, 12) || "awaiting GitHub"} ·{" "}
                  {item.error ? "needs retry" : (item.assessment?.status ?? "pending")}
                  {item.checkUrl && (
                    <p>
                      <a href={item.checkUrl} target="_blank" rel="noreferrer">
                        Open GitHub check
                      </a>
                    </p>
                  )}
                  {item.error && <p className="vg-form-error">{item.error}</p>}
                  <small>Last reconciliation: {new Date(item.updatedAt).toLocaleString()}</small>
                </li>
              ))}
            </ul>
          </section>
          <section className="vg-panel vg-baseline-panel">
            <h2>Policy history</h2>
            <ol className="vg-baseline-history">
              {history.versions.map((item) => (
                <li key={item.version}>
                  <div>
                    <strong>
                      Version {item.version} · {item.mode}
                    </strong>
                    <p>{item.reason}</p>
                    <small>
                      {item.actor.name} · {new Date(item.at).toLocaleString()} · {item.baselineSet}{" "}
                      · {item.environment}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
