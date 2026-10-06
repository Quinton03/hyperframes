# Modifications in this fork (Quinton03/hyperframes)

This is a fork of [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes),
licensed under the Apache License 2.0 (see `LICENSE`). The original copyright and
license are unchanged. Per section 4(b) of the license, the files changed here are
listed below and each carries a "Modified by Quinton03" comment.

Branch `muse-ask-agent`: Studio's "Ask agent" can send the request to an agent
endpoint instead of only copying the prompt to the clipboard.

| File                                               | Change                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/studio-server/src/routes/agent.ts`       | New. `GET /api/agent` (is an agent configured) and `POST /api/projects/:id/agent` (forwards the instruction, project, selected element and full prompt to `HYPERFRAMES_AGENT_URL` with `HYPERFRAMES_AGENT_TOKEN` as a bearer token, server-side). Same-origin only. |
| `packages/studio-server/src/routes/agent.test.ts`  | New. Tests for the route.                                                                                                                                                                                                                                           |
| `packages/studio-server/src/createStudioApi.ts`    | Registers the route.                                                                                                                                                                                                                                                |
| `packages/studio/src/hooks/useAskAgentModal.ts`    | Submit also POSTs to the route; 404 (no agent configured) keeps the upstream clipboard behavior.                                                                                                                                                                    |
| `packages/studio/src/components/AskAgentModal.tsx` | Says "Send to <label>" when an agent is configured.                                                                                                                                                                                                                 |

Config (environment of `hyperframes preview`):

- `HYPERFRAMES_AGENT_URL` - the endpoint (unset = upstream behavior).
- `HYPERFRAMES_AGENT_TOKEN` - bearer token sent to it (never reaches the browser).
- `HYPERFRAMES_AGENT_LABEL` - the name shown in the modal (default "agent").
