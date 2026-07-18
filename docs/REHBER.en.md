# 🎼 Symphony — Architecture & User Guide

*[🇹🇷 Türkçe sürüm](REHBER.md)*

> Source: this file is a translation of `docs/REHBER.md` (the Turkish original,
> which remains the single source of truth — the project itself is developed in
> Turkish). To build a PDF: `pnpm docs:pdf:en` (produces `docs/REHBER.en.pdf`).
> This document grows with the code; it is updated as the system changes.

## 1. What is Symphony?

Symphony is a cross-platform (Windows/macOS/ARM) orchestration system that manages
local (open models running via Ollama) and cloud (Claude, GPT, Gemini) large language
models, along with code-writing/editing **agents**, from a single background process
(`symphonyd`). The terminal (the `symphony` command) and the desktop app are two
simultaneous interfaces connected to the same daemon — you can start an agent run in
one and watch it live in the other.

**Core idea:** LLM calls, agent runs, permission decisions, usage/cost tracking, and
model selection are all centralized in one place (the daemon); the CLI and desktop
app are merely **clients** of it. No interface connects directly to a provider
(Anthropic, OpenAI, Ollama...) on its own — everything goes through the daemon. This
means:

- You can start the same chat/agent run in the terminal and watch it in the desktop
  app (or vice versa).
- Usage/cost, error telemetry, and model performance scores accumulate in one place.
- API keys are stored in one place (the OS keychain), never embedded in any client code.

## 2. Architecture overview

### 2.1 Package graph (monorepo)

```
shared  →  core  →  ┌── cli
                     ├── ui
                     └── desktop
```

- **`shared`** — the SINGLE source of the protocol: zod schemas for WS/REST messages
  + shared types. Depends on nothing else; pure enough to run in the browser (`ui`) too.
- **`core`** — the `symphonyd` daemon itself: provider adapters, the SQLite data layer,
  the agent engine (permission system + toolset), the model router, the WS/REST server.
- **`cli`** — the `symphony` command: the terminal interface (Ink-based TUI + commander
  subcommands). Auto-starts the daemon if needed (`ensureDaemonRunning`).
- **`ui`** — the React+Vite desktop panel. Depends only on `shared` (NOT on `core`) —
  it can run both in a browser and inside a Tauri webview.
- **`desktop`** — the Tauri 2 shell: packages `ui/dist` into a native window, reads the
  daemon token from disk and injects it into the webview securely.

Dependency direction is **one-way**: `shared` knows about no other package, `core`
only knows about `shared`, the upper packages use `core` but `core` knows none of them.

### 2.2 Daemon-centric working model

```
                         ┌─────────────┐
        terminal ───WS──▶│             │◀──WS─── desktop (Tauri)
       (symphony)         │  symphonyd  │
                         │  (core)     │
                         └──────┬──────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              provider's     SQLite     ~/.symphony/
           (Anthropic/GPT/  (history,   (config, agent
            Gemini/Ollama)  telemetry,   definitions,
                             scores)      memory, non-key
                                          settings)
```

- The daemon listens on `127.0.0.1:7770` (configurable), bound to loopback only.
- Authentication: a random token generated at startup is written to
  `~/.symphony/daemon.token`; clients present it as `Authorization: Bearer` on REST,
  and in the first `hello` message on WS.
- Persistent data (`~/.symphony/data/symphony.db`, SQLite): chat history, agent run
  records, error telemetry, usage/cost counters. On top of this data, the model
  router learns which model/provider tends to be more successful/faster/cheaper for
  which kind of task.

## 3. Code map

Most frequently touched files and what they do (the full, session-current map lives
in `memo/BAGLAM.md`, in Turkish — this section is a reader-facing summary of it):

