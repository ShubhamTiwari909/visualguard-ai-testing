import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadReportData } from "./data";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
const data = loadReportData();

root.render(
  <StrictMode>
    {data ? (
      <App data={data} />
    ) : (
      <main className="p-8 text-sm">
        <h1 className="text-lg font-semibold">VisualGuard report</h1>
        <p className="mt-2 text-slate-600">
          No run data found. Open the <code>index.html</code> inside a run directory, or run{" "}
          <code>npx visualguard report</code>.
        </p>
      </main>
    )}
  </StrictMode>,
);
