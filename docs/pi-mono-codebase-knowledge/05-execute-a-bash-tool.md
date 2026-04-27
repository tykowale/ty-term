# Chapter 5: Execute a Bash Tool

## Where We Are

At the end of Chapter 4, `ty-term` has a tool boundary:

- `ToolDefinition`
- `ToolRegistry`
- `createCurrentDirectoryTool`
- `executeTool`
- CLI support for `--tool cwd`
- normal prompts still return `agent heard: ...`

That is enough structure to add the first real external action.

This chapter adds a `bash` tool, but it is still manually invoked:

```bash
npm run dev -- --tool bash "pwd"
```

The model does not choose commands yet. Running shell commands is powerful and risky, so this chapter keeps the command path explicit and inspectable.

## Learning Objective

Learn how a coding harness crosses from internal TypeScript objects into external machine action.

The new boundary is:

```ts
executeCommand(command, options?)
```

It runs a shell command with Node built-ins, captures `stdout`, `stderr`, and the exit code, then returns a controlled string.

By the end of the chapter, the harness can run:

```bash
npm run dev -- --tool bash "node -e \"process.stdout.write('ok')\""
```

and print a structured tool result.

## Build The Slice

Change three files:

- `src/index.ts`
- `src/cli.ts`
- `tests/agent.test.ts`

No new dependencies. We use `node:child_process`.

The new behavior should preserve the Chapter 4 prompt contract:

```text
assistant: agent heard: hello
```

## `src/index.ts`

```ts
import { spawn } from "node:child_process";
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

export interface CommandOptions {
  cwd?: string;
  timeoutMs?: number;
}

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

export async function executeCommand(
  command: string,
  options?: CommandOptions,
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 5000;

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(command, {
      cwd: options?.cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      const exitCode = timedOut ? "timeout" : String(code ?? 0);

      resolve(
        [
          `exit code: ${exitCode}`,
          "stdout:",
          stdout.trimEnd(),
          "stderr:",
          stderr.trimEnd(),
        ].join("\n"),
      );
    });
  });
}

export function createBashTool(options?: CommandOptions): ToolDefinition {
  return {
    name: "bash",
    description: "Run a bash command and return exit code, stdout, and stderr.",
    async execute(input?: string) {
      if (!input || input.trim().length === 0) {
        throw new Error("bash tool requires a command.");
      }

      return executeCommand(input, options);
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
  createBashTool,
  createCurrentDirectoryTool,
  createEchoModelClient,
  createOpenAIModelClient,
  createToolRegistry,
  executeTool,
  renderTranscript,
  runTurn,
} from "./index.js";

interface ParsedArgs {
  useOpenAI: boolean;
  toolName?: string;
  toolInput?: string;
  prompt: string;
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
      toolInput = args.slice(index + 2).join(" ");
      break;
    }

    promptParts.push(arg);
  }

  return {
    useOpenAI,
    toolName,
    toolInput,
    prompt: promptParts.join(" "),
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.toolName) {
    const registry = createToolRegistry([
      createCurrentDirectoryTool(),
      createBashTool(),
    ]);

    const result = await executeTool(
      registry,
      parsed.toolName,
      parsed.toolInput,
    );

    process.stdout.write(`tool ${parsed.toolName}:\n${result}\n`);
    return;
  }

  if (parsed.prompt.length === 0) {
    console.error(
      'Usage: npm run dev -- [--openai] "your prompt"',
    );
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

## `tests/agent.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  createBashTool,
  createCurrentDirectoryTool,
  createEchoModelClient,
  createToolRegistry,
  executeCommand,
  executeTool,
  getTool,
  renderTranscript,
  runTurn,
  type Conversation,
} from "../src/index.js";

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

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

    await expect(executeTool(registry, "cwd")).resolves.toBe(
      "/learn/harness",
    );
  });

  it("passes input to a named tool", async () => {
    const registry = createToolRegistry([
      createBashTool({ timeoutMs: 1000 }),
    ]);

    await expect(
      executeTool(
        registry,
        "bash",
        nodeCommand("process.stdout.write('ok')"),
      ),
    ).resolves.toContain("stdout:\nok");
  });

  it("reports unknown tools", async () => {
    const registry = createToolRegistry([]);

    await expect(executeTool(registry, "missing")).rejects.toThrow(
      "Unknown tool: missing",
    );
  });
});

