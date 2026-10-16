/** Portable, streamed evidence-only backup: no passwords, sessions, membership or upload tokens. */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createGzip, createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { z } from "zod";
import { pipeline } from "node:stream/promises";
import type { PlatformRepository } from "./storage-contracts.js";
import type { ArtifactStore } from "./artifacts.js";
import { sha256 } from "./artifacts.js";
import type { RunDetail } from "../shared/contracts.js";
import {
  canonical,
  MAX_ARTIFACT_BYTES,
  MAX_MANIFEST_BYTES,
  publishRun,
  requiredArtifacts,
} from "./ingest.js";
import { parseManifest, parseMetadata } from "./validation.js";

export async function exportEvidence(
  repository: PlatformRepository,
  store: ArtifactStore,
  file: string,
) {
  const target = resolve(file),
    temporary = `${target}.${process.pid}.partial`;
  try {
    await stat(target);
    throw new Error("Backup output already exists; choose a new filename");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  await mkdir(dirname(target), { recursive: true });
  const gzip = createGzip(),
    output = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
  const piping = pipeline(gzip, output);
  // Attach rejection immediately so a filesystem failure cannot become unhandled while scanning.
  void piping.catch(() => {});
  const write = async (value: unknown) => {
    if (!gzip.write(`${JSON.stringify(value)}\n`)) await once(gzip, "drain");
  };
  const seen = new Set<string>(),
    objects = new Set<string>();
  let runs = 0;
  try {
    await write({
      type: "header",
      format: "visualguard-evidence",
      version: 1,
      createdAt: new Date().toISOString(),
    });
    for (const project of await repository.projects()) {
      await write({
        type: "project",
        id: project.id,
        name: project.name,
        publicId: project.publicId,
        aliases: project.aliases,
      });
      let offset = 0;
      while (true) {
        const page = await repository.runs({ project: project.id, limit: 100, offset });
        if (!page.runs.length) break;
        for (const summary of page.runs) {
          if (seen.has(summary.id)) continue;
          seen.add(summary.id);
          const run = await repository.getRun(summary.id);
          for (const artifact of run.artifacts)
            if (!objects.has(artifact.hash)) {
              const bytes = await store.get(artifact.hash);
              for (
                let position = 0, index = 0;
                position < bytes.length;
                position += 1024 * 1024, index++
              )
                await write({
                  type: "object-chunk",
                  hash: artifact.hash,
                  index,
                  data: bytes.subarray(position, position + 1024 * 1024).toString("base64"),
                });
              await write({ type: "object-end", hash: artifact.hash, size: bytes.length });
              objects.add(artifact.hash);
            }
          await write({ type: "run", run });
          runs++;
        }
        offset += page.runs.length;
      }
    }
    await write({ type: "end", runs, objects: objects.size });
    gzip.end();
    await piping;
    await rename(temporary, target);
    return { file: target, runs, objects: objects.size };
  } catch (error) {
    gzip.destroy();
    output.destroy();
    await piping.catch(() => {});
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function restoreEvidence(
  repository: PlatformRepository,
  store: ArtifactStore,
  file: string,
) {
  const path = resolve(file);
  if ((await stat(path)).size > 2 * 1024 ** 3)
    throw new Error("Portable backup exceeds the 2 GiB import limit");
  const input = createReadStream(path),
    gunzip = createGunzip();
  input.on("error", (error) => gunzip.destroy(error));
  input.pipe(gunzip);
  const lines = createInterface({ input: gunzip, crlfDelay: Infinity });
  let header = false,
    ended = false,
    runs = 0,
    objects = 0,
    decompressed = 0;
  let current: { hash: string; parts: Buffer[]; size: number } | undefined;
  const verified = new Set<string>();
  try {
    for await (const line of lines) {
      decompressed += Buffer.byteLength(line);
      if (decompressed > 4 * 1024 ** 3 || line.length > MAX_MANIFEST_BYTES * 2)
        throw new Error("Portable backup exceeds import limits");
      const item = JSON.parse(line) as Record<string, unknown>;
      if (!header) {
        if (item.type !== "header" || item.format !== "visualguard-evidence" || item.version !== 1)
          throw new Error("Unsupported portable backup format");
        header = true;
        continue;
      }
      if (ended) throw new Error("Unexpected records after backup footer");
      if (item.type === "project") {
        if (typeof item.id !== "string" || typeof item.name !== "string")
          throw new Error("Invalid backup project");
        const { project, created } = await repository.ensureProject(item.id, item.name);
        if (project.id !== item.id)
          throw new Error("Backup project key is reserved by another project's public ID");
        if (item.publicId !== undefined || item.aliases !== undefined) {
          const publicId = z.string().min(1).max(63).parse(item.publicId);
          const aliases = z
            .array(z.string().min(1).max(63))
            .max(1000)
            .parse(item.aliases ?? [publicId]);
          // Existing destination labels win; a restore must not silently rename a live project.
          if (created) {
            let current = project;
            for (const alias of [
              ...new Set(aliases.filter((alias) => alias !== publicId)),
              publicId,
            ]) {
              current = await repository.updateProject(
                project.id,
                item.name,
                alias,
                current.version ?? 0,
              );
            }
          } else if (
            (project.publicId ?? project.id) !== publicId ||
            aliases.some((alias) => !(project.aliases ?? [project.id]).includes(alias))
          ) {
            throw new Error(
              "Backup project aliases differ from the destination; restore into a fresh workspace",
            );
          }
        }
      } else if (item.type === "object-chunk") {
        if (
          typeof item.hash !== "string" ||
          !/^[a-f0-9]{64}$/.test(item.hash) ||
          typeof item.data !== "string" ||
          item.data.length > 1_400_000
        )
          throw new Error("Invalid backup object chunk");
        current ??= { hash: item.hash, parts: [], size: 0 };
        if (current.hash !== item.hash || item.index !== current.parts.length)
          throw new Error("Backup object chunks are out of order");
        const bytes = Buffer.from(item.data, "base64");
        current.size += bytes.length;
        if (current.size > MAX_ARTIFACT_BYTES)
          throw new Error("Backup artifact exceeds size limit");
        current.parts.push(bytes);
      } else if (item.type === "object-end") {
        if (!current || current.hash !== item.hash || current.size !== item.size)
          throw new Error("Backup object is incomplete");
        const bytes = Buffer.concat(current.parts);
        if (sha256(bytes) !== current.hash) throw new Error("Backup artifact checksum mismatch");
        await store.put(bytes);
        verified.add(current.hash);
        current = undefined;
        objects++;
      } else if (item.type === "run") {
        const run = item.run as RunDetail;
        if (
          !run ||
          run.envelopeVersion !== 1 ||
          !/^[a-f0-9-]{36}$/.test(run.id) ||
          typeof run.projectId !== "string" ||
          !Array.isArray(run.artifacts) ||
          !run.artifacts.every((artifact) => verified.has(artifact.hash))
        )
          throw new Error("Invalid or incomplete backup run");
        const restoredMetadata = { ...run.metadata };
        for (const key of ["branch", "commit", "pullRequest", "deployment"] as const)
          if (restoredMetadata[key] === null) delete restoredMetadata[key];
        const manifest = parseManifest(run.manifest),
          metadata = parseMetadata(restoredMetadata);
        if (
          requiredArtifacts(manifest).length !== run.artifacts.length ||
          sha256(
            canonical({ envelopeVersion: 1, manifest, metadata, artifacts: run.artifacts }),
          ) !== run.digest
        )
          throw new Error("Backup run digest mismatch");
        // Validate using the normal publisher in a capture-only repository, then preserve the URL ID.
        let validated: Omit<RunDetail, "id"> | undefined;
        const capture: PlatformRepository = {
          ...repository,
          isDeletedProject: repository.isDeletedProject.bind(repository),
          ensureProject: repository.ensureProject.bind(repository),
          createProject: repository.createProject.bind(repository),
          projects: repository.projects.bind(repository),
          resolveProjectId: repository.resolveProjectId.bind(repository),
          updateProject: repository.updateProject.bind(repository),
          getRun: repository.getRun.bind(repository),
          renameRun: repository.renameRun.bind(repository),
          runs: repository.runs.bind(repository),
          deleteRun: repository.deleteRun.bind(repository),
          deleteProject: repository.deleteProject.bind(repository),
          async insertRun(value) {
            validated = value;
            return { run: { ...value, id: run.id }, duplicate: false };
          },
        };
        await publishRun(capture, store, {
          projectId: run.projectId,
          manifest,
          metadata,
          artifacts: run.artifacts,
        });
        const name =
          run.name === undefined ? undefined : z.string().trim().min(1).max(120).parse(run.name);
        const nameVersion =
          run.nameVersion === undefined
            ? undefined
            : z.number().int().nonnegative().parse(run.nameVersion);
        await repository.insertRun(
          { ...validated!, importedAt: run.importedAt, name, nameVersion },
          run.id,
        );
        runs++;
      } else if (item.type === "end") {
        if (current || item.runs !== runs || item.objects !== objects)
          throw new Error("Backup footer count mismatch");
        ended = true;
      } else throw new Error("Unknown backup record");
    }
    if (!header || !ended || current) throw new Error("Portable backup is truncated");
    return { runs, objects };
  } finally {
    lines.close();
    input.destroy();
    gunzip.destroy();
  }
}
