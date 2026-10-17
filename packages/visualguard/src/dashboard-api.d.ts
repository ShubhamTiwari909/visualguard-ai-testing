import type { IncomingMessage, ServerResponse } from "node:http";

export interface DashboardOptions {
  env?: Record<string, string | undefined>;
  dataDir?: string;
}
export interface DashboardMetadata {
  runName?: string;
  environment: string;
  branch?: string;
  commit?: string;
  pullRequest?: number;
  deployment?: string;
}
export interface DashboardProject {
  id: string;
  publicId?: string;
  aliases?: string[];
  version?: number;
  name: string;
  createdAt: string;
  runCount: number;
  role?: "viewer" | "reviewer" | "maintainer";
}
export function createDashboardProject(options: {
  id: string;
  name?: string;
  server?: string;
  env?: Record<string, string | undefined>;
}): Promise<{ project: DashboardProject; created: boolean }>;
export function createDashboardHandler(options?: DashboardOptions): Promise<{
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  close(): Promise<void>;
}>;
export function startDashboard(
  options?: DashboardOptions & { port?: number; host?: string; assetDir?: string },
): Promise<{ url: string; port: number; close(): Promise<void> }>;
export function copyDashboardAssets(out: string): Promise<string>;
export function publishDashboardRun(options: {
  server: string;
  project: string;
  runDir: string;
  token?: string;
  metadata: DashboardMetadata;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<{ id: string; status: string; duplicate: boolean; url: string }>;
export function importDashboardRun(options: {
  project: string;
  name?: string;
  runDir: string;
  metadata: DashboardMetadata;
  env?: Record<string, string | undefined>;
}): Promise<{ run: { id: string; status: string }; duplicate: boolean }>;
export function exportDashboard(
  file: string,
  env?: Record<string, string | undefined>,
): Promise<{ file: string; runs: number; objects: number }>;
export function restoreDashboard(
  file: string,
  env?: Record<string, string | undefined>,
): Promise<{ runs: number; objects: number }>;
export function scaffoldDashboard(options: {
  target: "vercel" | "cloud-run";
  out: string;
  version: string;
  packageFile?: string;
}): Promise<string>;

export function pullApprovedBaseline(options: {
  project: string;
  set: string;
  out: string;
  version?: number;
  server?: string;
  env?: Record<string, string | undefined>;
}): Promise<{ directory: string; projectId: string; set: string; version: number; checks: number }>;
