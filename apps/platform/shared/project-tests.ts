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
