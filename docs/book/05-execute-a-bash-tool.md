# Chapter 5: Execute a Bash Tool

Chapter 4 gave the harness a tool boundary:

```text
Tool + ToolRegistry + CurrentDirectoryTool
```

That boundary was intentionally modest. The CLI could ask the registry to run
one safe tool:

```bash
bun run dev -- --tool cwd
```

and the normal prompt path still went through `AgentLoop`:

```bash
bun run dev -- "hello tools"
```

What the harness still cannot do is cross from TypeScript into an external
machine action. A coding agent eventually needs to run commands. This chapter
adds that capability, but it keeps the shape conservative:

```bash
bun run dev -- --tool bash "pwd"
```

The model does not choose commands yet. The conversation does not contain tool
results yet. Chapter 6 owns that connection. Chapter 5 only teaches where
command execution belongs:

```text
cli.ts composes dependencies.
ToolRegistry dispatches named tools.
BashTool owns process execution.
AgentLoop does not execute commands directly.
```

The file layout grows by one tool:

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
    bash-tool.ts
    current-directory-tool.ts
    tool.ts
    tool-registry.ts
  cli.ts
tests/
  agent-loop.test.ts
  bash-tool.test.ts
  tool-registry.test.ts
```

The new visible behavior is:

```text
$ bun run dev -- --tool bash "node -e \"process.stdout.write('ok')\""
tool bash:
exit code: 0
stdout:
ok
stderr:
```

## Why Bash Is A Tool Object

Chapter 4's `Tool` interface was deliberately small:

```ts
export interface Tool {
  readonly name: string;
  readonly description: string;

  execute(input?: string): Promise<string>;
}
```

That is enough for bash. A bash command is just input to a tool named `bash`,
and the result is text the harness can print.

The tempting shortcut is to expose a loose helper:

```ts
executeCommand(command);
```

That helper would work, but it would also blur ownership. If command execution
is a top-level helper, every caller can start using it directly. Soon the CLI,
the agent loop, tests, and future session code all know too much about process
execution.

Instead, this chapter makes command execution part of `BashTool`:

```text
BashTool implements Tool.
ToolRegistry executes BashTool by name.
Callers pass command text through ToolRegistry.execute("bash", commandText).
```

That keeps the dangerous capability behind the same dispatch boundary as every
other tool.

## The Command Result Shape

Before writing the class, choose the output format. The command may succeed,
fail, print to stdout, print to stderr, or time out. The tool should return one
stable text block for all of those cases:

```text
exit code: 0
stdout:
ok
stderr:
```

For a failing command:

```text
exit code: 7
stdout:

stderr:
bad
```

The shape is plain on purpose. Chapter 6 can append this string to a
conversation as a tool result without inventing a richer event system yet.

## The Bash Tool

Create `src/tools/bash-tool.ts`:

```ts
import { spawn } from "node:child_process";
import type { Tool } from "@/tools/tool";

export interface CommandOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

export interface CommandResult {
  readonly exitCode: number | "timeout";
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (
  command: string,
  options?: CommandOptions,
) => Promise<CommandResult>;

export class BashTool implements Tool {
  public readonly name = "bash";
  public readonly description =
    "Run a bash command and return exit code, stdout, and stderr.";

  constructor(
    private readonly options: CommandOptions = {},
    private readonly runCommand: CommandRunner = runShellCommand,
  ) {}

  async execute(input?: string): Promise<string> {
    if (!input || input.trim().length === 0) {
      throw new Error("bash tool requires a command.");
    }

    const result = await this.runCommand(input, this.options);

    return formatCommandResult(result);
  }
}

export async function runShellCommand(
  command: string,
  options?: CommandOptions,
): Promise<CommandResult> {
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

      resolve({
        exitCode: timedOut ? "timeout" : (code ?? 0),
        stdout,
        stderr,
      });
    });
  });
}

