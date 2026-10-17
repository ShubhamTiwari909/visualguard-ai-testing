import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createRun } from "../src/core/run.js";
import { testConfig } from "./helpers/config.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";
import { openPlatform } from "../../../apps/platform/server/config.js";
import { importRun } from "../../../apps/platform/server/ingest.js";
import { AuthService } from "../../../apps/platform/server/auth.js";
import { Reviews } from "../../../apps/platform/server/reviews.js";
import { Baselines } from "../../../apps/platform/server/baselines.js";
import { pullApprovedBaseline } from "../../../apps/platform/server/baseline-command.js";
import { approvedBaselineReference, assertApprovedBaselinePresent, assertBaselineWritable, assertBaselineCompatible } from "../src/core/provenance.js";

const owner = { id: "local-owner", name: "Local workspace", email: "", admin: true, csrf: "" };
describe("approved references consumed by the offline engine", () => {
  let site: FixtureServer;
  const folders: string[] = [];
  beforeAll(async () => { site = await startFixtureServer("production"); });
  afterAll(async () => { await site?.close(); for (const folder of folders) await rm(folder, { recursive: true, force: true }); });
  it("preserves explicit migration of ordinary local baseline metadata", () => {
    const config = testConfig({ routes: ["/identical"] }); folders.push(config.cwd);
    const path = join(config.cwd, "ordinary.png");
    writeFileSync(path.replace(/\.png$/, ".meta.json"), "invalid legacy metadata");
    expect(() => assertBaselineWritable(path)).not.toThrow();
    writeFileSync(join(config.cwd, "approved-baseline.json"), "{}");
    expect(() => assertBaselineWritable(path)).toThrow("cannot be updated");
  });
  it("captures, reviews, promotes, pulls, compares offline, records selection, and refuses tampering/updates", async () => {
    const config = testConfig({ routes: ["/identical"] }, { production: site.url, staging: site.url });
    folders.push(config.cwd);
    const evidence = await createRun(config).start();
    expect(evidence.manifest.jobs[0]!.renderingIdentity).toBeDefined();
    const env = { VISUALGUARD_PLATFORM_DATA_DIR: join(config.cwd, "platform") };
    const platform = await openPlatform(env);
    let id: string;
    try {
      await platform.repository.createProject("demo", "Demo");
      const imported = await importRun(platform.repository, platform.store, { projectId: "demo", runDir: evidence.runDir, metadata: { environment: "staging", commit: "a".repeat(40) } });
      id = imported.run.id;
      const auth = new AuthService(platform.state, { VISUALGUARD_AUTH_MODE: "local" });
      await auth.ready;
      const reviews = new Reviews(platform.repository, platform.state, auth);
      const view = await reviews.read(owner, id, evidence.manifest.jobs[0]!.id);
      await reviews.append(owner, id, { jobId: view.jobId, evidenceDigest: view.evidenceDigest, scopeDigest: view.scopeDigest, expectedVersion: view.version, event: { action: "approve_visual_change", reason: "Reviewed reference" } });
      await new Baselines(platform.repository, platform.state, auth).promote(owner, "demo", "main", { expectedVersion: 0, runId: id, evidenceDigest: imported.run.digest, sourceRevision: "a".repeat(40), targetRevision: "a".repeat(40), landed: true, reason: "Source landed" });
    } finally { await platform.close(); }
    const out = join(config.cwd, "approved-v1");
    await pullApprovedBaseline({ project: "demo", set: "main", out, env });
    // The engine consumes the downloaded evidence after the platform is closed.
    const comparison = await createRun(config, { mode: "baseline", baselineDir: out }).start();
    const job = comparison.manifest.jobs[0]!;
    expect(job.status).toBe("pass");
    expect(job.captures.production).toMatchObject({ source: "baseline", approvedReference: { projectId: "demo", set: "main", version: 1, runId: id! } });
    const path = join(out, `${job.id}.png`);
    expect(() => assertBaselineWritable(path)).toThrow("cannot be updated");
    expect(() => assertApprovedBaselinePresent(join(out, "new-check.png"))).toThrow("missing");
    expect(() => assertBaselineCompatible(path, { changed: "viewport" }, "error")).toThrow("rendering settings");
    expect(() => approvedBaselineReference(path, { jobId: "another", route: job.route, viewport: job.viewport, identity: job.renderingIdentity })).toThrow("check identity");
    const metadataPath = path.replace(/\.png$/, ".meta.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    writeFileSync(metadataPath, JSON.stringify({ ...metadata, approvedReference: { ...metadata.approvedReference, version: 999 } }));
    expect(() => approvedBaselineReference(path)).toThrow("pinned receipt");
    writeFileSync(metadataPath, JSON.stringify(metadata));
    const before = readFileSync(path);
    await expect(createRun(config, { mode: "baseline", baselineDir: out, updateBaselines: true }).start()).rejects.toThrow("cannot be updated");
    expect(readFileSync(path)).toEqual(before);
    writeFileSync(path.replace(/\.png$/, ".health.json"), "{}");
    expect(() => approvedBaselineReference(path)).toThrow("checksum mismatch");
  }, 120000);
});
