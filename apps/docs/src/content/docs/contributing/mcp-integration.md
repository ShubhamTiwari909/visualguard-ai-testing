---
title: "AI agent integration plan"
description: "Planned MCP support for Claude Code, Codex, and Gemini CLI, including scope, phases, and the distinction between a proposal and a working integration."
audience: "contributor"
docType: "reference"
channel: "source"
lastReviewed: "2026-10-21"
sourcePaths: ["docs/MCP-INTEGRATION-PLAN.md", "packages/visualguard/src/index.ts", "packages/visualguard/src/core/run.ts", "packages/visualguard/src/core/events.ts"]
sidebar: {"order": 8}
---

VisualGuard's proposed MCP server would let an AI agent run configured comparisons and inspect the results through a common interface. This is a planning page: there is no VisualGuard MCP command, published MCP package, hosted endpoint, or registered connector yet.

## Why MCP

One server can expose the same tools to several agent clients. The first proposed clients are [Claude Code](https://code.claude.com/docs/en/mcp), [Codex](https://developers.openai.com/codex/mcp), and [Gemini CLI](https://geminicli.com/docs/tools/mcp-server/), whose official documentation describes local stdio MCP support. Their chat, desktop, and cloud products need separate compatibility checks; they do not all share the same installation or network access.

The proposed first release uses a local server launched by the client. Hosted Streamable HTTP support comes later. A marketplace connector or client extension would package the shared integration rather than introduce a separate comparison engine.

## Intended section-testing workflow

1. Set up a working VisualGuard configuration and [section selector](/guides/section-capture/).
2. Connect the future local MCP server to your chosen agent, pointing it at your application workspace.
3. Ask: “Compare the checkout section on production and staging and explain the result without updating baselines.”
4. The agent lists configured targets, starts the selected comparison, follows its progress, and retrieves the result.
5. The agent can inspect the reference, candidate, and diff images and explain findings. The engine's recorded status remains authoritative.
6. After a user-requested application edit, the agent can rerun the same check to verify the effect.

Step 1 works today from source containing section capture. The MCP connection in steps 2–6 remains proposed. Until it ships, use the [CLI workflow](/guides/section-capture/#3-run-and-verify) or [programmatic API](/guides/programmatic-api/).

## Proposed first tools

| Capability | Purpose |
| --- | --- |
| Capabilities and target planning | Discover configured profiles, routes, viewports, and section job IDs without capturing. |
| Start and inspect a run | Start a comparison and return an operation ID for progress and completion. |
| Read results and images | Retrieve bounded summaries and request specific evidence as needed. |
| Cancel a run | Stop queued/running work and report partial evidence as incomplete. |

The adapter should reuse VisualGuard's public API, existing section/baseline identity, progress events, and cancellation. The first version keeps baseline updates, approvals, fixing, publishing, and administrative changes outside its tool surface. VisualGuard's extra AI analysis can remain disabled while the connected agent explains deterministic results.

## Implementation phases

| Phase | Deliverable |
| --- | --- |
| M01 | Verify SDK/protocol and actual client compatibility, including structured output and images. |
| M02 | Add trusted workspace configuration, local inspection, and validated evidence access. |
| M03 | Add comparison execution, status, cancellation, queue limits, and retry protection. |
| M04 | Package and document the local MVP; complete a real section comparison in all three clients. |
| M05 | Add authenticated hosted dashboard access using Streamable HTTP and project permissions. |
| M06 | Evaluate optional client plugins/connectors and separately scoped mutation tools. |

The full engineering plan is maintained in `docs/MCP-INTEGRATION-PLAN.md` in the repository. It includes proposed tool schemas, package boundaries, future client configuration examples, operation lifecycle, evidence handling, authorization, and completion gates. Every command in its future-client section is explicitly a proposal until implementation exists.

## Boundaries to preserve

- Keep the normal CLI/offline workflow available without installing the MCP adapter.
- Use explicit trusted workspace configuration; do not accept arbitrary executable config or shell commands through tools.
- Keep credentials out of responses. Treat captured pages and DOM text as evidence, not instructions to the agent.
- Keep section screenshots separate from page baselines, and preserve page-wide health findings.
- Never represent interrupted captures, missing references, or partial evidence as a passing comparison.
- Test each supported client and hosted surface independently before documenting it as supported.

For protocol implementation, use the current [official TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/) and recheck supported versions when the compatibility phase begins. The engineering plan is based on documentation reviewed on 2026-10-21; it is not a report of completed integration tests.