export function formatCommandResult(result: CommandResult): string {
  return [
    `exit code: ${result.exitCode}`,
    "stdout:",
    result.stdout.trimEnd(),
    "stderr:",
    result.stderr.trimEnd(),
  ].join("\n");
}
```

Read this file by ownership.

`BashTool` owns the tool contract. It has the tool name, the description, input
validation, and the conversion from command result to tool output.

`runShellCommand()` owns the Node process details. It uses `spawn()` with
`shell: true` so the CLI can pass familiar command strings:

```bash
--tool bash "pwd"
```

The tradeoff is safety. A shell string can run destructive commands. That is
why this chapter keeps bash manually invoked. No model can ask for bash yet.

`formatCommandResult()` owns the text representation. Keeping formatting in one
place lets tests assert the result shape without depending on child process
events.

The constructor accepts a `CommandRunner`:

```ts
constructor(
  private readonly options: CommandOptions = {},
  private readonly runCommand: CommandRunner = runShellCommand,
) {}
```

That is not extra architecture for its own sake. It gives tests a clean way to
exercise `BashTool` without spawning a process, while still letting the real CLI
use the real shell runner.

## The CLI Composes The New Tool

The CLI already has a manual tool path from Chapter 4:

```text
--tool cwd
```

Chapter 5 keeps that path and registers one more tool:

```ts
#!/usr/bin/env bun

