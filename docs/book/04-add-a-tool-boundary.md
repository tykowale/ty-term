# Chapter 4: Add a Tool Boundary

## Where We Are

At the end of Chapter 3, `ty-term` can hold a conversation, render a transcript, and run one model turn through either an echo model or OpenAI. The CLI has two modes:

- default: echo model
- `--openai`: real model call

What it cannot do yet is describe an action the harness could take outside the model.

That is the next boundary. We are not running shell commands yet. We are only giving the program a typed way to name a tool, register it, look it up, and execute a harmless toy tool.

## Learning Objective

Understand that tools are not magic model behavior. In our harness, a tool is just a typed object with:

- a stable name
- a human-readable description
- an async `execute` function

The observable slice is small: `--tool cwd` prints the current directory and exits.

```text
tool cwd: /some/current/directory
```

Normal prompts still run the model turn exactly like Chapter 3.

## Build The Slice

Change three files:

- `src/index.ts`
- `src/cli.ts`
- `tests/agent.test.ts`

No new dependencies. No shell execution.

## `src/index.ts`

```ts
import OpenAI from "openai";

export type AgentRole = "user" | "assistant";

export interface AgentMessage {
  role: AgentRole;
  content: string;
}

export type Conversation = AgentMessage[];

export interface ModelClient {
  createResponse(prompt: string, conversation: Conversation): Promise<string>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  execute(input?: string): Promise<string>;
}

export type ToolRegistry = ReadonlyMap<string, ToolDefinition>;

export function createUserMessage(content: string): AgentMessage {
  return { role: "user", content };
}

export function createAssistantMessage(content: string): AgentMessage {
  return { role: "assistant", content };
}

export function createEchoModelClient(): ModelClient {
  return {
    async createResponse(prompt: string): Promise<string> {
      return `agent heard: ${prompt}`;
    },
  };
}

export function createOpenAIModelClient(
  model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
): ModelClient {
  const client = new OpenAI();

  return {
    async createResponse(
      prompt: string,
      conversation: Conversation,
    ): Promise<string> {
      const response = await client.responses.create({
        model,
        input: [
          ...conversation.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          { role: "user", content: prompt },
        ],
      });

      return response.output_text;
    },
  };
}

export async function runTurn(
  conversation: Conversation,
  prompt: string,
  modelClient: ModelClient,
): Promise<Conversation> {
  const userMessage = createUserMessage(prompt);
  const assistantContent = await modelClient.createResponse(
    prompt,
    conversation,
  );
  const assistantMessage = createAssistantMessage(assistantContent);

  return [...conversation, userMessage, assistantMessage];
}

export function renderTranscript(conversation: Conversation): string {
  return conversation
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
}

export function createCurrentDirectoryTool(options?: {
  cwd?: string;
}): ToolDefinition {
  const cwd = options?.cwd ?? process.cwd();

  return {
    name: "cwd",
    description: "Return the current working directory.",
    async execute() {
      return cwd;
    },
  };
}

export function createToolRegistry(
  tools: readonly ToolDefinition[],
): ToolRegistry {
  const registry = new Map<string, ToolDefinition>();

  for (const tool of tools) {
    if (registry.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }

    registry.set(tool.name, tool);
  }

  return registry;
}

export function getTool(
  registry: ToolRegistry,
  name: string,
): ToolDefinition | undefined {
  return registry.get(name);
}

export async function executeTool(
  registry: ToolRegistry,
  name: string,
  input?: string,
): Promise<string> {
  const tool = getTool(registry, name);

  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  return tool.execute(input);
}
```

## `src/cli.ts`

