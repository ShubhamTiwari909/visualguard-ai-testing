export interface ProjectTestConfig {
  baseURL: { production: string; staging: string };
  routes: string[];
  viewports: Record<string, { width: number; height: number }>;
  ai: { provider: "none" | "gemini" | "ollama"; model?: string };
}
export interface ProjectTestSettings {
  version: number;
  config: ProjectTestConfig;
}
export interface ProjectTestExecution {
  id: string;
  configVersion: number;
  status: "queued" | "running" | "completed" | "failed";
  requestedAt: string;
  startedAt?: string;
  finishedAt?: string;
  runId?: string;
  error?: string;
}
export interface ClaimedProjectTest extends ProjectTestExecution {
  projectId: string;
  config: ProjectTestConfig;
  lease: string;
}