import { AgentLoop } from "@/agent/agent-loop";
import { AgentMessageFactory } from "@/agent/agent-message-factory";
import { Conversation } from "@/agent/conversation";
import { EchoModelClient } from "@/model/echo-model-client";
import { OpenAIModelClient } from "@/model/openai-model-client";
import { BashTool } from "@/tools/bash-tool";
import { CurrentDirectoryTool } from "@/tools/current-directory-tool";
import { ToolRegistry } from "@/tools/tool-registry";

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
      toolInput = args.slice(index + 2).join(" ");
      break;
    }

    promptParts.push(arg);
  }

  return { useOpenAI, toolName, toolInput, prompt: promptParts.join(" ") };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.toolName) {
    const toolRegistry = new ToolRegistry([
      new CurrentDirectoryTool(),
      new BashTool(),
    ]);

    const result = await toolRegistry.execute(
      parsed.toolName,
      parsed.toolInput,
    );

    process.stdout.write(`tool ${parsed.toolName}:\n${result}\n`);
    return;
  }

  if (parsed.prompt.length === 0) {
    console.error('Usage: bun run dev -- [--openai] "your prompt"');
    console.error("       bun run dev -- --tool cwd");
    console.error('       bun run dev -- --tool bash "pwd"');
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

Two details are worth calling out.

First, tool input becomes the rest of the command line:

```ts
toolInput = args.slice(index + 2).join(" ");
```

That lets this command arrive as one string:

```bash
bun run dev -- --tool bash "node -e \"process.stdout.write('ok')\""
```

Second, the CLI still does not execute bash. It only composes the registry and
asks for dispatch:

```ts
const result = await toolRegistry.execute(parsed.toolName, parsed.toolInput);
```

That line is the chapter's architectural checkpoint. If future code bypasses
the registry and calls `runShellCommand()` from `cli.ts` or `AgentLoop`, the
boundary has leaked.

## Tests For Command Execution

Keep the Chapter 4 registry tests. They still prove duplicate-name validation,
unknown-tool errors, and registry dispatch.

Add focused bash tests in `tests/bash-tool.test.ts`:

```ts
import {
  BashTool,
  formatCommandResult,
  runShellCommand,
  type CommandRunner,
} from "@/tools/bash-tool";
import { ToolRegistry } from "@/tools/tool-registry";

function nodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

describe("BashTool", () => {
  it("uses the injected command runner", async () => {
    const runCommand: CommandRunner = async (command) => ({
      exitCode: 0,
      stdout: `ran ${command}`,
      stderr: "",
    });

    const tool = new BashTool({ timeoutMs: 1000 }, runCommand);

    await expect(tool.execute("pwd")).resolves.toBe(
      ["exit code: 0", "stdout:", "ran pwd", "stderr:", ""].join("\n"),
    );
  });

  it("rejects empty input", async () => {
    const tool = new BashTool();

    await expect(tool.execute()).rejects.toThrow(
      "bash tool requires a command.",
    );
    await expect(tool.execute("   ")).rejects.toThrow(
      "bash tool requires a command.",
    );
  });
});

describe("runShellCommand", () => {
  it("captures stdout with an exit code", async () => {
    const result = await runShellCommand(
      nodeCommand("process.stdout.write('ok')"),
      { timeoutMs: 1000 },
    );

    expect(result).toEqual({ exitCode: 0, stdout: "ok", stderr: "" });
  });

  it("captures stderr and nonzero exit codes", async () => {
    const result = await runShellCommand(
      nodeCommand("process.stderr.write('bad'); process.exit(7)"),
      { timeoutMs: 1000 },
    );

    expect(result).toEqual({ exitCode: 7, stdout: "", stderr: "bad" });
  });
});

describe("formatCommandResult", () => {
  it("renders a stable tool result", () => {
    expect(
      formatCommandResult({ exitCode: 7, stdout: "", stderr: "bad\n" }),
    ).toBe(["exit code: 7", "stdout:", "", "stderr:", "bad"].join("\n"));
  });
});

describe("ToolRegistry with BashTool", () => {
  it("executes bash through the registry", async () => {
    const runCommand: CommandRunner = async () => ({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });
    const registry = new ToolRegistry([
      new BashTool({ timeoutMs: 1000 }, runCommand),
    ]);

    await expect(registry.execute("bash", "pwd")).resolves.toContain(
      "stdout:\nok",
    );
  });
});
```

These tests separate three concerns:

- `BashTool` validates input and adapts command results to the `Tool` contract.
- `runShellCommand()` proves the real process boundary with deterministic Node
  commands.
- `ToolRegistry` remains the only dispatch path callers need.

The test command uses `process.execPath` instead of assuming `node` is on the
reader's `PATH`. That makes the test more portable while still exercising a
real child process.

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
bun run dev -- "hello bash"
```

Expected output:

```text
user: hello bash
assistant: agent heard: hello bash
```

Run the existing safe tool:

```bash
bun run dev -- --tool cwd
```

Expected shape:

```text
tool cwd:
/path/to/ty-term
```

Run the new bash tool:

```bash
bun run dev -- --tool bash "pwd"
```

Expected shape:

```text
tool bash:
exit code: 0
stdout:
/path/to/ty-term
stderr:
```

Run a deterministic command:

```bash
bun run dev -- --tool bash "node -e \"process.stdout.write('ok')\""
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
bun run dev -- --tool bash "node -e \"process.stderr.write('bad'); process.exit(7)\""
```

Expected shape:

```text
tool bash:
exit code: 7
stdout:

stderr:
bad
```

Run bash with no command:

```bash
bun run dev -- --tool bash
```

Expected shape:

```text
bash tool requires a command.
```

The process exits non-zero because the CLI catch block turns the thrown tool
error into stderr.

## How It Works

The new tool path has this data flow:

```text
cli.ts
  -> new ToolRegistry([new CurrentDirectoryTool(), new BashTool()])
  -> toolRegistry.execute("bash", commandText)
  -> BashTool.execute(commandText)
  -> runShellCommand(commandText)
  -> formatCommandResult(...)
  -> print "tool bash:\n..."
```

The existing prompt path stays unchanged:

```text
cli.ts
  -> new AgentMessageFactory()
  -> new EchoModelClient() or new OpenAIModelClient()
  -> new AgentLoop(messageFactory, modelClient)
  -> new Conversation()
  -> await agentLoop.runTurn(conversation, prompt)
  -> conversation.renderTranscript()
```

Those paths are still separate. That separation is not a limitation of the
architecture. It is the chapter boundary.

If bash were wired into `AgentLoop` now, the loop would need answers to
questions we have not taught yet:

- How does the model request a tool?
- What text format does the model use?
- How do we parse that request?
- What message records the tool result?
- Does the model get a second response after the tool runs?
- Should all tools be available to the model?

Chapter 6 answers those questions. Chapter 5 only gives Chapter 6 a real tool
to call.

## Simplifications

This chapter intentionally does not:

- let the model choose bash commands
- add tool results to the conversation
- prompt for command approval
- sandbox commands
- stream command output
- support interactive commands
- preserve long-running processes
- parse structured JSON tool input
- build a full process manager

The timeout is a learning guardrail, not a complete safety system.

The most important safety decision is architectural: bash remains behind a
named tool object and a registry dispatch boundary. That does not make shell
commands safe, but it gives future chapters one place to add policy.

## Handoff To Chapter 6

Chapter 5 gives the harness a real external action:

```text
ToolRegistry.execute("bash", commandText) -> BashTool -> shell process
```

Chapter 6 can now connect the model loop to the tool boundary.

The next slice should:

- teach the model what tools exist
- parse a simple model-produced tool request
- execute only registered tools through `ToolRegistry`
- append the tool result to the conversation
- call the model again with that result available
- keep bash gated behind a visible, conservative rule

Chapter 6 should preserve the continuity rule:

```text
AgentLoop orchestrates model/tool turns.
Conversation stores and renders messages.
ToolRegistry dispatches tools.
BashTool owns command execution.
cli.ts only composes dependencies and handles process I/O.
```