```ts
#!/usr/bin/env node

import {
  type Conversation,
  createCurrentDirectoryTool,
  createEchoModelClient,
  createOpenAIModelClient,
  createToolRegistry,
  executeTool,
  renderTranscript,
  runTurn,
} from "./index";

interface ParsedArgs {
  useOpenAI: boolean;
  toolName?: string;
  prompt: string;
}

function parseArgs(args: string[]): ParsedArgs {
  let useOpenAI = false;
  let toolName: string | undefined;
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--openai") {
      useOpenAI = true;
      continue;
    }

    if (arg === "--tool") {
      toolName = args[index + 1];
      index += 1;
      continue;
    }

    promptParts.push(arg);
  }

  return { useOpenAI, toolName, prompt: promptParts.join(" ") };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.toolName) {
    const registry = createToolRegistry([createCurrentDirectoryTool()]);
    const result = await executeTool(registry, parsed.toolName);
    process.stdout.write(`tool ${parsed.toolName}: ${result}\n`);
    return;
  }

  if (parsed.prompt.length === 0) {
    console.error('Usage: bun run dev -- [--openai] "your prompt"');
    process.exit(1);
  }

  if (parsed.useOpenAI && !process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required when using --openai.");
    process.exit(1);
  }

  const modelClient = parsed.useOpenAI
    ? createOpenAIModelClient()
    : createEchoModelClient();
  const conversation: Conversation = [];
  const nextConversation = await runTurn(
    conversation,
    parsed.prompt,
    modelClient,
  );

  process.stdout.write(`${renderTranscript(nextConversation)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
```

Tool mode is a separate CLI path. It does not replace the normal prompt path.

## `tests/agent.test.ts`

```ts
import { describe, expect, it } from "bun:test";
import {
  createCurrentDirectoryTool,
  createEchoModelClient,
  createToolRegistry,
  executeTool,
  getTool,
  renderTranscript,
  runTurn,
  type Conversation,
} from "../src/index";

describe("agent turn", () => {
  it("keeps the chapter 3 prompt contract stable", async () => {
    const conversation = await runTurn([], "hello", createEchoModelClient());
    expect(renderTranscript(conversation)).toBe(
      "user: hello\nassistant: agent heard: hello",
    );
  });

  it("does not mutate the previous conversation", async () => {
    const original: Conversation = [{ role: "user", content: "earlier" }];
    await runTurn(original, "next", createEchoModelClient());
    expect(original).toEqual([{ role: "user", content: "earlier" }]);
  });
});

describe("tool registry", () => {
  it("stores tools by name", () => {
    const cwdTool = createCurrentDirectoryTool({ cwd: "/learn/harness" });
    const registry = createToolRegistry([cwdTool]);
    expect(getTool(registry, "cwd")).toBe(cwdTool);
  });

  it("rejects duplicate tool names", () => {
    expect(() =>
      createToolRegistry([
        createCurrentDirectoryTool({ cwd: "/one" }),
        createCurrentDirectoryTool({ cwd: "/two" }),
      ]),
    ).toThrow("Duplicate tool name: cwd");
  });

  it("executes a named tool", async () => {
    const registry = createToolRegistry([
      createCurrentDirectoryTool({ cwd: "/learn/harness" }),
    ]);
    await expect(executeTool(registry, "cwd")).resolves.toBe("/learn/harness");
  });

  it("reports unknown tools", async () => {
    const registry = createToolRegistry([]);
    await expect(executeTool(registry, "missing")).rejects.toThrow(
      "Unknown tool: missing",
    );
  });
});
```

The first test is a smoke test for output drift. Future chapters should not accidentally change the prompt contract while adding tool behavior.

## Try It

Build:

```bash
bun run build
```

Run tests:

```bash
bun test
```

Run a normal prompt:

```bash
bun run dev -- "hello tools"
```

Expected output:

```text
user: hello tools
assistant: agent heard: hello tools
```

Now inspect the toy tool:

```bash
bun run dev -- --tool cwd
```

Expected shape:

```text
tool cwd: /path/to/ty-term
```

The exact path depends on where you run the package script from. In the normal book flow, run commands from `ty-term`, so the process working directory is the package root.

## How It Works

The new spine artifact is `ToolDefinition`:

```ts
export interface ToolDefinition {
  name: string;
  description: string;
  execute(input?: string): Promise<string>;
}
```

This is deliberately smaller than a real coding agent tool system. The model does not choose a tool. The conversation does not contain tool calls. The CLI directly asks for one tool by name with `--tool cwd`.

That gives us the boundary without the full agent loop.

The registry is also plain:

```ts
export type ToolRegistry = ReadonlyMap<string, ToolDefinition>;
```

`createToolRegistry` validates duplicate names once. `getTool` makes lookup inspectable. `executeTool` centralizes the unknown-tool error instead of spreading that check through the CLI.

The toy tool is safe because it does not touch the shell:

```ts
export function createCurrentDirectoryTool(options?: {
  cwd?: string;
}): ToolDefinition {
  const cwd = options?.cwd ?? process.cwd();

  return {
    name: "cwd",
    description: "Return the current working directory.",
    async execute() {
      return cwd;
    },
  };
}
```

The configurable `cwd` is there for tests. Tests should not depend on the machine's real working directory when the behavior being tested is "the tool result is returned."

## Reference Note

Compare this chapter with:

- `pi-mono/packages/coding-agent/src/core/tools/index.ts`
- `pi-mono/packages/coding-agent/src/core/tools/read.ts`
- `pi-mono/packages/agent/src/agent-loop.ts`

`pi-mono` has richer boundaries around schemas, rendering, tool-call preparation, tool-result messages, and extension hooks. For this chapter, we keep only the smallest idea:

> a tool is a named async capability behind a typed boundary.

We are extracting one concept, not copying the reference architecture.

## Simplifications

This chapter intentionally does not:

- let the model request tools
- add tool calls to the conversation transcript
- execute shell commands
- parse structured tool input
- stream tool output
- add permissions, approval, cancellation, or timeouts

The only visible behavior is manual tool execution through the CLI.

That is enough to see where tools live in the program before the tools become powerful.

## Handoff to Chapter 5

Chapter 5 replaces the toy-only world with the first real external action: a bash command tool.

The likely next slice:

- add a `createBashTool()`
- accept a command string as tool input
- run it through Node's child process APIs
- return stdout, stderr, and exit status in a controlled format
- keep the CLI oracle inspectable, for example:

```bash
bun run dev -- --tool bash "pwd"
```

Chapter 5 should still avoid a full autonomous loop. The next lesson is command execution as a boundary, not model-driven tool use yet.
