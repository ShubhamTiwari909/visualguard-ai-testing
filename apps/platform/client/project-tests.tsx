import { useEffect, useRef, useState } from "react";
import { mutation } from "./auth";
import type { Project } from "../shared/contracts";
import type { ProjectTestConfig, ProjectTestExecution, ProjectTestSettings } from "../shared/project-tests";

const defaults: ProjectTestConfig = {
  baseURL: { production: "", staging: "" }, routes: ["/"],
  viewports: { desktop: { width: 1280, height: 800 } }, ai: { provider: "none" },
};
async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Unable to load project tests");
  return value as T;
}
export function ProjectTestControls({ project, canManage, onCompleted }: {
  project: Project; canManage: boolean; onCompleted?: () => void;
}) {
  const path = `/api/projects/${encodeURIComponent(project.id)}`;
  const [settings, setSettings] = useState<ProjectTestSettings | null>(null);
  const [config, setConfig] = useState<ProjectTestConfig>(defaults);
  const [routes, setRoutes] = useState("/");
  const [viewports, setViewports] = useState(JSON.stringify(defaults.viewports, null, 2));
  const [execution, setExecution] = useState<ProjectTestExecution | null>(null);
  const [online, setOnline] = useState(false), [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false), [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [credential, setCredential] = useState<{ id: string; token: string; expiresAt: string }>();
  const previous = useRef<ProjectTestExecution | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void read<ProjectTestSettings | null>(`${path}/test-config`, abort.signal).then((value) => {
      setSettings(value);
      if (value) { setConfig(value.config); setRoutes(value.config.routes.join("\n")); setViewports(JSON.stringify(value.config.viewports, null, 2)); }
      setLoaded(true);
    }).catch((problem: Error) => { if (!abort.signal.aborted) setError(problem.message); });
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status = await read<{ execution: ProjectTestExecution | null; runnerOnline: boolean }>(`${path}/test-execution`, abort.signal);
        if (abort.signal.aborted) return;
        if (status.execution?.status === "completed" && previous.current?.id === status.execution.id && previous.current.status !== "completed") onCompleted?.();
        previous.current = status.execution;
        setExecution(status.execution); setOnline(status.runnerOnline);
      } catch (problem) { if (!abort.signal.aborted) setError(problem instanceof Error ? problem.message : "Unable to read test status"); }
      if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 2500);
    };
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [project.id]);
  const act = async (name: string, work: () => Promise<void>) => {
    setPending(name); setError("");
    try { await work(); } catch (problem) { setError(problem instanceof Error ? problem.message : "Project action failed"); }
    finally { setPending(""); }
  };
  const active = execution?.status === "queued" || execution?.status === "running";
  const origin = typeof window === "undefined" ? "https://YOUR_DASHBOARD_HOST" : window.location.origin;
  return (
    <div className="vg-project-tests">
      <div className="vg-panel-heading">
        <div>
          <h3>Visual test</h3>
          <p>{online ? "Runner connected" : "Runner offline"} · {settings ? `Configuration v${settings.version}` : "Configure this project's test settings"}</p>
        </div>
        {canManage && <div className="vg-delete-actions">
          <button className="vg-button" onClick={() => setEditing(!editing)} disabled={Boolean(pending)}>Configure tests</button>
          <button className="vg-button vg-button-primary" disabled={!loaded || !settings || !online || active || dirty || Boolean(pending)}
            onClick={() => void act("run", async () => {
              const result = await mutation<ProjectTestExecution>(`${path}/test-execution`, "POST", { id: crypto.randomUUID(), configVersion: settings!.version });
              previous.current = result; setExecution(result);
            })}>{pending === "run" ? "Requesting…" : active ? "Test in progress…" : "Run test"}</button>
        </div>}
      </div>
      {error && <p role="alert" className="vg-form-error">{error}</p>}
      {dirty && <p className="vg-muted">Save the configuration before running a test.</p>}
      {execution && <div role="status" className="vg-test-status">
        <strong>{execution.status === "completed" ? "Test finished" : execution.status === "failed" ? "Test could not finish" : execution.status === "queued" ? "Test queued" : "Running visual comparison…"}</strong>
        <span> · config v{execution.configVersion}</span>
        {execution.error && <p>{execution.error}</p>}
        {execution.runId && <a className="vg-button" href={`/runs/${execution.runId}`}>View result</a>}
      </div>}
      {loaded && canManage && (editing || !settings) && <form className="vg-test-config" onSubmit={(event) => {
        event.preventDefault();
        void act("save", async () => {
          const next = { ...config, routes: routes.split("\n").map((route) => route.trim()).filter(Boolean), viewports: JSON.parse(viewports) };
          const result = await mutation<ProjectTestSettings>(`${path}/test-config`, "PUT", { expectedVersion: settings?.version ?? 0, config: next });
          setSettings(result); setConfig(result.config); setDirty(false); setEditing(false);
        });
      }}>
        <h3>Project test configuration</h3>
        <p className="vg-muted">Saved only for {project.name}. Keep passwords, cookies, API keys and executable hooks on the runner.</p>
        <label>Production / reference URL<input required type="url" value={config.baseURL.production} placeholder="https://production.example.com"
          onChange={(event) => { setDirty(true); setConfig({ ...config, baseURL: { ...config.baseURL, production: event.target.value } }); }} /></label>
        <label>Staging / candidate URL<input required type="url" value={config.baseURL.staging} placeholder="http://127.0.0.1:3000"
          onChange={(event) => { setDirty(true); setConfig({ ...config, baseURL: { ...config.baseURL, staging: event.target.value } }); }} /></label>
        <label>Routes (one per line)<textarea required rows={3} value={routes} onChange={(event) => { setDirty(true); setRoutes(event.target.value); }} /></label>
        <label>Viewports (JSON)<textarea required rows={5} value={viewports} onChange={(event) => { setDirty(true); setViewports(event.target.value); }} /></label>
        <label>AI provider<select value={config.ai.provider} onChange={(event) => { setDirty(true); setConfig({ ...config, ai: { provider: event.target.value as ProjectTestConfig["ai"]["provider"] } }); }}>
          <option value="none">None</option><option value="gemini">Gemini</option><option value="ollama">Ollama</option>
        </select></label>
        {config.ai.provider !== "none" && <label>AI model (optional)<input value={config.ai.model ?? ""} onChange={(event) => {
          setDirty(true); setConfig({ ...config, ai: { provider: config.ai.provider, ...(event.target.value.trim() ? { model: event.target.value.trim() } : {}) } });
        }} /></label>}
        <button className="vg-button vg-button-primary" disabled={Boolean(pending)}>{pending === "save" ? "Saving…" : "Save test configuration"}</button>
      </form>}
      {canManage && <details className="vg-runner-setup">
        <summary>Connect a runner for this project</summary>
        <p>Keep a runner running on a computer or CI worker that can reach both application URLs and this dashboard. Browser capture happens there, including for hosted dashboards.</p>
        <button className="vg-button" disabled={Boolean(pending)} onClick={() => void act("key", async () => {
          setCredential(await mutation<{ id: string; token: string; expiresAt: string }>(`${path}/test-runner-key`, "POST", { name: `Runner for ${project.name}`.slice(0, 120), days: 30 }));
        })}>Create 30-day runner credential</button>
        {credential && <div>
          <p>Save this credential now; it is shown once and expires {new Date(credential.expiresAt).toLocaleDateString()}. Put it in an ignored <code>.env.visualguard-runner</code> file on the runner:</p>
          <pre className="vg-runner-command">{`VISUALGUARD_RUNNER_TOKEN=${credential.token}`}</pre>
          <button className="vg-button vg-button-danger" disabled={Boolean(pending)} onClick={() => void act("revoke", async () => {
            await mutation(`${path}/tokens/${credential.id}`, "DELETE", {}); setCredential(undefined);
          })}>Revoke this runner credential</button>
        </div>}
        <p>Install VisualGuard, Playwright and Chromium on the runner, then start:</p>
        <pre className="vg-runner-command">{`npx --no-install visualguard dashboard --env-file .env.visualguard-runner runner --project ${project.publicId ?? project.id} --server ${origin}`}</pre>
        <p className="vg-muted">Keep the terminal open. Use Run test when the runner is connected. Revoke older runner credentials under People & integrations → Upload credentials.</p>
      </details>}
    </div>
  );
}
