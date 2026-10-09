import type { RunManifest } from "../packages/visualguard/src/core/types.js";
export interface EvaluationCase {
  route: string;
  viewport: string;
  label: string;
  predicted: string;
  modelPredicted?: string;
  status: string;
  expectedStatus: string;
  confidence?: number;
  title?: string;
}
export function evaluationCases(
  manifest: Pick<RunManifest, "jobs">,
  labels: Record<string, string | Record<string, string>>,
  viewports: string[],
): EvaluationCase[];
export function policyMetrics(cases: EvaluationCase[]): {
  regressionRecall: number;
  regressionPrecision: number;
  falseGreenRate: number;
  errorCases: number;
  modelCases: number;
  fallbackCases: number;
};
export function calibrationMetrics(cases: EvaluationCase[]): Array<{
  low: number;
  high: number;
  count: number;
  accuracy: number | null;
  meanConfidence: number | null;
}>;
