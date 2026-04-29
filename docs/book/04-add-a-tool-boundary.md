# Chapter 4: Add a Tool Boundary

Chapter 3 gave the harness three important owners:

- `Conversation` owns ordered message history and transcript rendering.
- `AgentLoop` owns a model turn.
- `ModelClient` owns provider interaction.

The CLI could run the deterministic echo path:

```text
$ bun run dev -- "hello"
user: hello
assistant: agent heard: hello
```

Or it could opt into the real provider with `--openai`.

What the harness still cannot do is describe an action it can take outside the
model. A coding agent eventually needs to read files, inspect directories, and
run commands. Those actions should not become random helper functions in
`src/index.ts`, and they should not become ad hoc branches inside `cli.ts`.

This chapter adds the first tool boundary.

```text
src/
  agent/
    agent-loop.ts
    agent-message.ts
    agent-message-factory.ts
    conversation.ts
  model/
    echo-model-client.ts
    model-client.ts
    openai-model-client.ts
  tools/
    tool.ts
    tool-registry.ts
    current-directory-tool.ts
  cli.ts
  index.ts
tests/
  agent-loop.test.ts
  tool-registry.test.ts
```

The visible behavior is deliberately small:

```text
$ bun run dev -- --tool cwd
tool cwd: /path/to/ty-term
```

Normal prompts still run through `AgentLoop` exactly like Chapter 3:

```text
$ bun run dev -- "hello tools"
user: hello tools
assistant: agent heard: hello tools
```

The model does not choose tools yet. The conversation does not contain tool
calls yet. We are only carving out where tools live before they become powerful.

## The New Ownership Rule

The new object is `ToolRegistry`.

```text
Tool owns one capability.
ToolRegistry owns lookup and execution dispatch.
AgentLoop still owns model-turn orchestration.
cli.ts only composes objects and selects a top-level command path.
```

That last point matters. It would be easy to write this chapter as a handful of
helpers:

```ts
createToolRegistry();
getTool();
executeTool();
createCurrentDirectoryTool();
```

Those helpers are short, but they teach the wrong shape. A registry is not just
a map. It owns invariants:

- tool names must be unique
- unknown tools should fail consistently
- callers should not mutate the registered tool set by accident
- execution should go through one dispatch point

When an object owns those rules, future tools can grow without scattering lookup
logic across the CLI, the agent loop, and tests.

## A Tool Is A Named Object

Start with the smallest useful tool interface in `src/tools/tool.ts`:

```ts
export interface Tool {
  readonly name: string;
  readonly description: string;

  execute(input?: string): Promise<string>;
}
```

This is intentionally plain. A tool has a stable name, a description the harness
can show to a user or model later, and an async `execute()` method.

The method is async even though this chapter's first tool is instant. Future
tools will read files and run processes, so the boundary should already have
the shape real tools need.

We are not adding schemas, permissions, streaming output, cancellation, or
structured result objects yet. Those are real concerns, but they would hide the
first idea:

```text
a tool is a named async capability behind a typed boundary
```

## The First Tool

The safest possible tool is one that reports the current working directory.

`src/tools/current-directory-tool.ts`:

```ts
import type { Tool } from "@/tools/tool";

export class CurrentDirectoryTool implements Tool {
  public readonly name = "cwd";
  public readonly description = "Return the current working directory.";

  constructor(private readonly cwd = process.cwd()) {}

  async execute(): Promise<string> {
    return this.cwd;
  }
}
```

This class is tiny, but it is doing real architectural work.

`CurrentDirectoryTool` owns the implementation of the `cwd` capability. The
registry should not know how to compute a current directory. The CLI should not
know how to compute it either. They only know that there is a tool named `cwd`
and that executing it returns text.

The constructor accepts `cwd` so tests can be deterministic:

```ts
new CurrentDirectoryTool("/learn/harness");
```

Tests should not depend on the machine's actual working directory when the
behavior being tested is tool dispatch.

## The Registry Owns Tool Dispatch

Now add `src/tools/tool-registry.ts`:

```ts
import type { Tool } from "@/tools/tool";

export class ToolRegistry {
  private readonly toolsByName = new Map<string, Tool>();

  constructor(tools: readonly Tool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: Tool): void {
    if (this.toolsByName.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }

    this.toolsByName.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.toolsByName.get(name);
  }

  list(): Tool[] {
    return [...this.toolsByName.values()];
  }

  async execute(name: string, input?: string): Promise<string> {
    const tool = this.get(name);

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return tool.execute(input);
  }
}
```

Read that class by its responsibilities:

- `register()` owns duplicate-name validation.
- `get()` owns lookup.
- `list()` exposes a safe snapshot of registered tools.
- `execute()` owns unknown-tool errors and dispatches to the tool object.

The registry does not know what a current directory is. It does not know how to
run bash. It does not know how to read a file. That is the point of the
boundary: the registry manages tools, while each tool implements one
capability.

