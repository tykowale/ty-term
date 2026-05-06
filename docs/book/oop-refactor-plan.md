# OOP Book Refactor Plan

This plan is the continuity reference for the book-wide object-oriented refactor.
Every chapter update should read this file first, then read the immediately
previous chapter before editing. The goal is not to add ceremony. The goal is to
teach a clean architecture while the codebase is still small enough for readers
to understand.

## Problem

The first draft of the book keeps adding exported functions, types, and helpers
without clear owners, while `src/cli.ts` absorbs more and more orchestration.
That keeps early chapters short, but it teaches the wrong architecture:

- `cli.ts` becomes a mix of process I/O, argument parsing, dependency creation,
  and agent behavior.
- Standalone functions such as `createUserMessage()`, `runTurn()`,
  `renderTranscript()`, `createToolRegistry()`, and `executeTool()` hide the
  object boundaries that a maintainable coding harness needs.

The refactor should move the book toward named objects with clear ownership.

## Architectural Direction

Use a small OOP spine:

```text
src/
  cli.ts

  agent/
    agent-message.ts
    agent-message-factory.ts
    conversation.ts
    agent-loop.ts

  model/
    model-client.ts
    echo-model-client.ts
    openai-model-client.ts
    model-context.ts

  tools/
    tool.ts
    tool-registry.ts
    current-directory-tool.ts
    bash-tool.ts
    read-file-tool.ts
    tool-request-parser.ts

  session/
    session-store.ts
    jsonl-session-store.ts

  project/
    project-instructions.ts

  terminal/
    interactive-loop.ts
    parse-args.ts
```

The exact file set can grow chapter by chapter. Do not introduce future files
before the chapter needs them.

## Ownership Rules

- `AgentMessageFactory` owns construction of user, assistant, and later tool
  messages.
- `Conversation` owns ordered message history, transcript rendering, appending
  messages, and serialization-safe access to messages.
- `Conversation` may own a simple early `runTurn()` while the assistant response
  is fake or directly injected, but it should not become the final god object.
- `AgentLoop` owns orchestration once model calls, tool execution, model
  context, sessions, and project instructions interact.
- `ModelClient` is an interface. Concrete providers are classes:
  `EchoModelClient` and `OpenAIModelClient`.
- `ToolRegistry` is a class that owns lookup and execution dispatch.
- Tools are objects that implement a shared `Tool` interface.
- `SessionStore` is an interface. `JsonlSessionStore` implements persistence.
- `ProjectInstructions` owns loading and formatting project instructions.
- `InteractiveLoop` owns terminal loop behavior.
- `cli.ts` only parses process arguments, composes dependencies, handles process
  I/O, and calls the relevant object.

The long-term dependency direction should be:

```text
cli -> terminal/session/agent/model/tools/project
terminal -> agent/session
session -> agent
agent -> model/tools/project
tools -> platform helpers
model -> provider SDKs
```

Avoid cycles. If a class needs too many dependencies, move orchestration upward
instead of pushing more behavior into the lower-level class.

## Teaching Rules

- Each chapter should introduce one new object boundary or evolve one existing
  boundary.
- Explain ownership explicitly: what this class owns, what it refuses to own,
  and why.
- Keep complete code snippets, but do not dump large files before explaining the
  moving parts.
- Preserve runnable checkpoints: `bun install`, `bun run build`, `bun test`,
  and one CLI command where appropriate.
- Keep the book honest about simplifications. If a chapter temporarily puts a
  method on `Conversation`, name the future move to `AgentLoop`.
- Use import paths that match the new module layout.
- Preserve continuity with the previous chapter. Do not skip from standalone
  functions to final architecture without narrating the migration.

## Chapter Migration Plan

### Chapter 1: Start a Bun TypeScript CLI

Keep setup small. Chapter 1 may still use a placeholder response function, but
it should frame it as temporary scaffolding. The handoff should say Chapter 2
will replace the placeholder with `AgentMessageFactory` and `Conversation`.

Likely files:

- `src/cli.ts`
- `tests/respond-to-prompt.test.ts`

Oracle:

```bash
bun run dev -- "hello"
```

Expected output:

```text
agent heard: hello
```

### Chapter 2: Represent a Conversation

Replace standalone message functions with `AgentMessageFactory`. Replace the
conversation array alias with a `Conversation` class. The chapter should teach
why message construction and message history deserve named owners.

Likely files:

