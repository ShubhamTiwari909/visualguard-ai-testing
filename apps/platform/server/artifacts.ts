/** Private content-addressed object storage. Only indexed run artifacts are served by HTTP. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

export interface ArtifactStore {
  put(data: Uint8Array): Promise<string>;
  get(hash: string): Promise<Buffer>;
}

export class FileArtifactStore implements ArtifactStore {
  constructor(private root: string) {}

  private path(hash: string): string {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid artifact digest");
    return join(this.root, hash.slice(0, 2), hash);
  }

  async put(data: Uint8Array): Promise<string> {
    const hash = sha256(data);
    const path = this.path(hash);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await mkdir(join(this.root, hash.slice(0, 2)), { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
      // Identical hashes have identical content; concurrent writes cannot change evidence.
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return hash;
  }

  async get(hash: string): Promise<Buffer> {
    const data = await readFile(this.path(hash));
    if (sha256(data) !== hash) throw new Error("Stored artifact checksum mismatch");
    return data;
  }
}