The registry also does not return its internal `Map`. Returning the map would
let callers mutate the registered tools from the outside. A chapter this small
is a good place to teach that habit: expose behavior, not internal storage.

## The Barrel File Stays Boring

`src/index.ts` should export the new objects, not implement them:

```ts
export { AgentLoop } from "@/agent/agent-loop";
export type { AgentMessage, AgentRole } from "@/agent/agent-message";
export { AgentMessageFactory } from "@/agent/agent-message-factory";
export { Conversation } from "@/agent/conversation";
export { EchoModelClient } from "@/model/echo-model-client";
export type { ModelClient } from "@/model/model-client";
export { OpenAIModelClient } from "@/model/openai-model-client";
export { CurrentDirectoryTool } from "@/tools/current-directory-tool";
export type { Tool } from "@/tools/tool";
export { ToolRegistry } from "@/tools/tool-registry";
```

This is the only role `index.ts` gets. It is a public import surface, not a
place to hide behavior that did not have an obvious home.

## The CLI Proves The Boundary

This chapter does not pass `ToolRegistry` into `AgentLoop` yet.

That may feel surprising. We just added tools, and the loop is the agent
orchestrator. Shouldn't the loop receive the registry immediately?

Not yet. In this chapter, the model is not choosing tools. There is no tool-call
syntax, no parser, no tool result message, and no second model call after a tool
result. If we inject the registry into `AgentLoop` now, the dependency would sit
there unused or force the loop to learn behavior that belongs in Chapter 6.

So Chapter 4 uses a manual CLI path:

```text
--tool cwd
```

That path proves `ToolRegistry` can register, find, and execute a named tool.
Normal prompts still go through `AgentLoop`.

`src/cli.ts`:

```ts
#!/usr/bin/env bun

import {
  AgentLoop,
  AgentMessageFactory,
  Conversation,
  CurrentDirectoryTool,
  EchoModelClient,
  OpenAIModelClient,
  ToolRegistry,
} from "@/index";

interface ParsedArgs {
  readonly useOpenAI: boolean;
  readonly toolName?: string;
  readonly toolInput?: string;
  readonly prompt: string;
}

function parseArgs(args: string[]): ParsedArgs {
  let useOpenAI = false;
  let toolName: string | undefined;
  let toolInput: string | undefined;
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--openai") {
      useOpenAI = true;
      continue;
    }

    if (arg === "--tool") {
      toolName = args[index + 1];
      toolInput = args[index + 2];
      index += toolInput === undefined ? 1 : 2;
      continue;
    }

    promptParts.push(arg);
  }

  return { useOpenAI, toolName, toolInput, prompt: promptParts.join(" ") };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.toolName) {
    const toolRegistry = new ToolRegistry([new CurrentDirectoryTool()]);
    const result = await toolRegistry.execute(
      parsed.toolName,
      parsed.toolInput,
    );

    process.stdout.write(`tool ${parsed.toolName}: ${result}\n`);
    return;
  }

  if (parsed.prompt.length === 0) {
    console.error('Usage: bun run dev -- [--openai] "your prompt"');
    console.error("       bun run dev -- --tool cwd");
    process.exit(1);
  }

  if (parsed.useOpenAI && !process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required when using --openai.");
    process.exit(1);
  }

  const messageFactory = new AgentMessageFactory();
  const modelClient = parsed.useOpenAI
    ? new OpenAIModelClient()
    : new EchoModelClient();
  const agentLoop = new AgentLoop(messageFactory, modelClient);
  const conversation = new Conversation();

  await agentLoop.runTurn(conversation, parsed.prompt);

  console.log(conversation.renderTranscript());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
```

The CLI still has process-level responsibilities:

- read process arguments
- choose the top-level mode
- construct process dependencies
- print output
- turn thrown errors into stderr and a non-zero exit

It does not own tool lookup rules. It does not inspect a map. It does not know
how `cwd` is implemented. It builds a registry and asks the registry to execute
a named tool.

That is the distinction to preserve as the harness grows:

```text
cli.ts composes the registry
ToolRegistry dispatches the tool
CurrentDirectoryTool implements the behavior
```

## Tests For The Boundary

Keep the Chapter 3 agent-loop tests. Chapter 4 should not change the prompt
contract.

