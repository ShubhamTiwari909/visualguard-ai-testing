# Reading VisualGuard's code as a new JavaScript developer

This guide explains the language patterns used in the package. Read it alongside the comments in each source file and the [architecture guide](PACKAGE-ARCHITECTURE.md), which lists every package file and its connections.

The source comments describe what a function receives, what it produces, why it exists and any important effects such as writing files, calling a provider or starting a process. Existing algorithm details and examples are retained. Small helpers are documented too: a one-line function can still encode a rule that matters to the rest of the package.

## Start with one path through the package

For a first read, follow a configured comparison:

1. [CLI entry](../packages/visualguard/src/cli/main.ts) receives terminal arguments.
2. [Program registration](../packages/visualguard/src/cli/program.ts) connects command names to handlers.
3. [Test command](../packages/visualguard/src/cli/commands/test.ts) loads configuration and starts a run.
4. [Run orchestration](../packages/visualguard/src/core/run.ts) plans jobs and coordinates resources.
5. [Capture](../packages/visualguard/src/capture/capture.ts) loads pages and gathers screenshots and health evidence.
6. [Diff computation](../packages/visualguard/src/diff/compute.ts) measures changed pixels and writes crops.
7. [Comparison policy](../packages/visualguard/src/core/comparison.ts) combines visual and independent checks.
8. [AI analysis](../packages/visualguard/src/ai/analyze-job.ts), when enabled, interprets saved evidence within its policy and budget.
9. [Report rendering](../packages/visualguard/src/reporters/html.ts) embeds the manifest for the [browser UI](../packages/visualguard/report-app/src/main.tsx).

A **job** is one route at one viewport. A **run** contains many jobs. A **manifest** is the saved JSON record of the run, including results and references to artifacts. An **artifact** is a saved screenshot, DOM snapshot, crop, report or other evidence file.

You can read each stage on its own. Begin with the file header, then the exported function and its input/output types, then its smaller helpers. Follow an import when you need to understand the next operation.

## JavaScript, TypeScript and JSX

Most Node package source is TypeScript (`.ts`). The browser report uses TypeScript with JSX (`.tsx`). Repository support scripts are JavaScript modules (`.mjs`).

TypeScript adds descriptions of values to JavaScript:

```ts
function formatDuration(ms: number): string {
  return `${Math.round(ms)}ms`;
}
```

Here `ms: number` describes the input, and `: string` describes the return value. The JavaScript build removes those type annotations. A type annotation does **not** validate a value received from JSON, a page or an HTTP request. Runtime boundaries use checks or schemas when validation is needed.

An `interface` describes an object's fields. A `type` can describe an object, a union or another relationship between values. These declarations help the compiler and editor; they do not allocate a runtime object.

```ts
interface Size {
  width: number;
  height: number;
}

type Env = "production" | "staging";
```

The `|` here means either permitted string. In [core/types.ts](../packages/visualguard/src/core/types.ts), checking a delta's `kind` tells TypeScript whether its values are text, styles, boxes or element-presence evidence. This is called a **discriminated union**.

JSX is the markup-like syntax returned by React components. A component is a function whose return value describes UI elements. Expressions inside `{ ... }` supply JavaScript values to that markup.

## Imports, exports and entry points

`import` reads exports from another module. `export` makes a declaration available to importing code. An import path starting with `./` or `../` is relative to its file; `node:fs` is a Node built-in, and a package name refers to a dependency.

Internal Node TypeScript imports commonly end in `.js`. They describe the filenames in the published JavaScript build. This is intentional; do not change them to `.ts` just because the source file uses that extension.

`import type` and `export type` describe compile-time relationships and are removed from the JavaScript output. The generated architecture graph marks type relationships separately from executable dependencies.

The public library entry, [src/index.ts](../packages/visualguard/src/index.ts), gathers selected exports. Importing it does not start a comparison. The caller creates a run and calls `.start()`. The CLI entry parses terminal arguments. The Playwright entry extends test fixtures. The worker entry listens for diff tasks. The report entry mounts React in the browser.

## Function declarations, arrow functions and callbacks

These two forms both define a function:

```ts
function near(a: number, b: number, tolerance: number) {
  return Math.abs(a - b) <= tolerance;
}

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;
```

The arrow form without braces returns its expression automatically. With braces, use `return` when a value must be returned. Returning an object directly requires parentheses around it: `() => ({ severity: "info" })`; otherwise the braces are interpreted as a function block.

A **callback** is a function passed to another operation to run later or for each item. Examples include array filters, command actions, browser event listeners and report callbacks. Passing a callback is different from immediately calling it.

