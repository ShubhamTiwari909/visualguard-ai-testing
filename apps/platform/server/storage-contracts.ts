import type {
  DeletionResult,
  Project,
  RunDetail,
  RunFilters,
  RunPage,
} from "../shared/contracts.js";

export interface EvidenceRepository {
  isDeletedProject(id: string): Promise<boolean>;
  ensureProject(id: string, name: string): Promise<{ project: Project; created: boolean }>;
  createProject(id: string, name: string): Promise<Project>;
  projects(allowed?: string[]): Promise<Project[]>;
  getRun(id: string): Promise<RunDetail>;
  renameRun(id: string, name: string, expectedVersion: number): Promise<RunDetail>;
  insertRun(
    run: Omit<RunDetail, "id">,
    preserveId?: string,
  ): Promise<{ run: RunDetail; duplicate: boolean }>;
  runs(filters: RunFilters, allowed?: string[]): Promise<RunPage>;
  deleteRun(id: string, expectedProject?: string): Promise<DeletionResult>;
  deleteProject(id: string, expectedRuns: number): Promise<DeletionResult>;
}

export interface PlatformRepository extends EvidenceRepository {
  resolveProjectId(id: string): Promise<string>;
  updateProject(
    id: string,
    name: string,
    publicId: string,
    expectedVersion: number,
  ): Promise<Project>;
}

export interface StateRecord<T = unknown> {
  id: string;
  value: T;
  version: number;
  expiresAt?: string;
}
/** Compare-and-swap makes sessions, revocation and upload progress work across instances. */
export interface StateStore {
  /** Optional multi-record boundary. Standalone MongoDB deliberately reports false. */
  supportsTransactions?(): Promise<boolean>;
  transaction?<T>(work: (store: StateStore) => Promise<T>): Promise<T>;
  get<T>(namespace: string, id: string): Promise<StateRecord<T> | undefined>;
  create<T>(namespace: string, id: string, value: T, expiresAt?: string): Promise<boolean>;
  replace<T>(namespace: string, record: StateRecord<T>): Promise<boolean>;
  remove(namespace: string, id: string, version?: number): Promise<boolean>;
  /** Lexicographic keyset pagination; after is an exclusive full record ID. */
  list<T>(
    namespace: string,
    prefix?: string,
    limit?: number,
    after?: string,
  ): Promise<StateRecord<T>[]>;
  pruneExpired(limit?: number): Promise<number>;
}
