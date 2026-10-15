import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { FormEvent, MouseEvent, ReactNode } from "react";
import { App as ReportApp } from "../../../packages/visualguard/report-app/src/App";
import { formatDuration, jobSummary } from "../../../packages/visualguard/report-app/src/data";
import { api, artifactUrl, reportManifest, releaseArtifacts } from "./api";
import {
  RUN_STATUSES,
  runLabel,
  type Project,
  type RunDetail,
  type RunPage,
  type RunStatus,
  type StoredRun,
} from "../shared/contracts";
import "./styles.css";
import { AccountMenu, SessionProvider, useSession } from "./auth";
import { Settings } from "./settings";
import { DeleteAction, deletionMessage } from "./delete-action";
import { RunNameEditor } from "./naming";

function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

function Link({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  };
  return (
    <a className={className} href={href} onClick={click}>
      {children}
    </a>
  );
}

function Status({ value }: { value: RunStatus }) {
  return (
    <span className={`vg-status vg-status-${value}`}>
      <span aria-hidden="true" />
      {value === "incomplete" ? "Incomplete" : value[0]!.toUpperCase() + value.slice(1)}
    </span>
  );
}

function Timestamp({ value }: { value: string }) {
  return (
    <time dateTime={value} title={new Date(value).toLocaleString()}>
      {new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  );
}

function ErrorMessage({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="vg-error" role="alert">
      <strong>Unable to load evidence</strong>
      <p>{error}</p>
      {retry && (
        <button className="vg-button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

function Metadata({ run }: { run: StoredRun }) {
  return (
    <div className="vg-meta">
      {run.metadata.branch && <span title="Branch">⑂ {run.metadata.branch}</span>}
      {run.metadata.commit && (
        <code title={`Source revision: ${run.metadata.commit}`}>
          {run.metadata.commit.slice(0, 12)}
        </code>
      )}
      {run.metadata.pullRequest && <span>PR #{run.metadata.pullRequest}</span>}
      {run.metadata.deployment && <span title="Deployment">{run.metadata.deployment}</span>}
    </div>
  );
}

function Shell({ projects, children }: { projects: Project[]; children: ReactNode }) {
  const session = useSession();
  const selected = new URLSearchParams(window.location.search).get("project");
  useEffect(() => {
    document.documentElement.dataset.theme = "light";
  }, []);
  return (
    <div className="platform">
      <aside className="vg-sidebar">
        <Link className="vg-brand" href="/">
          <span className="vg-logo" aria-hidden="true">
            V
          </span>
          VisualGuard<span className="vg-brand-dot">.</span>
        </Link>
        <div className="vg-workspace">
          <span className="vg-workspace-icon">W</span>
          <div>
            <strong>Workspace</strong>
            <small>
              {session.access === "local" ? "Local evidence library" : "Team evidence library"}
            </small>
          </div>
        </div>
        <p className="vg-nav-heading">QUALITY</p>
        <Link className={`vg-nav-link ${!selected ? "is-active" : ""}`} href="/">
          <span aria-hidden="true">▦</span> Run history
        </Link>
        <Link className="vg-nav-link" href="/settings">
          <span aria-hidden="true">⚙</span> People & integrations
        </Link>
        <div className="vg-nav-heading-row">
          <p className="vg-nav-heading">PROJECTS</p>
          <span>{projects.length}</span>
        </div>
        <nav aria-label="Projects">
          {projects.map((project) => (
            <Link
              key={project.id}
              className={`vg-nav-link ${selected === project.id ? "is-active" : ""}`}
              href={`/?project=${encodeURIComponent(project.id)}`}
            >
              <span className="vg-project-mark">{project.name[0]?.toUpperCase()}</span>
              <span className="vg-truncate">{project.name}</span>
              <small>{project.runCount}</small>
            </Link>
          ))}
          {!projects.length && <p className="vg-muted vg-small">Your projects will appear here.</p>}
        </nav>
        <div className="vg-sidebar-footer">
          <span className="vg-online" />{" "}
          {session.access === "local" ? "Local workspace" : "Team workspace"}
          <p>{session.user?.name}</p>
        </div>
      </aside>
      <div className="vg-workspace-main">
        <header className="vg-topbar">
          <span>
            Workspace <span className="vg-breadcrumb">/</span> Evidence
          </span>
          <Link className="vg-mobile-settings" href="/settings">
            Settings
          </Link>
          <AccountMenu />
        </header>
        {children}
      </div>
    </div>
  );
}

function ProjectForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      await api.createProject(String(form.get("id")), String(form.get("name")));
      setOpen(false);
      onCreated();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Project creation failed");
    } finally {
      setPending(false);
    }
  };
  return (
    <div>
      <button
        className="vg-button vg-button-primary"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? "Cancel" : "+ New project"}
      </button>
      {open && (
        <form
          className="vg-project-form"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <h2>Create a project</h2>
          <label>
            Project name
            <input name="name" placeholder="Storefront" maxLength={120} required />
          </label>
          <label>
            Project ID
            <input
              name="id"
              placeholder="storefront"
              pattern="[a-z0-9](?:[a-z0-9]|-){0,62}"
              maxLength={63}
              required
            />
            <small>Lowercase letters, numbers, and hyphens.</small>
          </label>
          {error && (
            <p className="vg-form-error" role="alert">
              {error}
            </p>
          )}
          <button className="vg-button vg-button-primary" disabled={pending}>
            {pending ? "Creating…" : "Create project"}
          </button>
        </form>
      )}
    </div>
  );
}

function RunHistory({
  projects,
  refreshProjects,
  search,
}: {
  projects: Project[];
  refreshProjects: () => void;
  search: string;
}) {
  const session = useSession();
  const [page, setPage] = useState<RunPage>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const params = new URLSearchParams(search);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    api
      .runs(search, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) setPage(result);
      })
      .catch((problem: Error) => {
        if (!abort.signal.aborted) setError(problem.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [search, revision]);
  useEffect(() => {
    document.title = "Run history · VisualGuard";
  }, []);
  const filter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget))
      if (String(value).trim()) next.set(key, String(value).trim());
    navigate(`/${next.size ? `?${next}` : ""}`);
  };
  const paginate = (offset: number) => {
    const next = new URLSearchParams(search);
    next.set("offset", String(offset));
    navigate(`/?${next}`);
  };
  const refresh = () => {
    setRevision((value) => value + 1);
    refreshProjects();
  };
  return (
    <main className="vg-content">
      <div className="vg-page-heading">
        <div>
          <p className="vg-eyebrow">YOUR UI, OVER TIME</p>
          <h1>Run history</h1>
          <p className="vg-muted">
            A shared view of what changed, with the evidence to understand it.
          </p>
        </div>
        {session.user?.admin && <ProjectForm onCreated={refresh} />}
      </div>
      <div className="vg-stat-grid">
        <div className="vg-stat">
          <span>Projects</span>
          <strong>{projects.length}</strong>
          <small>In this workspace</small>
        </div>
        <div className="vg-stat">
          <span>Stored runs</span>
          <strong>{projects.reduce((sum, item) => sum + item.runCount, 0)}</strong>
          <small>Original evidence preserved</small>
        </div>
        <div className="vg-stat">
          <span>Matching runs</span>
          <strong>{loading ? "…" : (page?.total ?? "—")}</strong>
          <small>Across the active filters</small>
        </div>
        <div className="vg-stat vg-stat-note">
          <span className="vg-evidence-icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <strong>Evidence comes first</strong>
            <small>
              Incomplete coverage stays visible. A passing run is not a release approval.
            </small>
          </div>
        </div>
      </div>
      <section className="vg-panel" aria-labelledby="runs-heading">
        <div className="vg-panel-heading">
          <div>
            <h2 id="runs-heading">
              All runs <span className="vg-count">{loading ? "…" : (page?.total ?? 0)}</span>
            </h2>
            <p>Search by route, check name, viewport, branch, or revision.</p>
          </div>
          <button className="vg-button" onClick={refresh} disabled={loading}>
            ↻ Refresh
          </button>
        </div>
        <form key={search} className="vg-filters" onSubmit={filter} aria-label="Filter runs">
          <div className="vg-filter-row">
            <label className="vg-search">
              <span className="vg-sr-only">Search evidence</span>
              <input
                name="q"
                placeholder="Search runs, routes, or revisions…"
                defaultValue={params.get("q") ?? ""}
              />
            </label>
            <label>
              <span className="vg-sr-only">Project</span>
              <select name="project" defaultValue={params.get("project") ?? ""}>
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="vg-sr-only">Status</span>
              <select name="status" defaultValue={params.get("status") ?? ""}>
                <option value="">All statuses</option>
                {RUN_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status[0]!.toUpperCase() + status.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="vg-sr-only">Environment</span>
              <input
                name="environment"
                placeholder="Environment"
                defaultValue={params.get("environment") ?? ""}
              />
            </label>
            <button className="vg-button" type="submit">
              Apply filters
            </button>
            {search && (
              <Link className="vg-clear" href="/">
                Clear
              </Link>
            )}
          </div>
          <details className="vg-advanced">
            <summary>Revision, deployment & date filters</summary>
            <div className="vg-advanced-grid">
              {(["branch", "commit", "deployment", "pr"] as const).map((key) => (
                <label key={key}>
                  {key === "pr" ? "Pull request" : key[0]!.toUpperCase() + key.slice(1)}
                  <input
                    name={key}
                    type={key === "pr" ? "number" : "text"}
                    min={key === "pr" ? 1 : undefined}
                    defaultValue={params.get(key) ?? ""}
                  />
                </label>
              ))}
              <label>
                From
                <input
                  name="from"
                  type="date"
                  defaultValue={params.get("from")?.slice(0, 10) ?? ""}
                />
              </label>
              <label>
                Through
                <input name="to" type="date" defaultValue={params.get("to")?.slice(0, 10) ?? ""} />
              </label>
            </div>
            <p className="vg-muted vg-small">
              Date boundaries use UTC. Revision and environment filters match exactly.
            </p>
          </details>
        </form>
        {error ? (
          <ErrorMessage error={error} retry={refresh} />
        ) : loading ? (
          <div className="vg-empty" role="status">
            Loading run history…
          </div>
        ) : !page?.runs.length ? (
          <div className="vg-empty">
            <span className="vg-empty-icon" aria-hidden="true">
              ▧
            </span>
            <h3>
              {page?.total === 0 && !search
                ? "Your evidence library starts here"
                : "No runs on this page"}
            </h3>
            <p>
              {!search
                ? "Import a saved VisualGuard run to explore screenshots, findings, and history."
                : "Try different filters or return to the first page."}
            </p>
            {!search && (
              <code>
                npx visualguard dashboard import /absolute/path/to/run --project storefront
              </code>
            )}
            {search && (
              <Link className="vg-button" href="/">
                View all runs
              </Link>
            )}
          </div>
        ) : (
          <div className="vg-table-scroll">
            <table className="vg-table">
              <thead>
                <tr>
                  <th>Run / project</th>
                  <th>Result</th>
                  <th>Revision</th>
                  <th>Environment</th>
                  <th>Checks</th>
                  <th>Started</th>
                  <th>
                    <span className="vg-sr-only">View run</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link className="vg-run-link" href={`/runs/${run.id}`}>
                        {runLabel(run)}
                      </Link>
                      <small className="vg-table-secondary">
                        {run.name ? `Run #${run.number} · ` : ""}
                        {projects.find((item) => item.id === run.projectId)?.name ?? run.projectId}
                      </small>
                    </td>
                    <td>
                      <Status value={run.status} />
                    </td>
                    <td>
                      <Metadata run={run} />
                      {!run.metadata.branch &&
                        !run.metadata.commit &&
                        !run.metadata.pullRequest &&
                        !run.metadata.deployment && <span className="vg-muted">Not supplied</span>}
                    </td>
                    <td>
                      <span className="vg-env">{run.metadata.environment}</span>
                    </td>
                    <td>
                      <strong>{run.jobCount}</strong>
                      <small className="vg-table-secondary">{formatDuration(run.durationMs)}</small>
                    </td>
                    <td className="vg-nowrap">
                      <Timestamp value={run.startedAt} />
                    </td>
                    <td>
                      <Link className="vg-row-arrow" href={`/runs/${run.id}`}>
                        <span className="vg-sr-only">Open {runLabel(run)}</span>↗
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page && !loading && !error && (
          <div className="vg-pagination">
            <span>
              {page.total
                ? `${page.offset + 1}–${Math.min(page.offset + page.runs.length, page.total)} of ${page.total} runs`
                : "0 runs"}
            </span>
            <div>
              <button
                className="vg-button"
                disabled={page.offset === 0}
                onClick={() => paginate(Math.max(0, page.offset - page.limit))}
              >
                Previous
              </button>
              <button
                className="vg-button"
                disabled={page.offset + page.limit >= page.total}
                onClick={() => paginate(page.offset + page.limit)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
      <p className="vg-footer-note">
        Immutable run evidence · No release approval is implied by a run status
      </p>
    </main>
  );
}

function RunView({
  id,
  report,
  projects,
  onDeleted,
}: {
  id: string;
  report: boolean;
  projects: Project[];
  onDeleted: (message: string, project?: string) => void;
}) {
  const session = useSession();
  const [run, setRun] = useState<RunDetail>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setRun(undefined);
    setError("");
    api
      .run(id, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) setRun(result);
      })
      .catch((problem: Error) => {
        if (!abort.signal.aborted) setError(problem.message);
      });
    return () => {
      abort.abort();
      releaseArtifacts(id);
    };
  }, [id, revision]);
  useEffect(() => {
    if (run && !report) document.title = `${runLabel(run)} · VisualGuard`;
  }, [run, report]);
  if (error)
    return (
      <Shell projects={projects}>
        <main className="vg-content">
          <Link href="/" className="vg-back">
            ← Run history
          </Link>
          <ErrorMessage error={error} retry={() => setRevision((value) => value + 1)} />
        </main>
      </Shell>
    );
  if (!run)
    return (
      <Shell projects={projects}>
        <main className="vg-content" role="status">
          Loading run evidence…
        </main>
      </Shell>
    );
  if (report)
    return (
      <div className="vg-report-layout">
        <div className="vg-report-bar">
          <Link href={`/runs/${run.id}`}>← {runLabel(run)}</Link>
          <span>Read-only saved evidence</span>
        </div>
        <div className="vg-report-app">
          <ReportApp
            key={run.id}
            data={{ manifest: reportManifest(run), generatedAt: run.importedAt }}
          />
        </div>
      </div>
    );
  const jobs = run.manifest.jobs.filter((job) =>
    `${job.route} ${job.name} ${job.viewport} ${job.status}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <Shell projects={projects}>
      <main className="vg-content">
        <Link className="vg-back" href={`/?project=${encodeURIComponent(run.projectId)}`}>
          ← {projects.find((project) => project.id === run.projectId)?.name ?? run.projectId} / Run
          history
        </Link>
        <div className="vg-page-heading">
          <div>
            <p className="vg-eyebrow">SAVED RUN EVIDENCE</p>
            <h1>
              {runLabel(run)} <Status value={run.status} />
            </h1>
            <p className="vg-muted">
              {run.name ? `Run #${run.number} · ` : ""}
              <Timestamp value={run.startedAt} /> · {formatDuration(run.durationMs)} · {run.mode} ·{" "}
              {run.metadata.environment}
            </p>
            <Metadata run={run} />
          </div>
          <div className="vg-delete-actions">
            <Link className="vg-button vg-button-primary" href={`/runs/${run.id}/report`}>
              Open comparison viewer ↗
            </Link>
            {(session.user?.admin ||
              projects.find((project) => project.id === run.projectId)?.role === "maintainer") && (
              <>
              <RunNameEditor run={run} onSaved={setRun} />
              <DeleteAction
                kind="run"
                id={run.id}
                name={runLabel(run)}
                onDeleted={(result) => {
                  releaseArtifacts(run.id);
                  onDeleted(deletionMessage("run", result), run.projectId);
                }}
              />
              </>
            )}
          </div>
        </div>
        {!run.complete && (
          <div className="vg-warning" role="alert">
            <strong>Incomplete evidence</strong>
            <ul>
              {run.completenessReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p>This run cannot establish complete coverage.</p>
          </div>
        )}
        <div className="vg-result-strip">
          {(["regression", "review", "error", "accepted", "pass"] as const).map((status) => (
            <div key={status}>
              <Status value={status} />
              <strong>{run.summary[status]}</strong>
            </div>
          ))}
        </div>
        <section className="vg-panel">
          <div className="vg-panel-heading">
            <div>
              <h2>
                Checks <span className="vg-count">{run.jobCount}</span>
              </h2>
              <p>Inspect an individual state or open the complete comparison viewer.</p>
            </div>
            <label>
              <span className="vg-sr-only">Filter checks</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter checks…"
              />
            </label>
          </div>
          <div className="vg-table-scroll">
            <table className="vg-table">
              <thead>
                <tr>
                  <th>Page / checkpoint</th>
                  <th>Viewport</th>
                  <th>Result</th>
                  <th>Evidence</th>
                  <th>Explanation</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <Link
                        className="vg-run-link"
                        href={`/runs/${run.id}/report#/jobs/${encodeURIComponent(job.id)}`}
                      >
                        {job.route}
                      </Link>
                      <small className="vg-table-secondary">{job.name}</small>
                    </td>
                    <td>{job.viewport}</td>
                    <td>
                      <Status value={job.status} />
                    </td>
                    <td>
                      <div className="vg-capture-links">
                        {(["production", "staging"] as const).map((side) => {
                          const capture = job.captures[side];
                          return capture ? (
                            <a
                              key={side}
                              href={artifactUrl(run.id, capture.image)}
                              target="_blank"
                              rel="noreferrer"
                              title={
                                side === "production"
                                  ? "Open reference screenshot"
                                  : "Open candidate screenshot"
                              }
                            >
                              <img
                                src={artifactUrl(run.id, capture.image)}
                                loading="lazy"
                                alt={`${side === "production" ? "Reference" : "Candidate"} for ${job.name}`}
                              />
                            </a>
                          ) : (
                            <span key={side} className="vg-missing-capture">
                              Missing
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td>
                      <p className="vg-job-summary">
                        {jobSummary(job) || "No additional findings"}
                      </p>
                      <div className="vg-evidence-links">
                        {Object.entries(job.captures).map(([side, capture]) =>
                          capture?.dom ? (
                            <a
                              key={side}
                              href={artifactUrl(run.id, capture.dom)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {side === "production" ? "Reference" : "Candidate"} DOM ↗
                            </a>
                          ) : null,
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!jobs.length && <div className="vg-empty">No matching checks.</div>}
          </div>
        </section>
        <details className="vg-provenance">
          <summary>Evidence identity & provenance</summary>
          <dl>
            <dt>Engine run ID</dt>
            <dd>{run.engineRunId}</dd>
            <dt>Evidence digest</dt>
            <dd>
              <code>{run.digest}</code>
            </dd>
            <dt>Imported</dt>
            <dd>{new Date(run.importedAt).toLocaleString()}</dd>
            <dt>Engine / schema</dt>
            <dd>
              {run.manifest.tool.version} / {run.manifest.schemaVersion}
            </dd>
            <dt>Platform envelope</dt>
            <dd>v{run.envelopeVersion}</dd>
            <dt>Artifacts</dt>
            <dd>{run.artifacts.length} checksummed objects</dd>
            <dt>Expected checks</dt>
            <dd>{run.manifest.provenance?.expectedJobs.length ?? "Not recorded by the engine"}</dd>
            <dt>Source revision</dt>
            <dd>{run.metadata.commit ?? "Not supplied"}</dd>
          </dl>
          <a href={`/api/runs/${run.id}`} target="_blank" rel="noreferrer">
            View saved evidence JSON ↗
          </a>
        </details>
        <p className="vg-footer-note">
          Run status describes captured evidence, independently of release approval.
        </p>
      </main>
    </Shell>
  );
}

function Platform() {
  const [location, setLocation] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const change = () =>
      setLocation({ path: window.location.pathname, search: window.location.search });
    window.addEventListener("popstate", change);
    return () => window.removeEventListener("popstate", change);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    api
      .projects(abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) setProjects(result.projects);
      })
      .catch((problem: Error) => {
        if (!abort.signal.aborted) setError(problem.message);
      });
    return () => abort.abort();
  }, [revision]);
  const refresh = () => setRevision((value) => value + 1);
  const deleted = (message: string, project?: string) => {
    setNotice(message);
    refresh();
    navigate(project ? `/?project=${encodeURIComponent(project)}` : "/");
  };
  if (error)
    return (
      <Shell projects={projects}>
        <main className="vg-content">
          <ErrorMessage error={error} retry={refresh} />
        </main>
      </Shell>
    );
  const match = location.path.match(/^\/runs\/([a-f0-9-]{36})(\/report)?$/);
  return match ? (
    <RunView
      key={match[1]}
      id={match[1]!}
      report={Boolean(match[2])}
      projects={projects}
      onDeleted={deleted}
    />
  ) : (
    <Shell projects={projects}>
      {notice && (
        <div role="status" className="vg-deletion-notice">
          {notice}
          <button type="button" className="vg-button" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}
      {location.path === "/settings" ? (
        <Settings projects={projects} onDeleted={deleted} />
      ) : (
        <RunHistory
          key={revision}
          projects={projects}
          refreshProjects={refresh}
          search={location.search}
        />
      )}
    </Shell>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <Platform />
    </SessionProvider>
  </StrictMode>,
);
