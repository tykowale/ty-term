# Build a Minimal Terminal Coding Harness

This book builds `ty-term`, a tiny terminal coding harness, from an empty directory into a small agent-like CLI.

The reference project is `pi-mono`, but this is not a clone. Each chapter extracts one concept from a real coding agent and rebuilds it in the smallest runnable form.

## Target

By the end, you will have a TypeScript command-line program that can:

- keep a conversation as structured messages
- call one model provider
- expose tools behind a typed boundary
- run a bash command as a tool
- let the model request and consume tool results
- read project files
- persist sessions as JSONL
- load project instructions
- run in a tiny interactive loop

The production concerns in `pi-mono`, such as rich TUI rendering, optional extensions, OAuth flows, branchable session trees, compaction, and multiple model providers, are intentionally out of scope for the core book.

## Book Rule

Chapter 1 owns setup. If a later chapter needs a new dependency, Chapter 1 must be revised so a fresh reader installs all dependencies up front.

## Core Chapters

1. [Start a TypeScript CLI](01-start-a-typescript-cli-workspace.md)
2. [Represent a Conversation](02-represent-a-conversation.md)
3. [Call One Model Provider](03-call-one-model-provider.md)
4. [Add a Tool Boundary](04-add-a-tool-boundary.md)
5. [Execute a Bash Tool](05-execute-a-bash-tool.md)
6. [Let the Model Use Tools](06-let-the-model-use-tools.md)
7. [Read Project Files](07-read-project-files.md)
8. [Persist Sessions as JSONL](08-persist-sessions-as-jsonl.md)
9. [Load Project Instructions](09-load-project-instructions.md)
10. [Build a Tiny Interactive Loop](10-build-a-tiny-interactive-loop.md)

## Reference Distillation

`pi-mono` separates provider access, the generic agent loop, coding-agent session behavior, tool execution, session persistence, and terminal UI. This book keeps that sequence but collapses it into one package so the core behavior stays visible.

The spine artifacts that grow across the book are:

- `AgentMessage`
- `Conversation`
- `ModelClient`
- `ToolDefinition`
- `AgentLoop`
- `SessionStore`
- `ProjectContext`

The first chapter creates the package and a fake response function. Chapter 2 replaces that fake prompt string with a real conversation shape.
