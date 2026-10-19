import { z } from "zod";
import type { Actor, AuthService } from "./auth.js";
import { PlatformError } from "./errors.js";
import type { PlatformRepository, StateStore } from "./storage-contracts.js";
import type { ProjectTestConfig, ProjectTestSettings } from "../shared/project-tests.js";

const baseURL = z.string().max(2048).refine((value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}, "Use an HTTP(S) URL without credentials, query or fragment");
export const projectTestConfig = z.object({
  baseURL: z.object({ production: baseURL, staging: baseURL }).strict(),
  routes: z.array(z.string().max(1000).refine((value) =>
    value.startsWith("/") && !value.startsWith("//") && !/[\\\r\n\u0000]/.test(value),
  "Use a relative route starting with one slash")).min(1).max(100),
  viewports: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/), z.object({
    width: z.number().int().min(200).max(3840),
    height: z.number().int().min(200).max(2160),
  }).strict()).refine((value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 8,
    "Choose between one and eight viewports"),
  ai: z.object({
    provider: z.enum(["none", "gemini", "ollama"]),
    model: z.string().trim().min(1).max(120).optional(),
  }).strict(),
}).strict();
export const projectTestUpdate = z.object({
  expectedVersion: z.number().int().nonnegative(),
  config: projectTestConfig,
}).strict();

export class ProjectTests {
  constructor(
    readonly repository: PlatformRepository,
    readonly state: StateStore,
    readonly auth: AuthService,
  ) {}
  async access(actor: Actor, project: string, write = false) {
    await this.auth.requireRole(actor, project, write ? "maintainer" : "viewer");
    if (!(await this.repository.projects([project])).length || await this.repository.isDeletedProject(project))
      throw new PlatformError(404, "Project not found");
  }
  async read(actor: Actor, project: string): Promise<ProjectTestSettings | null> {
    await this.access(actor, project);
    const row = await this.state.get<ProjectTestConfig>("project-test-configs", project);
    return row ? { config: row.value, version: row.version } : null;
  }
  async save(actor: Actor, project: string, input: unknown): Promise<ProjectTestSettings> {
    const update = projectTestUpdate.parse(input);
    await this.access(actor, project, true);
    const current = await this.state.get<ProjectTestConfig>("project-test-configs", project);
    const saved = current
      ? current.version === update.expectedVersion && await this.state.replace("project-test-configs", { ...current, value: update.config })
      : update.expectedVersion === 0 && await this.state.create("project-test-configs", project, update.config);
    if (!saved) throw new PlatformError(409, "Project configuration changed; refresh before saving");
    await this.auth.audit(actor, "project-test-config.saved", { projectId: project, configVersion: update.expectedVersion + 1 });
    return { config: update.config, version: update.expectedVersion + 1 };
  }
}
