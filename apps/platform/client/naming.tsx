import { useState, type FormEvent } from "react";
import type { RunDetail } from "../shared/contracts";
import { mutation } from "./auth";

export function RunNameEditor({ run, onSaved }: { run: RunDetail; onSaved: (run: RunDetail) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(run.name ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(""); setNotice("");
    try {
      const next = await mutation<{ name: string | null; nameVersion: number }>(`/api/runs/${run.id}`, "PATCH", {
        name, expectedVersion: run.nameVersion ?? 0,
      });
      onSaved({ ...run, name: next.name ?? undefined, nameVersion: next.nameVersion });
      setNotice("Run name saved."); setOpen(false);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Unable to rename run");
    } finally { setPending(false); }
  };
  return <div className="vg-name-editor">
    <button type="button" className="vg-button" aria-expanded={open} disabled={pending} onClick={() => {
      setName(run.name ?? ""); setError(""); setNotice(""); setOpen(!open);
    }}>{open ? "Cancel rename" : "Edit run name"}</button>
    {notice && <p role="status">{notice}</p>}
    {open && <form onSubmit={(event) => void save(event)}>
      <label>Run name<input value={name} maxLength={120} disabled={pending} onChange={(event) => setName(event.target.value)} placeholder={`Run #${run.number}`} /></label>
      <p className="vg-muted vg-small">Leave empty to restore Run #{run.number}. Evidence and the run number stay the same.</p>
      {error && <p className="vg-form-error" role="alert">{error} Refresh this page if someone else changed the name.</p>}
      <button className="vg-button vg-button-primary" disabled={pending}>{pending ? "Saving…" : "Save run name"}</button>
    </form>}
  </div>;
}
