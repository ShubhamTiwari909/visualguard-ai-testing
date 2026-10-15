import type { Project } from "../shared/contracts.js";
import { PlatformError } from "./errors.js";

export function projectSelector(value: string): string {
  const selector = value.trim();
  if (!selector || selector.length > 120) throw new PlatformError(400, "Use a project ID or an exact project name of 1–120 characters");
  return selector;
}

/** Stable IDs win; duplicate display names must never silently select a project. */
export function findProject(projects: Project[], selector: string): Project | undefined {
  const exactId = projects.find((project) => project.id === selector);
  if (exactId) return exactId;
  const names = projects.filter((project) => project.name === selector);
  if (names.length > 1) throw new PlatformError(409, "More than one project has that name; use the project ID instead");
  return names[0];
}