Add focused tests for the tool boundary in `tests/tool-registry.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { CurrentDirectoryTool, ToolRegistry, type Tool } from "@/index";

describe("CurrentDirectoryTool", () => {
  it("returns the configured current directory", async () => {
    const tool = new CurrentDirectoryTool("/learn/harness");

    await expect(tool.execute()).resolves.toBe("/learn/harness");
  });
});

describe("ToolRegistry", () => {
  it("stores tools by name", () => {
    const cwdTool = new CurrentDirectoryTool("/learn/harness");
    const registry = new ToolRegistry([cwdTool]);

    expect(registry.get("cwd")).toBe(cwdTool);
  });

  it("lists registered tools without exposing registry storage", () => {
    const cwdTool = new CurrentDirectoryTool("/learn/harness");
    const registry = new ToolRegistry([cwdTool]);

    expect(registry.list()).toEqual([cwdTool]);
  });

  it("rejects duplicate tool names", () => {
    expect(
      () =>
        new ToolRegistry([
          new CurrentDirectoryTool("/one"),
          new CurrentDirectoryTool("/two"),
        ]),
    ).toThrow("Duplicate tool name: cwd");
  });

  it("executes a named tool", async () => {
    const registry = new ToolRegistry([
      new CurrentDirectoryTool("/learn/harness"),
    ]);

    await expect(registry.execute("cwd")).resolves.toBe("/learn/harness");
  });

  it("passes optional input to the selected tool", async () => {
    class EchoInputTool implements Tool {
      public readonly name = "echo-input";
      public readonly description = "Return the provided input.";

      async execute(input?: string): Promise<string> {
        return input ?? "";
      }
    }

    const registry = new ToolRegistry([new EchoInputTool()]);

    await expect(registry.execute("echo-input", "hello")).resolves.toBe(
      "hello",
    );
  });

  it("reports unknown tools", async () => {
    const registry = new ToolRegistry();

    await expect(registry.execute("missing")).rejects.toThrow(
      "Unknown tool: missing",
    );
  });
});
```

These tests are small, but each one protects an ownership rule:

- `CurrentDirectoryTool` owns the `cwd` behavior.
- `ToolRegistry` owns name lookup.
- `ToolRegistry` rejects duplicate names.
- `ToolRegistry` owns execution dispatch.
- `ToolRegistry` reports unknown tools consistently.
- Tool input flows through the registry without the registry understanding it.

The last test is a small preview of Chapter 5. A bash tool will need a command
string as input, but the registry should not know what that command means.

## Try It

Install dependencies if needed:

```bash
bun install
```

Build:

```bash
bun run build
```

Run tests:

```bash
bun test
```

Run the normal prompt path:

```bash
bun run dev -- "hello tools"
```

Expected output:

```text
user: hello tools
assistant: agent heard: hello tools
```

Now inspect the tool path:

```bash
bun run dev -- --tool cwd
```

Expected shape:

```text
tool cwd: /path/to/ty-term
```

The exact path depends on where you run the package script from. In the normal
book flow, run commands from the `ty-term` package root.

Try an unknown tool:

```bash
bun run dev -- --tool missing
```

Expected shape:

```text
Unknown tool: missing
```

The process exits non-zero because the CLI catch block turns the registry error
into stderr.

## How It Works

The new tool path has this data flow:

```text
cli.ts
  -> new ToolRegistry([new CurrentDirectoryTool()])
  -> toolRegistry.execute("cwd")
  -> CurrentDirectoryTool.execute()
  -> print "tool cwd: ..."
```

The existing prompt path stays the same:

```text
cli.ts
  -> new AgentMessageFactory()
  -> new EchoModelClient() or new OpenAIModelClient()
  -> new AgentLoop(messageFactory, modelClient)
  -> new Conversation()
  -> await agentLoop.runTurn(conversation, prompt)
  -> conversation.renderTranscript()
```

Those paths are separate on purpose. Chapter 4 is about the tool boundary, not
about autonomous tool use.

If we wired tools into `AgentLoop` now, the loop would need answers to questions
we have not taught yet:

- How does the model ask for a tool?
- How do we parse that request?
- What message records the tool result?
- Does the model get another turn after the tool runs?
- What happens if the tool fails?

Those are Chapter 6 questions. For now, `ToolRegistry` can prove the boundary
without changing model orchestration.

## Simplifications

This chapter intentionally does not:

- let the model request tools
- add tool calls to the conversation transcript
- execute shell commands
- parse structured tool input
- stream tool output
- add permissions, approvals, cancellation, or timeouts
- persist tool results

The only visible behavior is manual tool execution through the CLI.

That is enough for one chapter. The reader can see where tools live, how they
are registered, how duplicate names are rejected, and how one execution path
works without mixing tool logic into `index.ts`, `cli.ts`, or `AgentLoop`.

## Handoff To Chapter 5

Chapter 4 gives the harness a tool boundary:

```text
Tool + ToolRegistry + CurrentDirectoryTool
```

Chapter 5 should add the first tool that performs an external action:
`BashTool`.

The likely next slice:

- add `src/tools/bash-tool.ts`
- optionally add `src/tools/command-executor.ts` if command execution needs its
  own injectable boundary
- accept a command string as tool input
- run the command behind the `BashTool` object, not in `cli.ts` or `AgentLoop`
- return stdout, stderr, and exit status in a controlled text format
- keep `ToolRegistry` as the only dispatch path
- keep model-driven tool use out of the book until Chapter 6

The likely CLI oracle is:

```bash
bun run dev -- --tool bash "pwd"
```

Chapter 5's continuity rule:

```text
cli.ts composes dependencies.
ToolRegistry dispatches tools.
BashTool owns process execution.
AgentLoop does not execute commands directly.
```
