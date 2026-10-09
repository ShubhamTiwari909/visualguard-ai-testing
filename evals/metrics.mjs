/** Dataset applicability is independent from detector output. Missing captures remain misses. */
export function evaluationCases(manifest, labels, viewports) {
  const cases = [];
  for (const [route, expected] of Object.entries(labels)) {
    if (route.startsWith("$")) continue;
    for (const viewport of viewports) {
      const label = typeof expected === "string" ? expected : expected[viewport];
      if (!label) continue;
      const job = manifest.jobs.find((j) => j.route === route && j.viewport === viewport);
      cases.push({
        route,
        viewport,
        label,
        predicted:
          !job || job.error
            ? "error"
            : (job.analysis?.classification ??
              (job.status === "regression"
                ? "regression"
                : job.status === "pass"
                  ? "noise"
                  : "intentional")),
        modelPredicted: job?.analysis?.classification,
        status: job?.status ?? "error",
        expectedStatus:
          label === "regression" ? "regression" : label === "noise" ? "pass" : "review",
        confidence: job?.analysis?.confidence,
        title: job?.analysis?.title ?? job?.findings?.[0]?.message,
      });
    }
  }
  return cases;
}

export function policyMetrics(cases) {
  const regressions = cases.filter((c) => c.label === "regression");
  const detections = cases.filter((c) => c.status === "regression");
  return {
    regressionRecall: regressions.length
      ? regressions.filter((c) => c.status === "regression").length / regressions.length
      : 0,
    regressionPrecision: detections.length
      ? detections.filter((c) => c.label === "regression").length / detections.length
      : 0,
    falseGreenRate: regressions.length
      ? regressions.filter((c) => c.status === "pass" || c.status === "accepted").length /
        regressions.length
      : 0,
    errorCases: cases.filter((c) => c.predicted === "error").length,
    modelCases: cases.filter((c) => c.modelPredicted).length,
    fallbackCases: cases.filter((c) => !c.modelPredicted).length,
  };
}

/** Confidence is self-reported; bins expose calibration rather than assuming probability. */
export function calibrationMetrics(cases) {
  const scored = cases.filter((c) => c.modelPredicted && Number.isFinite(c.confidence));
  return [0, 0.5, 0.8, 0.9].map((low, index, bounds) => {
    const high = bounds[index + 1] ?? 1.01;
    const bin = scored.filter((c) => c.confidence >= low && c.confidence < high);
    return {
      low,
      high: Math.min(1, high),
      count: bin.length,
      accuracy: bin.length
        ? bin.filter((c) => c.label === c.modelPredicted).length / bin.length
        : null,
      meanConfidence: bin.length
        ? bin.reduce((sum, c) => sum + c.confidence, 0) / bin.length
        : null,
    };
  });
}