describe("bash command execution", () => {
  it("captures stdout with an exit code", async () => {
    const result = await executeCommand(
      nodeCommand("process.stdout.write('ok')"),
      { timeoutMs: 1000 },
    );

    expect(result).toContain("exit code: 0");
    expect(result).toContain("stdout:\nok");
    expect(result).toContain("stderr:");
  });

  it("captures stderr and nonzero exit codes", async () => {
    const result = await executeCommand(
      nodeCommand("process.stderr.write('bad'); process.exit(7)"),
      { timeoutMs: 1000 },
    );

    expect(result).toContain("exit code: 7");
    expect(result).toContain("stderr:\nbad");
  });

  it("rejects empty bash tool input", async () => {
    const bashTool = createBashTool();

    await expect(bashTool.execute()).rejects.toThrow(
      "bash tool requires a command.",
    );
  });
});
```

## Try It

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run the normal prompt path:

```bash
npm run dev -- "hello bash"
```

Expected output:

```text
user: hello bash
assistant: agent heard: hello bash
```

Run the new bash tool:

```bash
npm run dev -- --tool bash "pwd"
```

Expected shape:

```text
tool bash:
exit code: 0
stdout:
/path/to/ty-term
stderr:
```

Run a deterministic Node command:

```bash
npm run dev -- --tool bash "node -e \"process.stdout.write('ok')\""
```

Expected output:

```text
tool bash:
exit code: 0
stdout:
ok
stderr:
```

Run a command that fails:

```bash
npm run dev -- --tool bash "node -e \"process.stderr.write('bad'); process.exit(7)\""
```

Expected shape:

```text
tool bash:
exit code: 7
stdout:

stderr:
bad
```

## How It Works

Chapter 4 taught the tool boundary. Chapter 5 makes that boundary touch the operating system.

The core function is:

```ts
export async function executeCommand(
  command: string,
  options?: CommandOptions,
): Promise<string>
```

It does not know about the CLI, the model, or conversations. It only knows how to run one command and turn the result into a stable string.

The implementation uses `spawn` with `shell: true`:

```ts
const child = spawn(command, {
  cwd: options?.cwd,
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
});
```

That lets the CLI pass a familiar command string:

```bash
--tool bash "pwd"
```

The tradeoff is safety. Shell strings can run destructive commands. That is why this chapter keeps bash manual. The model cannot produce or execute shell commands yet.

The output is intentionally plain:

```text
exit code: 0
stdout:
...
stderr:
...
```

That gives future chapters something easy to put into a transcript when tool results become part of the agent loop.

The timeout is small and boring on purpose:

```ts
const timeoutMs = options?.timeoutMs ?? 5000;
```

Tests can inject a shorter timeout, but we are not building a full process manager. No streaming, cancellation UI, approvals, sandboxing, or background jobs yet.

`createBashTool` adapts command execution into the existing `ToolDefinition` shape:

```ts
export function createBashTool(options?: CommandOptions): ToolDefinition {
  return {
    name: "bash",
    description: "Run a bash command and return exit code, stdout, and stderr.",
    async execute(input?: string) {
      if (!input || input.trim().length === 0) {
        throw new Error("bash tool requires a command.");
      }

      return executeCommand(input, options);
    },
  };
}
```

The CLI also learns one new parsing rule: after `--tool <name>`, the remaining arguments become tool input.

That means this works:

```bash
npm run dev -- --tool bash "pwd"
```

and this still works:

```bash
npm run dev -- "hello"
```

## Reference Note

In `pi-mono`, compare this slice with:

- `pi-mono/packages/coding-agent/src/core/bash-executor.ts`
- `pi-mono/packages/coding-agent/src/core/agent-session.ts`
- `pi-mono/packages/agent/src/agent-loop.ts`

A production coding harness has more machinery around command execution: approval, cancellation, streaming output, working-directory control, tool-call messages, and error recovery.

This chapter keeps only the essential idea:

> external actions should sit behind a narrow function boundary before they become part of the agent loop.

## Simplifications

This chapter intentionally does not:

- let the model choose bash commands
- add tool results to the conversation
- stream command output
- prompt for approval
- sandbox commands
- support interactive commands
- preserve long-running processes
- parse structured JSON tool input

The timeout is a learning guardrail, not a complete safety system.

## Handoff to Chapter 6

Chapter 6 can connect the model loop to the tool boundary.

The next slice should:

- teach the model what tools exist
- parse a simple model-produced tool request
- execute only registered tools
- append the tool result to the conversation
- keep bash gated behind a visible, conservative rule

Chapter 5 gave us real command execution. Chapter 6 decides when the agent is allowed to ask for it.
