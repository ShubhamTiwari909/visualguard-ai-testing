/**
 * Optional external object storage for evidence bytes (screenshots, diffs, DOM snapshots).
 *
 * The database always keeps the object index (hash, size). When
 * VISUALGUARD_ARTIFACT_STORAGE_URL is set, new object bytes go to an S3-compatible bucket,
 * Google Cloud Storage or Azure Blob Storage instead of database chunks. Objects already stored
 * in the database keep being read from it. Each provider SDK is loaded only when configured,
 * so installs that keep evidence in the database do not need it.
 */

export interface ObjectBucket {
  /** A credential-free description for logs and errors, e.g. "s3://evidence/visualguard/". */
  readonly description: string;
  put(key: string, data: Uint8Array): Promise<void>;
  /** The object's bytes, or undefined when it does not exist. */
  get(key: string): Promise<Buffer | undefined>;
  exists(key: string): Promise<boolean>;
  /** Removes the object; removing a missing object succeeds. */
  delete(key: string): Promise<void>;
}

export const STORAGE_URL_VARIABLE = "VISUALGUARD_ARTIFACT_STORAGE_URL";

/**
 * Where one content-addressed object lives inside the bucket prefix. MongoDB adds the upload
 * generation, so a concurrent re-upload of the same content never overwrites a copy that
 * cleanup is about to delete.
 */
export function artifactKey(hash: string, generation?: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid artifact digest");
  if (generation !== undefined && !/^[a-zA-Z0-9-]+$/.test(generation))
    throw new Error("Invalid artifact generation");
  return `objects/${hash.slice(0, 2)}/${hash}${generation ? `.${generation}` : ""}`;
}

const OCTET_STREAM = "application/octet-stream";

/**
 * Normalize a URL path into "" or "a/b/", rejecting segments that would escape the prefix.
 */
function prefixFrom(path: string): string {
  // Decode first, so an encoded slash cannot hide a ".." segment.
  const segments = decodeURIComponent(path).split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === ".."))
    throw new Error(`${STORAGE_URL_VARIABLE} must not contain "." or ".." path segments`);
  return segments.length ? `${segments.join("/")}/` : "";
}

/** True for a provider error that means "no such object". */
const notFound = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    name?: string;
    code?: unknown;
    statusCode?: number;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    value.name === "NoSuchKey" ||
    value.name === "NotFound" ||
    value.code === 404 ||
    value.code === "BlobNotFound" ||
    value.statusCode === 404 ||
    value.$metadata?.httpStatusCode === 404
  );
};

/** The subset of @aws-sdk/client-s3 this adapter uses. */
export interface S3Like {
  send(command: unknown): Promise<unknown>;
}
export interface S3Commands {
  PutObjectCommand: new (input: {
    Bucket: string;
    Key: string;
    Body: Uint8Array;
    ContentType: string;
  }) => unknown;
  GetObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
  HeadObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
  DeleteObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
}

