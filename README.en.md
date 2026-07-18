# 🎼 Symphony

*[🇹🇷 Türkçe sürüm](README.md)*

An orchestration platform that manages local and cloud LLMs, agents, and software
projects from one place — able to touch code and improve itself. Runs on
Windows / macOS / ARM; the terminal (`symphony`) and the desktop app are two
simultaneous interfaces connected to the same core.

> This file is a translation of the Turkish original (`README.md`) for a worldwide
> audience. The project's internal documents (linked below) are authored in Turkish
> first, since the project itself is developed in Turkish; this page exists so
> English-speaking visitors can navigate the repo and find the user guide.

## Documentation

| File | What it's for |
|---|---|
| [docs/REHBER.en.md](docs/REHBER.en.md) | **User & architecture guide (English)** — what Symphony is, how it works, command reference |
| [CLAUDE.md](CLAUDE.md) | **Project constitution** (Turkish) — rules every AI model working in this repo follows |
| [ROADMAP.md](ROADMAP.md) | Vision, architecture, phases (0–8) and acceptance tests per phase (Turkish) |
| [docs/PROTOKOL.md](docs/PROTOKOL.md) | Daemon ⇄ client communication protocol spec (Turkish) |
| [docs/SPEC-AGENT.md](docs/SPEC-AGENT.md) | Agent engine + permission system spec (Turkish) |
| [docs/kararlar/KARARLAR.md](docs/kararlar/KARARLAR.md) | Architecture decision records (ADR) — the "why" behind design choices (Turkish) |
| [docs/GEREKSINIMLER.md](docs/GEREKSINIMLER.md) | Full tool/library inventory, directory layout (Turkish) |
| [memo/DURUM.md](memo/DURUM.md) | **Where we left off** — every work session starts here (Turkish) |
| [memo/oturumlar/](memo/oturumlar/) | Session logs (a record of every work session, Turkish) |

## Getting started (end users)

```
npm install -g @lrgendie/cli
symphony
```

See [docs/REHBER.en.md](docs/REHBER.en.md) for the full install, sync, and update guide,
the command reference, and how the agent/permission system works. Prebuilt desktop
installers (Windows/macOS) are published under
[Releases](https://github.com/lrgendie/symphony/releases).

## Working conventions (contributors)

1. Every session starts by reading `memo/DURUM.md` — pick up from where things were left.
2. Work done during a session is recorded in a session log.
3. At the end of a session: `DURUM.md` is updated → commit → push (backup).