A **closure** is a function that remembers variables from the scope where it was created. In the worker pool, nested helpers share the queue and worker maps. In a reporter factory, `onRunEnd` remembers the output path passed when the reporter was created.

## Promises, async and await

A **Promise** represents an operation that will eventually produce a value or an error. It has not necessarily finished when it is returned.

An `async` function always returns a Promise. `await` pauses that function until the Promise settles, while allowing the event loop to process other work. It does not make a CPU-heavy synchronous pixel loop run in parallel.

```ts
const first = await capturePage(productionRequest);
const second = await capturePage(stagingRequest);
```

These operations start sequentially. In contrast, `Promise.all([operationA(), operationB()])` starts both calls before awaiting their results. Use concurrency only when the operations and resource limits permit it.

`Promise.race` settles with whichever input settles first. [withTimeout](../packages/visualguard/src/core/util.ts) races work against a fallback timer. It clears the timer afterward, but it does **not** cancel the underlying operation. An early rejection from the original work still propagates.

`AbortSignal` communicates cancellation. Combining a caller signal with a timeout means either condition can stop cooperative work. The [AI budget](../packages/visualguard/src/ai/budget.ts) also limits generation attempts, network attempts and tokens. A transport retry and a new schema-repair generation are different kinds of work and have separate counters.

## Errors and cleanup

`throw` ends the current operation with an error. `try/catch` handles a thrown error or rejected awaited Promise. `finally` runs as the operation leaves the try/catch, including after a return or failure.

VisualGuard uses `finally` for context/server cleanup and transactional repair handling. Read cleanup carefully when following a function that owns a browser, child process or temporary worktree.

Caught values are often typed `unknown` because JavaScript can throw any value. [errorMessage](../packages/visualguard/src/core/errors.ts) checks whether it received an Error before reading `.message`.

Not every catch means the whole job should fail. Missing optional DOM evidence can weaken an explanation while leaving a screenshot usable. A failed source restoration must be reported because it affects the developer's files. Comments explain these distinctions at the relevant boundaries.

## Common syntax in the package

| Syntax                              | Meaning                                                   | Why it appears here                                                      |
| ----------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `value?.field`                      | Read a field only if the value is not null/undefined.     | Captures and analysis can be absent after a failed or skipped stage.     |
| `value ?? fallback`                 | Use the fallback only for null/undefined.                 | Keep valid zero/false values while filling omitted settings.             |
| `value ??= fallback`                | Assign the fallback only for null/undefined.              | Cache the lazily loaded axe script.                                      |
| `value                              |                                                           | fallback`                                                                | Use the fallback for any falsy value, including empty text, zero and false. | Some environment values treat an empty string as unspecified. |
| `value!`                            | Tell TypeScript this value is not null/undefined.         | Known valid fixture/node indexes; this adds no runtime check.            |
| `value as SomeType`                 | Assert a type to the compiler.                            | Describe loaded data; this does not parse or validate JSON.              |
| `{ ...object, status }`             | Make a shallow object copy and replace/add fields.        | Produce an updated job without replacing every field manually.           |
| `[...array]`                        | Make a shallow array copy.                                | Sort an array while preserving the original order.                       |
| `const { job, runDir } = input`     | Extract named object fields.                              | Give inputs short readable local names.                                  |
| `const [x, y, width, height] = box` | Extract array positions.                                  | Expand compact snapshot geometry.                                        |
| `` `${route} ${viewport}` ``        | Interpolate values into a string.                         | Construct labels and stable job identifiers.                             |
| `condition ? a : b`                 | Choose one of two expressions.                            | Select labels, thresholds or optional values.                            |
| `readonly`                          | Prevent reassignment through that TypeScript declaration. | Express ownership/contracts; it does not deeply freeze a runtime object. |

Spread copies are **shallow**: nested objects retain their references unless explicitly copied. React filter state copies the Set before changing it so React sees a new state object. Image processing intentionally writes into mutable typed arrays.

## Arrays, Sets and Maps

`map` transforms each array item; `filter` keeps matching items; `some` stops once a match is found; `find` returns the first match or undefined. `reduce` combines items into a running total. `flatMap` maps each item and flattens one array level.

`sort` changes its array in place. Functions that preserve source order first make a copy, such as `[...jobs].sort(...)`. A comparison callback returns a negative number, zero or a positive number to describe ordering.

