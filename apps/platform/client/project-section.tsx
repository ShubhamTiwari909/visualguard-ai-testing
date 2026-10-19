import type { Project } from "../shared/contracts";
import { DeleteAction, deletionMessage } from "./delete-action";
import { ProjectTestControls } from "./project-tests";

export function ProjectSection({
  project,
  canManage,
  onDeleted,
  onRunCompleted,
}: {
  project?: Project;
  canManage: boolean;
  onDeleted: (message: string) => void;
  onRunCompleted?: () => void;
}) {
  if (!project) return null;
  return (
    <section className="vg-panel vg-project-section" aria-label="Selected project">
      <div className="vg-panel-heading">
        <div>
          <p className="vg-eyebrow">PROJECT</p>
          <h2>{project.name}</h2>
          <p className="vg-muted">
            {project.publicId ?? project.id} · {project.runCount} stored run
            {project.runCount === 1 ? "" : "s"}
          </p>
        </div>
        {canManage && (
          <DeleteAction
            key={project.id}
            kind="project"
            id={project.id}
            displayId={project.publicId ?? project.id}
            name={project.name}
            runCount={project.runCount}
            onDeleted={(result) => onDeleted(deletionMessage("project", result))}
          />
        )}
      </div>
      <ProjectTestControls key={project.id} project={project} canManage={canManage} onCompleted={onRunCompleted} />
    </section>
  );
}
