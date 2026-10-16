import { useState, type FormEvent } from "react";
import type { Project, RunDetail } from "../shared/contracts";
import { mutation } from "./auth";

export function RunNameEditor({
  run,
  onSaved,
}: {
  run: RunDetail;
  onSaved: (run: RunDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(run.name ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const next = await mutation<{ name: string | null; nameVersion: number }>(
        `/api/runs/${run.id}`,
        "PATCH",
        {
          name,
          expectedVersion: run.nameVersion ?? 0,
        },
      );
      onSaved({ ...run, name: next.name ?? undefined, nameVersion: next.nameVersion });
      setNotice("Run name saved.");
      setOpen(false);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Unable to rename run");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="vg-name-editor">
      <button
        type="button"
        className="vg-button"
        aria-expanded={open}
        disabled={pending}
        onClick={() => {
          setName(run.name ?? "");
          setError("");
          setNotice("");
          setOpen(!open);
        }}
      >
        {open ? "Cancel rename" : "Edit run name"}
      </button>
      {notice && <p role="status">{notice}</p>}
      {open && (
        <form onSubmit={(event) => void save(event)}>
          <label>
            Run name
            <input
              value={name}
              maxLength={120}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
              placeholder={`Run #${run.number}`}
            />
          </label>
          <p className="vg-muted vg-small">
            Leave empty to restore Run #{run.number}. Evidence and the run number stay the same.
          </p>
          {error && (
            <p className="vg-form-error" role="alert">
              {error} Refresh this page if someone else changed the name.
            </p>
          )}
          <button className="vg-button vg-button-primary" disabled={pending}>
            {pending ? "Saving…" : "Save run name"}
          </button>
        </form>
      )}
    </div>
  );
}

export function ProjectNameEditor({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [publicId, setPublicId] = useState(project.publicId ?? project.id);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await mutation<Project>(`/api/projects/${project.id}`, "PATCH", {
        name,
        publicId,
        expectedVersion: project.version ?? 0,
      });
      setOpen(false);
      onSaved();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Unable to save project details");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="vg-name-editor">
      <p>
        <strong>Project ID:</strong> <code>{project.publicId ?? project.id}</code>
      </p>
      <button
        type="button"
        className="vg-button"
        aria-expanded={open}
        disabled={pending}
        onClick={() => {
          setName(project.name);
          setPublicId(project.publicId ?? project.id);
          setError("");
          setOpen(!open);
        }}
      >
        {open ? "Cancel edit" : "Edit project name & ID"}
      </button>
      {open && (
        <form onSubmit={(event) => void save(event)}>
          <label>
            Project name
            <input
              value={name}
              required
              maxLength={120}
              disabled={pending}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Project ID
            <input
              value={publicId}
              required
              pattern="[a-z0-9][a-z0-9-]{0,62}"
              maxLength={63}
              disabled={pending}
              onChange={(event) => setPublicId(event.target.value)}
            />
          </label>
          <p className="vg-muted vg-small">
            Lowercase letters, numbers, and hyphens. Old IDs keep working; existing runs, links, and
            upload tokens stay connected.
          </p>
          {error && (
            <p className="vg-form-error" role="alert">
              {error} Refresh this page if the project was changed elsewhere.
            </p>
          )}
          <button className="vg-button vg-button-primary" disabled={pending}>
            {pending ? "Saving…" : "Save project details"}
          </button>
        </form>
      )}
    </div>
  );
}