export class S3Bucket implements ObjectBucket {
  readonly description: string;
  constructor(
    private client: S3Like,
    private commands: S3Commands,
    private bucket: string,
    private prefix = "",
  ) {
    this.description = `s3://${bucket}/${prefix}`;
  }
  async put(key: string, data: Uint8Array) {
    await this.client.send(
      new this.commands.PutObjectCommand({
        Bucket: this.bucket,
        Key: this.prefix + key,
        Body: data,
        ContentType: OCTET_STREAM,
      }),
    );
  }
  async get(key: string) {
    try {
      const response = (await this.client.send(
        new this.commands.GetObjectCommand({ Bucket: this.bucket, Key: this.prefix + key }),
      )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
      if (!response.Body) return undefined;
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (notFound(error)) return undefined;
      throw error;
    }
  }
  async exists(key: string) {
    try {
      await this.client.send(
        new this.commands.HeadObjectCommand({ Bucket: this.bucket, Key: this.prefix + key }),
      );
      return true;
    } catch (error) {
      if (notFound(error)) return false;
      throw error;
    }
  }
  async delete(key: string) {
    // S3 deletes are idempotent: a missing key succeeds.
    await this.client.send(
      new this.commands.DeleteObjectCommand({ Bucket: this.bucket, Key: this.prefix + key }),
    );
  }
}

/** The subset of @google-cloud/storage's Bucket this adapter uses. */
export interface GcsBucketLike {
  file(name: string): {
    save(data: Buffer, options: { resumable: boolean; contentType: string }): Promise<unknown>;
    download(): Promise<[Buffer]>;
    exists(): Promise<[boolean]>;
    delete(options: { ignoreNotFound: boolean }): Promise<unknown>;
  };
}

export class GcsBucket implements ObjectBucket {
  readonly description: string;
  constructor(
    private bucket: GcsBucketLike,
    name: string,
    private prefix = "",
  ) {
    this.description = `gs://${name}/${prefix}`;
  }
  async put(key: string, data: Uint8Array) {
    await this.bucket
      .file(this.prefix + key)
      .save(Buffer.from(data), { resumable: false, contentType: OCTET_STREAM });
  }
  async get(key: string) {
    try {
      const [data] = await this.bucket.file(this.prefix + key).download();
      return data;
    } catch (error) {
      if (notFound(error)) return undefined;
      throw error;
    }
  }
  async exists(key: string) {
    const [exists] = await this.bucket.file(this.prefix + key).exists();
    return exists;
  }
  async delete(key: string) {
    await this.bucket.file(this.prefix + key).delete({ ignoreNotFound: true });
  }
}

/** The subset of @azure/storage-blob's ContainerClient this adapter uses. */
export interface AzureContainerLike {
  getBlockBlobClient(name: string): {
    uploadData(
      data: Buffer,
      options: { blobHTTPHeaders: { blobContentType: string } },
    ): Promise<unknown>;
    downloadToBuffer(): Promise<Buffer>;
    exists(): Promise<boolean>;
    deleteIfExists(): Promise<unknown>;
  };
}

export class AzureBlobBucket implements ObjectBucket {
  readonly description: string;
  constructor(
    private container: AzureContainerLike,
    name: string,
    private prefix = "",
  ) {
    this.description = `azure://${name}/${prefix}`;
  }
  async put(key: string, data: Uint8Array) {
    await this.container
      .getBlockBlobClient(this.prefix + key)
      .uploadData(Buffer.from(data), { blobHTTPHeaders: { blobContentType: OCTET_STREAM } });
  }
  async get(key: string) {
    try {
      return await this.container.getBlockBlobClient(this.prefix + key).downloadToBuffer();
    } catch (error) {
      if (notFound(error)) return undefined;
      throw error;
    }
  }
  exists(key: string) {
    return this.container.getBlockBlobClient(this.prefix + key).exists();
  }
  async delete(key: string) {
    await this.container.getBlockBlobClient(this.prefix + key).deleteIfExists();
  }
}

/** A process-local bucket for tests. Never configurable: it loses everything on restart. */
export class MemoryBucket implements ObjectBucket {
  readonly objects = new Map<string, Buffer>();
  constructor(readonly description = "memory://test/") {}
  async put(key: string, data: Uint8Array) {
    this.objects.set(key, Buffer.from(data));
  }
  async get(key: string) {
    const data = this.objects.get(key);
    return data && Buffer.from(data);
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

/**
 * Load an optional provider SDK, explaining how to install it when it is missing.
 */
async function sdk<T>(name: string, provider: string): Promise<T> {
  try {
    return (await import(name)) as T;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ERR_MODULE_NOT_FOUND" || error.code === "MODULE_NOT_FOUND")
    )
      throw new Error(
        `${STORAGE_URL_VARIABLE} uses ${provider}; install its SDK next to VisualGuard: npm install ${name}`,
        { cause: error },
      );
    throw error;
  }
}

/**
 * Open the bucket named by VISUALGUARD_ARTIFACT_STORAGE_URL, or return undefined to keep
 * evidence bytes in the database.
 *
 *   s3://bucket/prefix?region=eu-west-1&endpoint=https://…&forcePathStyle=true
 *   gs://bucket/prefix
 *   azure://container/prefix   (with AZURE_STORAGE_CONNECTION_STRING)
 *
 * Credentials come from each provider's standard environment and default chains, never from
 * the URL.
 */
export async function openObjectBucket(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ObjectBucket | undefined> {
  const value = env[STORAGE_URL_VARIABLE]?.trim();
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${STORAGE_URL_VARIABLE} must be a URL such as s3://bucket/prefix, gs://bucket/prefix or azure://container/prefix`,
    );
  }
  if (url.username || url.password)
    throw new Error(
      `${STORAGE_URL_VARIABLE} must not contain credentials; use the provider's standard credential settings`,
    );
  const name = decodeURIComponent(url.hostname);
  if (!name) throw new Error(`${STORAGE_URL_VARIABLE} must name a bucket or container`);
  const prefix = prefixFrom(url.pathname);
  switch (url.protocol) {
    case "s3:": {
      const allowed = new Set(["region", "endpoint", "forcePathStyle"]);
      for (const key of url.searchParams.keys())
        if (!allowed.has(key))
          throw new Error(
            `${STORAGE_URL_VARIABLE}: unknown option "${key}"; use region, endpoint or forcePathStyle`,
          );
      const endpoint = url.searchParams.get("endpoint") ?? undefined;
      if (endpoint && !/^https?:\/\//.test(endpoint))
        throw new Error(`${STORAGE_URL_VARIABLE}: endpoint must be an http(s) URL`);
      const s3 = await sdk<typeof import("@aws-sdk/client-s3")>("@aws-sdk/client-s3", "Amazon S3");
      const client = new s3.S3Client({
        region: url.searchParams.get("region") ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION,
        endpoint,
        forcePathStyle: url.searchParams.get("forcePathStyle") === "true",
      });
      return new S3Bucket(client, s3, name, prefix);
    }
    case "gs:": {
      if (url.search) throw new Error(`${STORAGE_URL_VARIABLE}: gs:// URLs take no options`);
      const gcs = await sdk<typeof import("@google-cloud/storage")>(
        "@google-cloud/storage",
        "Google Cloud Storage",
      );
      return new GcsBucket(new gcs.Storage().bucket(name), name, prefix);
    }
    case "azure:": {
      if (url.search) throw new Error(`${STORAGE_URL_VARIABLE}: azure:// URLs take no options`);
      const connection = env.AZURE_STORAGE_CONNECTION_STRING;
      if (!connection)
        throw new Error(
          `${STORAGE_URL_VARIABLE} uses Azure Blob Storage; set AZURE_STORAGE_CONNECTION_STRING`,
        );
      const azure = await sdk<typeof import("@azure/storage-blob")>(
        "@azure/storage-blob",
        "Azure Blob Storage",
      );
      const container =
        azure.BlobServiceClient.fromConnectionString(connection).getContainerClient(name);
      return new AzureBlobBucket(container, name, prefix);
    }
    default:
      throw new Error(
        `${STORAGE_URL_VARIABLE} must start with s3://, gs:// or azure:// (got ${url.protocol}//)`,
      );
  }
}