A `Set` stores unique values and supports `has`, `add` and `delete`. A `Map` stores key/value pairs and supports `get` and `set`. They are used for accepted-change deduplication, request tracking, candidate scores, node correspondence and worker ownership.

`Object.entries(object)` produces `[key, value]` pairs. `Object.fromEntries(pairs)` rebuilds an object. These help turn a job list into a status lookup or filter empty header values.

## Browser code and Node code are separate

Node can read files, start processes and run Git. The browser can read `document`, page geometry, computed styles and `window`.

`page.evaluate(callback, argument)` sends a function to the browser. Its callback cannot access surrounding Node variables or imports unless the needed data is passed explicitly. The [DOM collector](../packages/visualguard/src/capture/dom-snapshot.ts) therefore contains its browser helpers inside one self-contained function.

`addInitScript` installs browser code before page scripts execute. Performance instrumentation uses it before installing Playwright's fake clock. Playwright event handlers such as `page.on("console", ...)` run on the Node side and receive events from the browser.

The report UI also runs in a browser, but it is a separate application from the page being tested. It receives saved manifest data embedded in the HTML. Interactive acceptance/repair requests go to the local report server, which performs the Node-side operation.

## Images, geometry and compact DOM data

A decoded image has four bytes per pixel: red, green, blue and alpha (**RGBA**). For a pixel at `(x, y)`, its first byte is at `(y * width + x) * 4`. A binary changed-pixel mask has one entry per pixel, so its index is `y * width + x`.

Rows in these flat arrays are stored consecutively. Copying a cropped or padded image must calculate a source and destination row offset using the appropriate widths. Do not reuse an RGBA byte offset as a mask offset.

Snapshot boxes are `[x, y, width, height]` in page coordinates. The report converts them into percentages of a common image canvas for display. Shift handling translates reference geometry into current geometry before interpreting changed regions.

A captured DOM snapshot is a flat node array. Short fields reduce saved JSON size:

| Field | Meaning                                                             |
| ----- | ------------------------------------------------------------------- |
| `i`   | Node index; it matches the node's array position.                   |
| `p`   | Parent index; `-1` identifies the root.                             |
| `s`   | Index into the shared computed-style array.                         |
| `n`   | Number of recorded element children.                                |
| `sel` | Readable selector used in evidence/reporting.                       |
| `key` | Stable-looking ID/test identifier used for matching when available. |
| `cls` | Captured class-list text, useful for locating source.               |
| `box` | Page rectangle tuple.                                               |

[DomIndex](../packages/visualguard/src/mapping/dom.ts) provides readable accessors around that compact representation. [Tree matching](../packages/visualguard/src/mapping/match.ts) pairs unique keys and aligns children in order, so inserting an element does not make every subsequent sibling look unrelated.

## Following a repair safely through the code

Read [fixer/fix.ts](../packages/visualguard/src/fixer/fix.ts) together with [edits.ts](../packages/visualguard/src/fixer/edits.ts) and [verify.ts](../packages/visualguard/src/fixer/verify.ts).

A proposal contains literal search/replace edits and original source snapshots. Validation checks allowed paths and match uniqueness. Preview calculates a diff in memory. Application checks that files still match the expected source, writes edits and retains originals. Verification runs configured commands and captures the local page again against reference evidence. Failed or cancelled verification restores the original files.

An AI patch response is a proposal, not proof that the issue is fixed. Deterministic verification decides whether an edit can remain. The report server also checks proposal freshness and coordinates concurrent application requests.

Child-process timeout handling must stop descendants as well as the parent shell. The verification helpers capture bounded output, settle their Promise once and coordinate graceful/forced termination. Their comments describe these steps where they occur.

## Reading and maintaining tests

`describe` groups related scenarios. `it`/`test` names a case. `expect` checks its result. Setup hooks prepare shared state; teardown hooks release servers, browser contexts and temporary directories.

Helpers create synthetic images, nested DOM specifications, fake provider endpoints or temporary Git repositories. These fixtures isolate a particular rule so the assertion explains what behavior the package guarantees. Mock providers exercise parsing and policy without cloud usage; capture/UI suites exercise real browser behavior.

When updating comments, keep them aligned with the current behavior. Explain surprising decisions, units, optional results and side effects. Avoid claiming a heuristic is exact or that a TypeScript assertion performs runtime validation. Preserve important cleanup and coordinate invariants.

When files/imports change, regenerate the architecture inventory from the repository root:

```bash
node scripts/package-map.mjs
```

The generator reads source syntax and curated file roles. It does not execute package capture or repair code. Add a role for a new package file, then regenerate and review the guide/graph changes.