- `src/agent/agent-message.ts`
- `src/agent/agent-message-factory.ts`
- `src/agent/conversation.ts`
- `src/cli.ts`
- `tests/conversation.test.ts`

Example shape:

```ts
const messageFactory = new AgentMessageFactory();
const conversation = new Conversation(messageFactory);

conversation.runTurn("hello");

console.log(conversation.renderTranscript());
```

Chapter 2 can let `Conversation.runTurn()` create the fake assistant response.
The chapter must explain that this is temporary: when a real model and tools
arrive, orchestration will move to `AgentLoop`.

### Chapter 3: Call One Model Provider

Introduce the model boundary as objects, not factory functions. Add
`ModelClient`, `EchoModelClient`, and `OpenAIModelClient`. Decide whether
`Conversation.runTurn(prompt, modelClient)` is still acceptable for this chapter
or whether this is the right point to introduce `AgentLoop`.

Preferred direction: introduce `AgentLoop` here if it keeps `Conversation` from
depending on model clients.

Likely files:

- `src/agent/agent-loop.ts`
- `src/model/model-client.ts`
- `src/model/echo-model-client.ts`
- `src/model/openai-model-client.ts`
- existing `agent` files
- `src/cli.ts`
- tests around `AgentLoop`

### Chapter 4: Add a Tool Boundary

Introduce `Tool` and `ToolRegistry` as objects. Avoid loose helpers such as
`createToolRegistry()`, `getTool()`, and `executeTool()`.

Likely files:

- `src/tools/tool.ts`
- `src/tools/tool-registry.ts`
- `src/tools/current-directory-tool.ts`
- `src/agent/agent-loop.ts`
- `src/cli.ts`

`AgentLoop` should receive a registry dependency only when a chapter needs it.

### Chapter 5: Execute a Bash Tool

Add `BashTool` and a narrow command execution boundary. Keep process execution
behind the tool object. Do not mix command execution into `AgentLoop` or `cli.ts`.

Likely files:

- `src/tools/bash-tool.ts`
- optional `src/tools/command-executor.ts`
- existing tool registry files
- tests for command execution behavior

### Chapter 6: Let the Model Use Tools

This is the chapter where `AgentLoop` becomes clearly necessary. Replace
`runTurnWithTools()` with `agentLoop.runTurn(conversation, prompt)`.

`AgentLoop` owns:

- appending the user message
- calling the model
- parsing a tool request
- asking `ToolRegistry` to execute the tool
- appending the tool result
- calling the model again
- appending the final assistant message

`Conversation` still owns storing and rendering messages.

### Chapter 7: Read Project Files

Add `ReadFileTool` as another tool object. Put project-root resolution and
path-safety decisions near this tool, not in `cli.ts` and not in `AgentLoop`.

Likely files:

- `src/tools/read-file-tool.ts`
- optional project-root helper if needed
- tests with temporary directories

### Chapter 8: Persist Sessions as JSONL

Introduce `SessionStore` and `JsonlSessionStore`. Persistence should load and
save conversation messages. It should not own model calls or tool execution.

Likely files:

- `src/session/session-store.ts`
- `src/session/jsonl-session-store.ts`
- `src/agent/conversation.ts`
- `src/cli.ts`

The chapter should explain serialization boundaries: classes own behavior, but
JSONL stores plain message records.

### Chapter 9: Load Project Instructions

Introduce `ProjectInstructions` and `ModelContext`. Keep instructions separate
from persisted conversation history unless the chapter intentionally teaches
system messages.

Likely files:

- `src/project/project-instructions.ts`
- `src/model/model-context.ts`
- `src/agent/agent-loop.ts`
- `src/model/openai-model-client.ts`

### Chapter 10: Build a Tiny Interactive Loop

Move interactive terminal behavior into `InteractiveLoop`. `cli.ts` should only
compose dependencies and call it.

Likely files:

- `src/terminal/interactive-loop.ts`
- `src/terminal/parse-args.ts`
- `src/cli.ts`

`InteractiveLoop` owns repeated prompting, appended-message display, and session
continuity. It should delegate actual agent behavior to `AgentLoop`.

## Worker Instructions

For each chapter worker:

1. Read this file.
2. Read the immediately previous chapter.
3. Read the chapter you are editing.
4. Preserve continuity with prior terminology and code.
5. Edit only the assigned chapter unless a local index or cross-reference must
   be updated.
6. Do not revert changes made by other workers.
7. Keep code snippets coherent with the new OOP spine.
8. Report changed files and any unresolved continuity concerns.