| Area | File | What it does |
|---|---|---|
| Protocol schemas | `packages/shared/src/protocol/*.ts` | A zod schema for every WS message/event and REST response |
| Daemon (single file) | `packages/core/src/server/daemon.ts` | Fastify+ws server; ALL request handlers live here |
| Agent engine | `packages/core/src/agent/engine.ts` | Run loop, permission gate, state machine, cancellation |
| Permission system | `packages/core/src/agent/permissions.ts` | deny > allow > risk-class default |
| Toolset | `packages/core/src/agent/tools.ts` | `read_file`/`write_file`/`edit`/`glob`/`grep`/`run_command` |
| Workspace jail | `packages/core/src/agent/jail.ts` | Guarantees the agent can't escape its `cwd` |
| Model router | `packages/core/src/router/router.ts` + `stats.ts` | Model suggestions based on rules + historical performance |
| Provider adapters | `packages/core/src/providers/*.ts` | Anthropic/OpenAI/Google/Ollama — one interface |
| Data layer | `packages/core/src/db/store.ts` | SQLite: migrations, history/telemetry/score read-write |
| CLI entry point | `packages/cli/src/index.ts` | Commander registrations for all subcommands |
| CLI–daemon bridge | `packages/cli/src/client/daemon-client.ts` | WS client + automatic daemon startup |
| Desktop store | `packages/ui/src/store.ts` | The ONE place that turns WS events into UI state |
| Living scene | `packages/ui/src/scene/TesseractScene.tsx` | Live 3D visualization of system state |

## 4. Agent, tool, and permission system

An **agent** is defined by a `~/.symphony/agents/<name>.md` file: which model/provider
it uses, which tools it can access, its system prompt. Two default agents ship
out of the box: `coder` (full toolset) and `asistan` ("assistant" — read-only, can't
modify files or run commands).

**Toolset:**

| Tool | Risk class | When it asks for permission |
|---|---|---|
| `read_file`, `glob`, `grep` | safe | never — auto-allowed |
| `write_file`, `edit` | mutating | always — shown as a unified diff |
| `run_command` | mutating | always — shown with the command text |
| `run_agent` (delegate to another agent) | depends on the target | auto if the target is read-only, otherwise asks |
| file deletion / `git push` / network writes | destructive | always — "always allow" is NOT offered |

**Invariants of the permission flow:**

1. The permission check is the **single gate** for running a tool — there is no code
   path that bypasses it.
2. Decision order: a `deny` rule in `permissions.json` > an `allow` rule > a
   run-scoped temporary grant (`allow_for_run`) > the risk class's default.
3. `write_file`/`edit` are always confirmed with a **unified diff** — nothing is
   written without you seeing exactly what will change.
4. An agent **cannot leave** its workspace (`cwd`) — every file path is resolved and
   checked against the boundary; an escape attempt does not run the tool.
5. An agent cannot write to its own configuration (`~/.symphony/`); `permissions.json`
   is only ever updated by permission decisions **you** made.

An agent can **delegate** a task to another agent (the `run_agent` tool, Phase 5) —
this shows up in the dashboard as an indented "child run" under the parent run; it
opens its own permission requests independently.

## 5. Protocol summary

Clients (CLI, desktop) talk to the daemon **only** through the zod schemas in
`packages/shared` — a message without a schema cannot be sent or handled. Two channels:

- **WebSocket** (`ws://127.0.0.1:7770/ws`) — the event stream + long-lived operations
  (chat, agent runs). Every message uses one envelope shape:
  `{ id, type, ts, replyTo, payload }`. Every request gets at least one reply
  (`<type>.ok` or `error`); events don't carry `replyTo` — they're broadcast to
  **all** connected clients, which is the source of terminal⇄desktop simultaneity.
- **REST** (`http://127.0.0.1:7770/api/...`) — status queries and one-shot commands:
  health probe, chat history, user profile, roadmap, usage report, context map,
  clean shutdown (`POST /api/shutdown`).

**Agent run state machine:**

```
queued → thinking → executing_tool → thinking → ... → completed
              ↘ awaiting_permission ↗                ↘ failed
              ↘ awaiting_user ↗ (conversational agent)  ↘ (from any state) cancelled
```

Event history is **not replayed** on reconnect — instead, the `hello.ok` response
provides a full snapshot of active runs/permissions/provider state; persistent chat
history is queried separately over REST.

