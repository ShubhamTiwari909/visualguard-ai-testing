import { useEffect, useId, useRef, useState } from "react";
import { mutation } from "./auth";
import type { DeletionResult } from "../shared/contracts";

/** Native modal provides focus containment, Escape support and focus restoration. */
export function DeleteAction({
  kind,
  id,
  name,
  runCount,
  displayId,
  onDeleted,
}: {
  kind: "run" | "project";
  id: string;
  name: string;
  runCount?: number;
  displayId?: string;
  onDeleted: (result: DeletionResult) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    titleId = useId(),
    descriptionId = useId();
  const [open, setOpen] = useState(false),
    [confirmation, setConfirmation] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const [confirmedRunCount, setConfirmedRunCount] = useState(runCount ?? 0);
  const expected = kind === "project" ? displayId ?? id : "DELETE";
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  const close = () => {
    if (!pending) {
      dialog.current?.close();
      setOpen(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="vg-button vg-button-danger"
        aria-label={`Delete ${name}`}
        onClick={() => {
          setConfirmation("");
          setError("");
          setConfirmedRunCount(runCount ?? 0);
          setOpen(true);
        }}
      >
        Delete {kind}
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="vg-delete-dialog"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (pending || confirmation !== expected) return;
              setPending(true);
              setError("");
              void mutation<DeletionResult>(
                `/api/${kind === "project" ? "projects" : "runs"}/${encodeURIComponent(id)}`,
                "DELETE",
                {
                  confirmation: id,
                  ...(kind === "project" ? { expectedRuns: confirmedRunCount } : {}),
                },
              )
                .then((result) => {
                  dialog.current?.close();
                  setOpen(false);
                  onDeleted(result);
                })
                .catch((problem: unknown) =>
                  setError(problem instanceof Error ? problem.message : "Deletion failed"),
                )
                .finally(() => setPending(false));
            }}
          >
            <h2 id={titleId}>Delete {name}?</h2>
            <div id={descriptionId}>
              <p>
                {kind === "project"
                  ? `This permanently deletes this project and all ${confirmedRunCount} stored runs, memberships, upload tokens, and upload sessions.`
                  : "This permanently deletes this run and removes it from project history."}
              </p>
              <p>
                Shared screenshots remain available to other runs. Your original local test output
                is kept. There is no undo.
              </p>
              {kind === "project" && (
                <p>
                  The project ID <strong>{expected}</strong> and its old aliases will stay reserved. Use a new ID for a future
                  project.
                </p>
              )}
            </div>
            <label>
              Type <strong>{expected}</strong> to confirm
              <input
                autoFocus
                autoComplete="off"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={pending}
              />
            </label>
            {error && (
              <p role="alert" className="vg-form-error">
                {error} If the run count changed, cancel, refresh the page, and confirm again.
              </p>
            )}
            <div className="vg-delete-actions">
              <button type="button" className="vg-button" onClick={close} disabled={pending}>
                Cancel
              </button>
              <button
                className="vg-button vg-button-danger"
                disabled={pending || confirmation !== expected}
              >
                {pending ? "Deleting…" : `Permanently delete ${kind}`}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}

export function deletionMessage(kind: "run" | "project", result: DeletionResult) {
  return `${kind === "project" ? "Project" : "Run"} deleted. ${result.runs} run${result.runs === 1 ? "" : "s"} removed.${result.cleanupPending ? " Some artifact cleanup is queued; shared or in-use evidence is preserved." : " Unused artifacts cleaned up; shared evidence preserved."}`;
}
