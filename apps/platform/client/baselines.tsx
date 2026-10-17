import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Project, RunPage, StoredRun } from "../shared/contracts";
import type { BaselineHistory, BaselineVersion } from "../shared/baselines";
import { mutation } from "./auth";

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  const value = await response.json();
  if (response.status === 401) window.dispatchEvent(new Event("visualguard-auth-expired"));
  if (!response.ok) throw new Error(value.error ?? "Unable to load approved baselines");
  return value as T;
}
function renderingDescription(identity: unknown) {
  const value = identity as { platform?: string; project?: string; policy?: { browser?: { name?: string; colorScheme?: string; locale?: string }; viewport?: { width?: number; height?: number } } };
  return [value.policy?.browser?.name, value.policy?.browser?.colorScheme, value.policy?.browser?.locale, value.policy?.viewport && `${value.policy.viewport.width}×${value.policy.viewport.height}`, value.platform, value.project].filter(Boolean).join(" · ");
}
export function BaselinesPage({ projects }: { projects: Project[] }) {
  useEffect(() => { document.title = "Approved baselines · VisualGuard"; }, []);
  const selected = new URLSearchParams(window.location.search).get("project");
  const project = projects.find(item => item.id === selected || item.publicId === selected || item.aliases?.includes(selected ?? "")) ?? projects[0];
  const [projectId, setProjectId] = useState(project?.id ?? "");
  useEffect(() => { if (!projectId && project) setProjectId(project.id); }, [projectId, project]);
  return <main className="vg-content">
    <div className="vg-page-heading"><div><p className="vg-eyebrow">SHARED REFERENCES</p><h1>Approved baselines</h1><p className="vg-muted">Promote reviewed evidence into an immutable reference for future tests.</p></div></div>
    <label className="vg-baseline-project">Project<select value={projectId} onChange={event => setProjectId(event.target.value)}>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {projectId ? <BaselineSet key={projectId} projectId={projectId} /> : <p>Create a project and import a run to get started.</p>}
  </main>;
}
function BaselineSet({ projectId }: { projectId: string }) {
  const [sets, setSets] = useState<{ set: string; currentVersion: number }[]>([]);
  const [set, chooseSet] = useState("main");
  const [draft, setDraft] = useState("main");
  const [revision, refresh] = useState(0);
  const base = `/api/projects/${encodeURIComponent(projectId)}/baselines`;
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    get<{ sets: typeof sets }>(base, abort.signal).then(value => { if (!abort.signal.aborted) setSets(value.sets); }).catch(problem => { if (!abort.signal.aborted) setError(problem.message); });
    return () => abort.abort();
  }, [base, revision]);
  return <div className="vg-baseline-stack">
    <form className="vg-baseline-controls" onSubmit={event => { event.preventDefault(); chooseSet(draft); setError(""); }}>
      <label>Baseline set<input required pattern="[a-z0-9][a-z0-9-]{0,62}" maxLength={63} value={draft} onChange={event => setDraft(event.target.value)} list="baseline-sets" /></label>
      <datalist id="baseline-sets">{sets.map(item => <option key={item.set} value={item.set}>v{item.currentVersion}</option>)}</datalist>
      <button className="vg-button">Open set</button>
      <p className="vg-muted vg-small">Use a target branch or release label, such as main or release-1.</p>
    </form>
    {error && <p role="alert" className="vg-form-error">{error}</p>}
    <BaselineDetails key={`${set}:${revision}`} projectId={projectId} set={set} onChanged={() => refresh(value => value + 1)} />
  </div>;
}
function BaselineDetails({ projectId, set, onChanged }: { projectId: string; set: string; onChanged: () => void }) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/baselines/${encodeURIComponent(set)}`;
  const [history, setHistory] = useState<BaselineHistory>();
  const [current, setCurrent] = useState<BaselineVersion>();
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [olderRunId, setOlderRunId] = useState("");
  const restoreForm = useRef<HTMLFormElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const [candidateId, selectCandidate] = useState("");
  const [targetRevision, setTargetRevision] = useState("");
  const [reason, setReason] = useState("");
  const [coverageReason, setCoverageReason] = useState("");
  const [landed, setLanded] = useState(false);
  const [restoreVersion, setRestoreVersion] = useState<number>();
  const [restoreReason, setRestoreReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState(0);
  useEffect(() => { if (restoreVersion) { restoreForm.current?.scrollIntoView({ block: "center" }); restoreForm.current?.querySelector("textarea")?.focus(); } }, [restoreVersion]);
  useEffect(() => { if (error) errorMessage.current?.focus(); }, [error]);
  const candidate = runs.find(item => item.id === candidateId);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const value = await get<BaselineHistory>(`${base}/history`, abort.signal);
        const version = value.currentVersion ? await get<BaselineVersion>(base, abort.signal) : undefined;
        if (abort.signal.aborted) return;
        setHistory(value); setCurrent(version);
        if (value.canPromote) {
          const candidates = await get<RunPage>(`/api/runs?${new URLSearchParams({ project: projectId, limit: "100" })}`, abort.signal);
          if (!abort.signal.aborted) setRuns(candidates.runs.filter(item => item.complete));
        }
      } catch (problem) { if (!abort.signal.aborted) setError(problem instanceof Error ? problem.message : "Unable to load baselines"); }
    })();
    return () => abort.abort();
  }, [base, projectId]);
  const mutate = async (event: FormEvent, restore = false) => {
    event.preventDefault();
    if (pending || !history) return;
    setPending(true); setError("");
    try {
      if (restore) {
        await mutation(base + "/restore", "POST", { expectedVersion: history.currentVersion, version: restoreVersion, reason: restoreReason });
      } else {
        if (!candidate) throw new Error("Choose a candidate run");
        await mutation(base + "/promote", "POST", { expectedVersion: history.currentVersion, runId: candidate.id, evidenceDigest: candidate.digest, sourceRevision: candidate.metadata.commit, targetRevision, landed, reason, ...(coverageReason.trim() ? { coverageChangeReason: coverageReason } : {}) });
      }
      onChanged();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Unable to update baseline"); }
    finally { setPending(false); }
  };
  const loadOlderRun = async () => {
    if (pending || !/^[a-f0-9-]{36}$/.test(olderRunId)) return;
    setPending(true); setError("");
    try {
      const run = await get<StoredRun>(`/api/runs/${encodeURIComponent(olderRunId)}`);
      if (run.projectId !== projectId || !run.complete) throw new Error("Choose a complete run from this project");
      setRuns(previous => [...previous.filter(item => item.id !== run.id), run]); selectCandidate(run.id); setTargetRevision(run.metadata.commit ?? ""); setLanded(false);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Unable to load candidate"); }
    finally { setPending(false); }
  };
  const changePage = async (next: number, cursor?: string) => {
    if (pending) return;
    setPending(true); setError("");
    try {
      const value = await get<BaselineHistory>(`${base}/history${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`);
      if (value.currentVersion !== history?.currentVersion) throw new Error("The current baseline changed. Refresh the set before continuing.");
      setHistory(value); setPage(next); setCursors(previous => { const copy = previous.slice(0, next + 1); copy[next] = cursor; return copy; });
      setNotice(`History page ${next + 1} loaded.`);
      historyHeading.current?.focus();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Unable to load history"); }
    finally { setPending(false); }
  };
  return <>
    {error && <p ref={errorMessage} tabIndex={-1} role="alert" className="vg-form-error">{error} <button className="vg-button" onClick={onChanged} disabled={pending}>Refresh set</button></p>}
    {notice && <p role="status">{notice}</p>}
    {!history && !error && <p role="status">Loading baselines…</p>}
    {history && <>
      <section className="vg-panel vg-baseline-panel">
        <div className="vg-panel-heading"><div><h2>{set} · {current ? `version ${current.version}` : "No approved version yet"}</h2><p>{current ? `${current.entries.length} checks · promoted by ${current.actor.name} · ${new Date(current.promotedAt).toLocaleString()}` : "Initialize this set from a complete, reviewed run."}</p></div></div>
        {current && <><p>{current.reason}</p><p className="vg-muted vg-small">Source <code>{current.sourceRevision}</code> · landed revision <code>{current.targetRevision}</code></p>
          <div className="vg-table-scroll"><table className="vg-baseline-table"><thead><tr><th>Check</th><th>Viewport</th><th>Rendering identity</th><th>Reference</th></tr></thead><tbody>{current.entries.map(entry => <tr key={entry.key}><td><strong>{entry.name}</strong><small>{entry.route}</small></td><td>{entry.viewport}</td><td><span>{renderingDescription(entry.renderingIdentity)}</span><small><code title={JSON.stringify(entry.renderingIdentity)}>{entry.key.slice(0, 12)}</code></small></td><td><a href={`/runs/${current.runId}?review=${encodeURIComponent(entry.jobId)}`}>Source evidence</a></td></tr>)}</tbody></table></div>
          <p className="vg-muted vg-small">Pin this reference locally:</p><pre className="vg-baseline-command"><code>{`visualguard dashboard baseline pull ${set} --project ${projectId} --server ${window.location.origin} --version ${current.version} --out approved-${set}-v${current.version}`}</code></pre></>}
      </section>
      {history.canPromote && <section className="vg-panel vg-baseline-panel"><h2>{current ? "Promote reviewed evidence" : "Initialize approved baselines"}</h2>
        <p className="vg-muted">Every check needs a current visual approval. Independent failures block promotion. Existing checks must use the current approved image.</p>
        <form className="vg-baseline-form" onSubmit={event => void mutate(event)}>
          <label>Candidate run<select required value={candidateId} disabled={pending} onChange={event => { const run = runs.find(item => item.id === event.target.value); selectCandidate(event.target.value); setTargetRevision(run?.metadata.commit ?? ""); setLanded(false); }}><option value="">Select a complete run</option>{runs.map(run => <option key={run.id} value={run.id}>{run.name ?? `Run #${run.number}`} · {run.metadata.branch ?? "no branch"} · {run.metadata.commit?.slice(0, 12) ?? "no source revision"}</option>)}</select></label>
          <details><summary>Load an older run by ID</summary><div className="vg-baseline-controls"><label>Run ID<input value={olderRunId} disabled={pending} maxLength={36} onChange={event => setOlderRunId(event.target.value)} placeholder="Paste the ID from a run URL" /></label><button type="button" className="vg-button" disabled={pending || !/^[a-f0-9-]{36}$/.test(olderRunId)} onClick={() => void loadOlderRun()}>Load candidate</button></div></details>
          {candidate && <p className="vg-small"><a href={`/runs/${candidate.id}`}>Inspect candidate and approvals</a> · {candidate.jobCount} checks · source <code>{candidate.metadata.commit ?? "missing"}</code></p>}
          <label>Landed revision on {set}<input required pattern="[a-fA-F0-9]{40}([a-fA-F0-9]{24})?" value={targetRevision} disabled={pending} onChange={event => setTargetRevision(event.target.value)} /></label>
          <label>Promotion reason<textarea required maxLength={2000} value={reason} disabled={pending} onChange={event => setReason(event.target.value)} /></label>
          {current && <label>Coverage change reason (required if checks or rendering identities change)<textarea maxLength={2000} value={coverageReason} disabled={pending} onChange={event => setCoverageReason(event.target.value)} /></label>}
          <label className="vg-baseline-confirm"><input type="checkbox" required checked={landed} disabled={pending} onChange={event => setLanded(event.target.checked)} />I confirm this exact source change has landed on {set}. This is my confirmation; the dashboard does not verify the repository merge.</label>
          <button className="vg-button vg-button-primary" disabled={pending || !candidate}>{pending ? "Saving…" : current ? "Promote as new version" : "Create version 1"}</button>
        </form>
      </section>}
      <section className="vg-panel vg-baseline-panel"><div className="vg-panel-heading"><div><h2 ref={historyHeading} tabIndex={-1}>Version history</h2><p>Versions are immutable. Restoring a version creates a new promotion event.</p></div></div>
        {history.items.length === 0 && <p>No promotions yet.</p>}
        <ol className="vg-baseline-history">{history.items.map(item => <li key={item.version}><div><strong>Version {item.version}{item.version === history.currentVersion ? " · Current" : ""}</strong><p>{item.reason}</p><p className="vg-muted vg-small">{item.actor.name} · {new Date(item.promotedAt).toLocaleString()} · {item.checkCount} checks{item.restoredFrom ? ` · restored from v${item.restoredFrom}` : ""} · parent v{item.parentVersion}</p><p className="vg-small"><a href={`/runs/${item.runId}`}>Source run</a> · <code>{item.sourceRevision.slice(0, 12)}</code> · policy v{item.policyVersion}</p>{item.coverageChangeReason && <p className="vg-small">Coverage: {item.coverageChangeReason}</p>}</div>{history.canPromote && item.version !== history.currentVersion && <button className="vg-button" disabled={pending} onClick={() => { setRestoreVersion(item.version); setRestoreReason(""); }}>Restore v{item.version}</button>}</li>)}</ol>
        <nav className="vg-form-actions" aria-label="Baseline history pages"><button className="vg-button" disabled={pending || page === 0} onClick={() => void changePage(page - 1, cursors[page - 1])}>Previous</button><span>Page {page + 1}</span><button className="vg-button" disabled={pending || !history.nextCursor} onClick={() => void changePage(page + 1, history.nextCursor)}>Next</button></nav>
        {restoreVersion && <form ref={restoreForm} className="vg-baseline-form" onSubmit={event => void mutate(event, true)}><h3>Restore version {restoreVersion} as a new version</h3><label>Restore reason<textarea required maxLength={2000} value={restoreReason} disabled={pending} onChange={event => setRestoreReason(event.target.value)} /></label><div className="vg-form-actions"><button className="vg-button vg-button-primary" disabled={pending}>Confirm restore</button><button type="button" className="vg-button" disabled={pending} onClick={() => setRestoreVersion(undefined)}>Cancel</button></div></form>}
      </section>
    </>}
  </>;
}