## 6. Command reference

```
symphony                          No args: TUI (model/agent picker + chat)
symphony status                   Daemon, provider health, usage summary
symphony models                   Available models for every provider
symphony watch                    Live-follow the daemon's event stream
symphony agents                   List registered agent definitions
symphony agent <name> "<task>"     Start an agent run (you approve via permissions)
symphony add <npm-package>         Register an MCP server as a tool (plugin system)
symphony feedback <runId> good|bad Mark a past run (feeds the model router)
symphony report [--from --to]     Usage report (tokens/cost, success table, findings)
symphony history [session]        Chat history: list, or one session's transcript
symphony memory show|path|distill Manage the user profile (persistent memory)
symphony sync init <repo-url>     Link ~/.symphony settings to a git repo (new machine)
symphony sync                     Sync settings with the remote repo
symphony update                   Install the new version from npm if any, restart daemon
symphony rollback                 Revert to the version before the last update
symphony doctor [--code <code>]   Diagnose a recurring error in a sandbox, propose a patch
symphony patches                  List patch proposals + category track record
symphony patch apply <id>         Ship a patch (build+test+restart; auto-reverts if broken)
symphony patch reject <id>        Reject a patch proposal, delete its branch
symphony patch trust <category>   Trust a category (future clean patches apply without asking)
symphony patch untrust <category> Revoke trust from a category
symphony bekci ekle <name> <repo> <log> [--test <cmd>]   Start watching one of your own projects
symphony bekci liste              List registered watched ("bekçi") projects
symphony doctor --proje <name>    Run the SAME diagnose/patch pipeline for a watched project
symphony agent-oneri uygula <agentId>   Apply an agent-definition suggestion (pins a model, asks to confirm)
symphony harita ekle <id> [--baslik X]  Pin a chat/run to the context map (an id prefix is enough)
symphony harita liste             List pinned contexts and groups
```

> Note: a handful of subcommands (`bekci`, `harita`, `agent-oneri`, and some flags
> like `--kod`/`--proje`) keep their original Turkish names — see §9 and the
> project's own naming note in `ROADMAP.md` (item N1) for why.

## 7. Install, sync, and update flow

**First install:**

```
npm install -g @lrgendie/cli
symphony
```

On first run, `~/.symphony/` is created (config, agent definitions, local data).
Your API keys live in the OS keychain — never written to disk as plain text. If the
desktop app is installed, it launches automatically when `symphony` starts (disable
with `~/.symphony/config.json` → `{"desktop":{"autoLaunch":false}}`).

**Moving to a second machine:**

```
symphony sync init <private-git-repo-url>
```

Settings (`config.json`, `providers.json`, agent definitions, memory, the MCP
registry) come down to the new machine. **Never synced:** the daemon token, the
SQLite database, logs, the PID file — these are machine-specific or simply
unnecessary. Since keys stay in the keychain, sync is safe without ever touching them.

**Update and rollback:**

```
symphony update      # installs the new version from npm if any, restarts the daemon
symphony rollback    # reverts to the previous version
```

Updates are delegated to the npm registry; there is no silent background
auto-update mechanism — it always runs on your trigger, and can always be reverted
with a single command. This is also the foundation of the "rollback" guarantee that
the self-improving agents (Phase 8) need.

## 8. Self-improvement (Phase 8, ADR-018)

Symphony can work against its own source code — entirely human-triggered, no step
runs silently in the background:

1. **Diagnosis:** the daemon tracks recurring error codes against a deterministic
   threshold (the LLM is never asked "which error matters"). This scan runs
   automatically once a day, and drops a warning into the live log stream when it
   finds a candidate.
