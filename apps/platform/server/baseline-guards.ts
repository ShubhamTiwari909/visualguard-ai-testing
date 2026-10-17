import type { StateStore } from "./storage-contracts.js";
import { PlatformError } from "./errors.js";

export interface BaselineRunGuard { status: "active" | "deleting"; pinned: boolean }
export async function prepareBaselineRun(state: StateStore, id: string) {
  await state.create<BaselineRunGuard>("baseline-runs", id, { status: "active", pinned: false });
}
export async function pinBaselineRun(state: StateStore, id: string) {
  const row = await state.get<BaselineRunGuard>("baseline-runs", id);
  if (!row || row.value.status !== "active") throw new PlatformError(409, "Source run is being deleted");
  if (!(await state.replace("baseline-runs", { ...row, value: { status: "active", pinned: true } })))
    throw new PlatformError(409, "Source run changed; refresh and retry");
}
