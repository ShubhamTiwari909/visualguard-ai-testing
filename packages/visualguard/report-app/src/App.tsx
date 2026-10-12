/**
 * @file Report shell: search/status filtering, selected job, navigation/hash state, themes,
 * incomplete banner and usage summary.
 *
 * This module runs in the report viewer's browser. React components return JSX (the markup-like
 * syntax); state changes request a new render, while effects synchronize browser APIs and clean
 * up listeners.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COMPARE_MODES, type CompareMode } from "./Compare";
import {
  formatDuration,
  jobSummary,
  readHash,
  sortJobs,
  STATUS_LABEL,
  STATUS_ORDER,
  writeHash,
  type ReportData,
  type Status,
} from "./data";
import { JobActions } from "./actions";
import { JobDetail } from "./JobDetail";
import { Kbd, StatusIcon } from "./ui";

type Theme = "light" | "dark";

/**
 * Choose the first theme from saved browser preferences, then fall back to the operating
 * system. Storage access can throw, so a missing preference must not prevent the report from
 * opening.
 */
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("visualguard-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage can be unavailable on file:// or in private windows.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Check whether a URL value is one of the comparison views the UI supports. The TypeScript type
 * predicate also tells callers that a successful check makes this string a CompareMode.
 */
const isCompareMode = (value: string | undefined): value is CompareMode =>
  COMPARE_MODES.some((mode) => mode.value === value);

/**
 * Render the report shell and own the selected job, filters, theme and comparison view. React
 * state triggers a new render when it changes; effects keep browser storage, the URL and
 * keyboard listeners in sync with that state.
 */
export function App({ data }: { data: ReportData }) {
  const { manifest } = data;
  const jobs = useMemo(() => sortJobs(manifest.jobs), [manifest.jobs]);
  const initial = readHash();

  const [selectedId, setSelectedId] = useState<string | undefined>(
    jobs.find((job) => job.id === initial.jobId)?.id ?? jobs[0]?.id,
  );
  const [mode, setMode] = useState<CompareMode>(
    isCompareMode(initial.view) ? initial.view : "side",
  );
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<Status>>(new Set());
  const [showRegions, setShowRegions] = useState(true);
  const [actualSize, setActualSize] = useState(false);
  const [focusedRegion, setFocusedRegion] = useState<number>();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("visualguard-theme", theme);
    } catch {
      // ignore
    }
  }, [theme]);

  /**
   * Derive the displayed jobs from search/status filters. useMemo reuses this array until a
   * listed dependency changes; it is derived data rather than independent state.
   */
  const visibleJobs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return jobs.filter(
      (job) =>
        (statusFilter.size === 0 || statusFilter.has(job.status)) &&
        (!needle || `${job.route} ${job.viewport} ${job.name}`.toLowerCase().includes(needle)),
    );
  }, [jobs, query, statusFilter]);

  const selected = jobs.find((job) => job.id === selectedId);

  useEffect(() => {
    writeHash({ jobId: selectedId, view: mode === "side" ? undefined : mode });
    document.title = selected
      ? `${selected.route} · ${selected.viewport} · VisualGuard #${manifest.number}`
      : "VisualGuard report";
  }, [selectedId, mode, selected, manifest.number]);

  useEffect(() => {
    /**
     * Read a changed URL fragment and restore a valid job selection and comparison view. This
     * event handler lets browser back/forward navigation work without loading a new page.
     */
    const onHash = () => {
      const state = readHash();
      if (state.jobId && jobs.some((job) => job.id === state.jobId)) setSelectedId(state.jobId);
      if (isCompareMode(state.view)) setMode(state.view);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [jobs]);

  /**
   * Select a job and reset region/scroll state. useCallback keeps the function reference stable
   * between renders while its dependencies remain unchanged.
   */
  const select = useCallback((id: string) => {
    setSelectedId(id);
    setFocusedRegion(undefined);
    document.getElementById("main")?.scrollTo({ top: 0 });
  }, []);

  /**
   * Move through the currently filtered list, clamping to its first/last item. The dependency
   * list refreshes the callback when its selection or visible jobs change.
   */
  const move = useCallback(
    (step: number) => {
      if (visibleJobs.length === 0) return;
      const index = visibleJobs.findIndex((job) => job.id === selectedId);
      const next = visibleJobs[Math.min(visibleJobs.length - 1, Math.max(0, index + step))]!;
      select(next.id);
      listRef.current
        ?.querySelector<HTMLElement>(`[data-job-id="${CSS.escape(next.id)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    },
    [visibleJobs, selectedId, select],
  );

  /**
   * Enable the overlay and focus a region on the next animation frame. Clearing its ID first
   * lets repeated selections restart the highlight animation.
   */
  const focusRegion = useCallback((id: number) => {
    setShowRegions(true);
    setFocusedRegion(undefined);
    requestAnimationFrame(() => {
      setFocusedRegion(id);
      document
        .getElementById(`region-box-${id}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    /**
     * Translate keyboard shortcuts into navigation and view changes. Ignore modified shortcuts
     * and ordinary typing in form fields so the report does not steal browser or text-input
     * behavior.
     */
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) &&
        target.getAttribute("type") !== "checkbox"
      ) {
        if (event.key === "Escape") (target as HTMLInputElement).blur();
        return;
      }
      const modeIndex = ["1", "2", "3", "4"].indexOf(event.key);
      if (event.key === "j" || event.key === "ArrowDown") move(1);
      else if (event.key === "k" || event.key === "ArrowUp") move(-1);
      else if (modeIndex >= 0) setMode(COMPARE_MODES[modeIndex]!.value);
      else if (event.key === "r") setShowRegions((value) => !value);
      else if (event.key === "z") setActualSize((value) => !value);
      else if (event.key === "/") searchRef.current?.focus();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move]);

  /**
   * Add or remove one status from the active filter. Copy the Set before changing it: React
   * needs a new object to notice the state update.
   */
  const toggleStatus = (status: Status) =>
    setStatusFilter((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });

  const started = new Date(manifest.startedAt);
  const urls = manifest.config.baseURL;

  return (
    <div className="flex h-full flex-col">
      {manifest.incomplete && (
        <div role="alert" className="bg-amber-100 p-3 text-amber-950">
          Incomplete run: shards or expected jobs are missing. This report cannot establish a
          passing result.
        </div>
      )}
      <header className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              className="size-6 text-sky-600 dark:text-sky-400"
              aria-hidden
              fill="currentColor"
            >
              <path d="M12 2 3 6v6c0 5 3.8 9.7 9 10 5.2-.3 9-5 9-10V6l-9-4Zm-1.2 14.2-3.6-3.6 1.4-1.4 2.2 2.2 5-5 1.4 1.4-6.4 6.4Z" />
            </svg>
            <h1 className="text-base font-semibold">
              VisualGuard{" "}
              <span className="font-normal text-slate-500 dark:text-slate-400">
                · Run #{manifest.number}
              </span>
            </h1>
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
            {urls.production && (
              <div className="flex gap-1">
                <dt className="text-slate-500 dark:text-slate-400">Production</dt>
                <dd className="font-mono">{urls.production}</dd>
              </div>
            )}
            {urls.staging && (
              <div className="flex gap-1">
                <dt className="text-slate-500 dark:text-slate-400">
                  {manifest.mode === "compare" ? "Staging" : "Site"}
                </dt>
                <dd className="font-mono">{urls.staging}</dd>
              </div>
            )}
            <div className="flex gap-1">
              <dt className="text-slate-500 dark:text-slate-400">Started</dt>
              <dd>
                <time dateTime={manifest.startedAt}>{started.toLocaleString()}</time> ·{" "}
                {formatDuration(manifest.durationMs)}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-slate-500 dark:text-slate-400">AI</dt>
              <dd>
                {manifest.config.ai.provider === "none"
                  ? "off"
                  : `${manifest.config.ai.provider} ${manifest.config.ai.model ?? ""}`}
              </dd>
            </div>
            {manifest.usage && (
              <div className="text-xs text-slate-500">
                <dt>AI work</dt>
                <dd>
                  {manifest.usage.aiCalls} analyses · {manifest.usage.generationAttempts ?? "?"}{" "}
                  generations · {manifest.usage.networkAttempts ?? "?"} requests ·{" "}
                  {manifest.usage.inputTokens} input / {manifest.usage.outputTokens} output tokens
                </dd>
              </div>
            )}
          </dl>
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
        </div>
        <div role="group" aria-label="Filter by status" className="mt-3 flex flex-wrap gap-2">
          {STATUS_ORDER.map((status) => {
            const count = manifest.summary[status];
            const active = statusFilter.has(status);
            return (
              <button
                key={status}
                type="button"
                aria-pressed={active}
                disabled={count === 0}
                onClick={() => toggleStatus(status)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                  active
                    ? "border-sky-600 bg-sky-50 text-sky-900 dark:border-sky-400 dark:bg-sky-950 dark:text-sky-100"
                    : "border-slate-200 text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:text-slate-200"
                }`}
              >
                <StatusIcon status={status} className="size-3.5" />
                <span className="tabular-nums">{count}</span> {STATUS_LABEL[status].toLowerCase()}
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label="Jobs"
          className="flex max-h-72 shrink-0 flex-col border-b border-slate-200 md:max-h-none md:w-80 md:border-r md:border-b-0 dark:border-slate-800"
        >
          <div className="p-3">
            <label htmlFor="search" className="sr-only">
              Search routes
            </label>
            <input
              id="search"
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search routes  /"
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm placeholder:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:placeholder:text-slate-400"
            />
          </div>
          <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {visibleJobs.map((job) => {
              const active = job.id === selectedId;
              return (
                <li key={job.id}>
                  <button
                    type="button"
                    data-job-id={job.id}
                    aria-current={active ? "true" : undefined}
                    onClick={() => select(job.id)}
                    className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left ${
                      active
                        ? "bg-sky-100 dark:bg-sky-900/60"
                        : "hover:bg-slate-100 dark:hover:bg-slate-800/70"
                    }`}
                  >
                    <StatusIcon status={job.status} className="mt-0.5 size-4" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate font-mono text-sm">{job.route}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-slate-600 dark:text-slate-300">
                          {job.viewport}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-slate-600 dark:text-slate-300">
                        {jobSummary(job) || STATUS_LABEL[job.status]}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {visibleJobs.length === 0 && (
              <li className="px-2 py-4 text-sm text-slate-500">No jobs match.</li>
            )}
          </ul>
          <p className="hidden border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500 md:block dark:border-slate-800 dark:text-slate-400">
            <Kbd>j</Kbd>/<Kbd>k</Kbd> next/previous · <Kbd>1</Kbd>–<Kbd>4</Kbd> views · <Kbd>/</Kbd>{" "}
            search
          </p>
        </nav>

        <main id="main" className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          {selected ? (
            <JobDetail
              key={selected.id}
              job={selected}
              manifest={manifest}
              mode={mode}
              onModeChange={setMode}
              showRegions={showRegions}
              onToggleRegions={() => setShowRegions((value) => !value)}
              actualSize={actualSize}
              onToggleSize={() => setActualSize((value) => !value)}
              focusedRegion={focusedRegion}
              onFocusRegion={focusRegion}
              actions={<JobActions job={selected} />}
            />
          ) : (
            <p className="text-sm text-slate-500">This run has no jobs.</p>
          )}
        </main>
      </div>
    </div>
  );
}
