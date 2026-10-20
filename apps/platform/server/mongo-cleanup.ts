import { MongoBulkWriteError, type Db } from "mongodb";
import type { DeletionResult } from "../shared/contracts.js";

interface MongoObject {
  hash: string;
  generation?: string;
  runRefs?: string[];
}

// Keep one of the five pooled connections available for ordinary dashboard requests.
async function cleanupBatch<T>(items: T[], work: (item: T) => Promise<void>) {
  let next = 0;
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!);
    }),
  );
  // Wait for every worker before returning, including after an error. Never leave cleanup
  // running after the deletion guard reopens or a serverless request ends.
  for (const result of results) if (result.status === "rejected") throw result.reason;
}

export async function queueMongoArtifactCleanup(db: Db, hashes: Iterable<string>) {
  const unique = [...new Set(hashes)];
  if (!unique.length) return;
  try {
    await db.collection("vg_state").bulkWrite(
      unique.map((hash) => ({
        updateOne: {
          filter: { namespace: "artifact-cleanup", id: hash },
          update: {
            $setOnInsert: {
              namespace: "artifact-cleanup",
              id: hash,
              value: { hash },
              expiresAt: null,
            },
            $inc: { version: 1 },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  } catch (error) {
    // A concurrent queue writer can win an upsert. Do not hide any other partial failure:
    // queue persistence must finish before the run itself is removed.
    if (!(error instanceof MongoBulkWriteError)) throw error;
    const errors = error.result.getWriteErrors();
    if (
      !errors.length ||
      !errors.every((item) => item.code === 11000) ||
      error.result.getWriteConcernError()
    )
      throw error;
  }
}

export async function cleanupMongoArtifacts(db: Db, runs: number): Promise<DeletionResult> {
  let artifactsDeleted = 0,
    cleanupPending = false;
  try {
    const candidates = await db
      .collection("vg_state")
      .find({ namespace: "artifact-cleanup" })
      .limit(1000)
      .toArray();
    await cleanupBatch(candidates, async (candidate) => {
      const hash = candidate.id as string;
      // Older runs predate per-object pins; keep their objects too.
      if (
        await db
          .collection("vg_runs")
          .findOne({ "artifacts.hash": hash }, { projection: { _id: 1 } })
      ) {
        await db
          .collection("vg_state")
          .deleteOne({ _id: candidate._id, version: candidate.version });
        return;
      }
      if (
        await db.collection("vg_state").findOne(
          {
            namespace: "upload-files",
            "value.hash": hash,
            $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date().toISOString() } }],
          },
          { projection: { _id: 1 } },
        )
      ) {
        cleanupPending = true;
        return;
      }
      const current = await db
        .collection<MongoObject>("vg_objects")
        .findOne({ hash }, { projection: { hash: 1, generation: 1 } });
      if (current) {
        const id = `${hash}:${current.generation ?? "legacy"}`;
        try {
          await db.collection("vg_state").updateOne(
            { namespace: "artifact-generations", id },
            {
              $setOnInsert: {
                namespace: "artifact-generations",
                id,
                value: { hash, generation: current.generation ?? null },
                version: 1,
                expiresAt: null,
              },
            },
            { upsert: true },
          );
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
            throw error;
        }
      }
      const object =
        current &&
        (await db.collection<MongoObject>("vg_objects").findOneAndDelete({
          hash,
          generation: current.generation ?? { $exists: false },
          $or: [{ runRefs: { $exists: false } }, { runRefs: { $size: 0 } }],
        }));
      if (object) {
        // Generation-scoped chunks allow a concurrent re-upload to create a new copy safely.
        await db
          .collection("vg_object_chunks")
          .deleteMany({ hash, generation: object.generation ?? { $exists: false } });
        artifactsDeleted++;
        await db.collection("vg_state").deleteOne({
          namespace: "artifact-generations",
          id: `${hash}:${object.generation ?? "legacy"}`,
        });
      } else if (
        await db.collection<MongoObject>("vg_objects").findOne({ hash }, { projection: { _id: 1 } })
      ) {
        cleanupPending = true;
        return;
      }
      await db.collection("vg_state").deleteOne({ _id: candidate._id, version: candidate.version });
    });
    // Persist chunk cleanup separately before removing object metadata, so an interrupted
    // deletion can safely finish later without touching a newer upload of the same hash.
    const generations = await db
      .collection("vg_state")
      .find({ namespace: "artifact-generations" })
      .limit(1000)
      .toArray();
    await cleanupBatch(generations, async (task) => {
      const { hash, generation } = task.value;
      const current = await db
        .collection<MongoObject>("vg_objects")
        .findOne({ hash }, { projection: { hash: 1, generation: 1 } });
      if (current && (current.generation ?? null) === generation) {
        cleanupPending = true;
        return;
      }
      await db
        .collection("vg_object_chunks")
        .deleteMany({ hash, generation: generation ?? { $exists: false } });
      await db.collection("vg_state").deleteOne({ _id: task._id });
    });
    if (
      await db
        .collection("vg_state")
        .findOne({ namespace: { $in: ["artifact-cleanup", "artifact-generations"] } })
    )
      cleanupPending = true;
  } catch (error) {
    console.error("Evidence deletion completed; artifact cleanup remains queued", error);
    cleanupPending = true;
  }
  return { runs, artifactsDeleted, cleanupPending };
}