2. **`symphony doctor`:** opens an isolated `git worktree` for the chosen error,
   writes the diagnosis file, runs the `doktor` ("doctor") agent (a pinned model —
   reliable tool-calling is a hard requirement) in that sandbox; the pipeline itself
   runs build/test/lint (the agent's own claim of "it passed" is never trusted). The
   result is a **patch proposal** — nothing is applied automatically.
3. **`symphony patch apply <id>`:** merges the proposal into the main branch, reruns
   build+test, restarts the daemon with the new code. If any step (tests, or the
   daemon coming back up) fails, it **automatically reverts** to the previous code —
   patches touching invariant files (the permission system, jail, agent
   definitions, keys, token) can never skip confirmation with any flag.
4. **Trust ladder:** if a category (error code) repeatedly produces healthy results,
   `symphony patch trust <category>` marks it as trusted — future clean patches in
   that category are applied inside `symphony doctor` without asking. Categories
   that ever touched an invariant file are never eligible for trust.
5. **`symphony report`** now also includes a "Self-Improvement" section: current
   recurring errors, counts of proposed/applied/reverted patches, the category
   track record. This report is also generated automatically once a week
   (`~/.symphony/reports/`).
6. **Agent-definition update suggestions:** if an agent (as long as it's unpinned,
   i.e. its model field is empty) has run with more than one model in the past and
   one is clearly more successful, `symphony report` surfaces this in an "Agent
   Definition Suggestions" section. `symphony agent-oneri uygula <agentId>` shows
   the diff and asks for confirmation; if you approve, it pins only that agent's
   model — the daemon does not restart. A already-pinned agent is NEVER offered an
   alternative (there's no evidence to base it on — it would just be a guess).
7. **Watcher mode ("bekçi", v1):** self-improvement also works for **your own**
   projects. `symphony bekci ekle <name> <repo-path> <log-file> [--test <cmd>]`
   registers a project — the daemon polls that log file every 10 seconds, and drops
   a warning if it matches an `error`/`exception`/`traceback`/`fatal` pattern.
   `symphony doctor --proje <name>` runs the SAME diagnose→sandbox→patch pipeline,
   but rooted at your project's `repoPath` and verified with the `--test` command
   you gave it (if you didn't give one, the patch is honestly marked untested — it
   is never silently marked "passed"). **Requirement:** `repo-path` must be the
   actual ROOT of a git repository — otherwise registration is rejected (being
   inside a parent repo is not enough).

## 9. Context Map (ADR-016 Decision 6 + ADR-019)

The "Context Map" (called "Bağlam Haritası" in the Turkish UI) tab on the desktop
shows your chats/agent runs as a **curated, historical** graph — nodes: chat, run,
project, model (with a local/API distinction), agent, week; edges: the
agent→run→model triple, same-day adjacency, curation (pin/link/membership).

- **Curated pinning:** the moment you decide "let's add this to the map," a
  permanent node is born — by clicking a node on the desktop and choosing
  "Pin to map," by typing `/harita [title]` in the **TUI** on an active chat/run
  screen and pressing Enter (this is NOT sent to the model — you get a one-line
  confirmation), or from the **command line** for any past session/run:
  `symphony harita ekle <sessionId|runId> [--baslik X]` (an id prefix is enough,
  the SAME convenience as the short-id in `symphony history`). A pinned item is
  NEVER auto-deleted and is exempt from weekly folding (see below).
- **Grouping and linking:** on the desktop, use the "Group"/"Link"/"Add member"/
  "Detach" buttons to connect nodes to each other or collect them under a group.
  `symphony harita liste` lists pinned contexts and groups in order (when added,
  what they point to).
- **Weekly folding:** items outside the current ISO week (and not pinned) are not
  shown individually — they fold into a SINGLE node per week, laid out
  chronologically along the bottom edge of the map. This keeps the map from
  turning into clutter as it grows; click on a past week and "Open week" to
  drill down into that week's full graph. Nothing is ever deleted from the
  database — folding is purely a VIEW rule.
- **`symphony sync` does NOT carry curation (by design):** pins/groups on the map
  live in the local SQLite database (`~/.symphony/data/`) — this is a natural
  extension of sync's "the database is never synced" rule (see §7). Multi-machine
  curation sharing may come later as a separate export/import command (JSON); for
  now, the map keeps its own curation on each machine.
