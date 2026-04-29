# Chapter 7: Read Project Files

Chapter 6 gave the harness its first model-driven tool loop:

```text
user: use the cwd tool
assistant: TOOL cwd
tool cwd: /path/to/ty-term
assistant: saw tool cwd: /path/to/ty-term
```

That flow proved the architecture:

```text
Conversation stores and renders messages.
AgentMessageFactory creates user, assistant, and tool messages.
ToolRequestParser owns the text tool protocol.
ToolRegistry owns tool lookup and dispatch.
AgentLoop orchestrates the turn.
cli.ts composes dependencies and prints output.
```

But `cwd` is mostly a heartbeat. It tells us the model can request a tool, but
it does not help the model inspect the project.

A coding harness needs a safe way to read files. This chapter adds that
capability without changing the ownership rules from Chapter 6.

The new model-visible request is:

```text
TOOL read_file: package.json
```

The visible transcript becomes:

```text
user: read file package.json
assistant: TOOL read_file: package.json
tool read_file: {"name":"ty-term", ...}
assistant: saw tool read_file: {"name":"ty-term", ...}
```

## The New Boundary

The important concept is not `fs.readFile()`. The important concept is the
filesystem boundary:

```text
The model may name a project-relative file.
The harness decides whether that path is safe.
```

That gives us these rules:

- `package.json` is allowed.
- `src/index.ts` is allowed.
- `subdir/../README.md` is allowed if it normalizes inside the project.
- `/etc/passwd` is rejected.
- `../secret.txt` is rejected.

The model does not get to choose an arbitrary path on the machine. It can only
ask for a file inside the project root.

That safety check belongs near the read capability itself:

```text
ReadFileTool owns project-root path validation.
ToolRegistry owns dispatch.
AgentLoop owns orchestration.
cli.ts chooses the project root while composing dependencies.
```

If path validation lived in `cli.ts`, model-driven reads and manual reads could
drift apart. If it lived in `AgentLoop`, the loop would start learning
filesystem details. `ReadFileTool` is the narrowest owner.

## The Capability Split

Chapter 5 added `BashTool`, but Chapter 6 kept it manual-only. That decision
still stands.

The manual registry is for explicit human commands:

```text
manual registry: cwd + bash + read_file
```

The model registry is narrower:

```text
model registry: cwd + read_file
```

The model can read project files, but it still cannot run shell commands.

That split is not a UX detail. It is the capability boundary. `ToolRegistry`
lets the CLI compose different allowlists for different callers while every tool
still implements the same `Tool` interface.

## The File Layout

Add one new tool class:

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
    read-file-tool.ts
    tool.ts
    tool-registry.ts
    tool-request-parser.ts
  cli.ts
  index.ts
tests/
  agent-loop.test.ts
  read-file-tool.test.ts
  tool-registry.test.ts
```

`AgentLoop` does not need to learn anything about files. It already knows how
to execute a parsed request through `ToolRegistry`.

`ToolRequestParser` also stays exactly the same. The text protocol already
supports tool input:

```text
TOOL read_file: package.json
```

So this chapter should not add a `parseToolRequest()` helper or move parsing
back into `index.ts`.

## The ReadFileTool

Create `src/tools/read-file-tool.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Tool } from "@/tools/tool";

export class ReadFileTool implements Tool {
  public readonly name = "read_file";
  public readonly description =
    "Read a UTF-8 text file from inside the project root.";

  private readonly projectRoot: string;

  constructor(projectRoot = resolveProjectRoot()) {
    this.projectRoot = projectRoot;
  }

  async execute(input?: string): Promise<string> {
    const filePath = resolveProjectFilePath(this.projectRoot, input);

    return readFile(filePath, "utf8");
  }
}

export function resolveProjectRoot(projectRoot?: string): string {
  return path.resolve(projectRoot ?? process.env.INIT_CWD ?? process.cwd());
}

export function resolveProjectFilePath(
  projectRoot: string,
  input?: string,
): string {
  if (!input || input.trim().length === 0) {
    throw new Error("read_file tool requires a relative path.");
  }

  const relativePath = input.trim();

  if (path.isAbsolute(relativePath)) {
    throw new Error("read_file path must be relative.");
  }

  const root = resolveProjectRoot(projectRoot);
  const filePath = path.resolve(root, relativePath);
  const pathFromRoot = path.relative(root, filePath);

  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(pathFromRoot)
  ) {
    throw new Error("read_file path must stay inside the project root.");
  }

  return filePath;
}
```

This file owns three related decisions.

First, `ReadFileTool` owns the tool contract:

```ts
public readonly name = "read_file";
```

The registry does not need a special branch for file reading. It sees another
tool object with a name, a description, and an `execute()` method.

Second, `resolveProjectRoot()` owns the default root:

```ts
path.resolve(projectRoot ?? process.env.INIT_CWD ?? process.cwd());
```

When a package manager runs a script, `INIT_CWD` points to the directory where
the user started the command. That is usually the project root for this book.
The constructor still accepts a root explicitly so tests can use temporary
directories instead of the real checkout.

Third, `resolveProjectFilePath()` owns path safety. It rejects missing input,
absolute paths, and normalized paths that escape the root.

The subtle part is this check:

```ts
pathFromRoot === ".." ||
  pathFromRoot.startsWith(`..${path.sep}`) ||
  path.isAbsolute(pathFromRoot);
```

It intentionally does not use:

```ts
pathFromRoot.startsWith("..");
```

That looser check would reject a valid project file named `..example`.
Traversal is unsafe when the normalized relative path is exactly `..`, starts
with `../`, or becomes absolute.

## The Echo Model Learns The New Request

`EchoModelClient` is still a deterministic fake. It should now simulate a file
read request when the prompt asks to read a file.

`src/model/echo-model-client.ts`:

```ts
import type { AgentMessage } from "@/agent/agent-message";
import type { ModelClient } from "@/model/model-client";

export class EchoModelClient implements ModelClient {
  async createResponse(messages: AgentMessage[]): Promise<string> {
    const latestMessage = messages.at(-1);

    if (latestMessage?.role === "tool") {
      return `saw tool ${latestMessage.name}: ${latestMessage.content}`;
    }

    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    const prompt = lastUserMessage?.content ?? "";
    const normalizedPrompt = prompt.toLowerCase();

    if (
      normalizedPrompt.includes("use the cwd tool") ||
      normalizedPrompt.includes("run pwd")
    ) {
      return "TOOL cwd";
    }

    const readFileMatch = prompt.match(/read (?:the )?file ([^\n]+)/i);

    if (readFileMatch) {
      return `TOOL read_file: ${readFileMatch[1].trim()}`;
    }

    return `agent heard: ${prompt}`;
  }
}
```

This fake gives tests a stable model-driven file path:

```text
read file README.md -> TOOL read_file: README.md
```

The rest of the loop does not care that the request came from a fake model. It
only sees assistant text, asks `ToolRequestParser` to parse it, and executes the
result through `ToolRegistry`.

## The Real Provider Gets One More Instruction

`OpenAIModelClient` still hides provider-specific details behind the
`ModelClient` interface. It only needs to update its instructions so the model
knows the new text protocol.

`src/model/openai-model-client.ts`:

```ts
import OpenAI from "openai";
import type { AgentMessage } from "@/agent/agent-message";
import type { ModelClient } from "@/model/model-client";

export class OpenAIModelClient implements ModelClient {
  private readonly client: OpenAI;

  constructor(
    private readonly model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    client = new OpenAI(),
  ) {
    this.client = client;
  }

  async createResponse(messages: AgentMessage[]): Promise<string> {
    const response = await this.client.responses.create({
      model: this.model,
      instructions: [
        "You are connected to a tiny learning harness.",
        "If you need the current working directory, respond exactly: TOOL cwd",
        "If you need to read a project file, respond exactly: TOOL read_file: relative/path.txt",
        "Only request relative project file paths.",
        "Do not request bash commands.",
        "After a tool result appears, answer the user in normal text.",
      ].join("\n"),
      input: messages.map((message) => {
        if (message.role === "tool") {
          return {
            role: "user" as const,
            content: `tool ${message.name}: ${message.content}`,
          };
        }

        return {
          role: message.role,
          content: message.content,
        };
      }),
    });

    return response.output_text;
  }
}
```

The provider client tells the model what it may request. The actual enforcement
still happens in the registry and the tool. Instructions are guidance;
`ToolRegistry` and `ReadFileTool` are the guardrails.

## AgentLoop Does Not Become A File Reader

Chapter 6's `AgentLoop` already has the right shape:

```ts
const toolRequest = this.toolRequestParser.parse(assistantContent);

if (!toolRequest) {
  conversation.appendMessages(userMessage, assistantMessage);
  return;
}

const toolResult = await this.toolRegistry.execute(
  toolRequest.name,
  toolRequest.input,
);
const toolMessage = this.messageFactory.createToolMessage(
  toolRequest.name,
  toolResult,
);
```

There is no file-specific branch to add here.

That is the payoff from Chapter 6. Once the loop depends on `ToolRegistry`
instead of concrete tools, adding `ReadFileTool` is a composition change. The
loop continues to own turn orchestration:

```text
model response -> parser -> registry -> tool message -> final model response
```

It does not own file paths.

## The Barrel File Exports The Tool

`src/index.ts` remains a public import surface:

```ts
export { AgentLoop } from "@/agent/agent-loop";
export type { AgentMessage, AgentRole } from "@/agent/agent-message";
export { AgentMessageFactory } from "@/agent/agent-message-factory";
export { Conversation } from "@/agent/conversation";
export { EchoModelClient } from "@/model/echo-model-client";
export type { ModelClient } from "@/model/model-client";
export { OpenAIModelClient } from "@/model/openai-model-client";
export {
  BashTool,
  formatCommandResult,
  runShellCommand,
  type CommandOptions,
  type CommandResult,
  type CommandRunner,
} from "@/tools/bash-tool";
export { CurrentDirectoryTool } from "@/tools/current-directory-tool";
export {
  ReadFileTool,
  resolveProjectFilePath,
  resolveProjectRoot,
} from "@/tools/read-file-tool";
export type { Tool } from "@/tools/tool";
export { ToolRegistry } from "@/tools/tool-registry";
export {
  ToolRequestParser,
  type ToolRequest,
} from "@/tools/tool-request-parser";
```

There is still no `createReadFileTool()`, no `parseToolRequest()`, and no
`runTurnWithTools()` in this file. Those would pull behavior back into the
barrel.

## The CLI Composes Two Registries

The CLI chooses the project root because it is the process entrypoint. It knows
where the command was launched, and it decides which dependencies to compose.

It still does not validate file paths itself.

`src/cli.ts`:

```ts
#!/usr/bin/env bun

import {
  AgentLoop,
  AgentMessageFactory,
  BashTool,
  Conversation,
  CurrentDirectoryTool,
  EchoModelClient,
  OpenAIModelClient,
  ReadFileTool,
  ToolRegistry,
  resolveProjectRoot,
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
      toolInput = args.slice(index + 2).join(" ");
      break;
    }

    promptParts.push(arg);
  }

  return { useOpenAI, toolName, toolInput, prompt: promptParts.join(" ") };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const projectRoot = resolveProjectRoot();

  if (parsed.toolName) {
    const manualToolRegistry = new ToolRegistry([
      new CurrentDirectoryTool(projectRoot),
      new BashTool({ cwd: projectRoot }),
      new ReadFileTool(projectRoot),
    ]);

    const result = await manualToolRegistry.execute(
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
    console.error("       bun run dev -- --tool read_file package.json");
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
  const modelToolRegistry = new ToolRegistry([
    new CurrentDirectoryTool(projectRoot),
    new ReadFileTool(projectRoot),
  ]);
  const agentLoop = new AgentLoop(
    messageFactory,
    modelClient,
    modelToolRegistry,
  );
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

Read the composition by capability:

```ts
const manualToolRegistry = new ToolRegistry([
  new CurrentDirectoryTool(projectRoot),
  new BashTool({ cwd: projectRoot }),
  new ReadFileTool(projectRoot),
]);
```

Manual mode can run bash because a human explicitly requested a tool.

```ts
const modelToolRegistry = new ToolRegistry([
  new CurrentDirectoryTool(projectRoot),
  new ReadFileTool(projectRoot),
]);
```

Model mode can inspect the project, but it still cannot execute shell commands.

The CLI's job is composition and process I/O:

- parse `process.argv`
- choose `projectRoot`
- instantiate tools and model clients
- call `AgentLoop`
- print output

It does not parse `TOOL read_file`, append tool messages, or inspect path
traversal.

## Tests For ReadFileTool

Start with the new boundary itself. These tests use temporary project
directories so they do not depend on the actual repository checkout.

`tests/read-file-tool.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { ReadFileTool, resolveProjectFilePath } from "@/index";

async function withTempProject<T>(
  callback: (projectRoot: string) => Promise<T>,
): Promise<T> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "ty-term-read-file-"));

  try {
    return await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

describe("ReadFileTool", () => {
  it("reads UTF-8 text from a relative path inside the project root", async () => {
    await withTempProject(async (projectRoot) => {
      await writeFile(path.join(projectRoot, "note.txt"), "hello\n", "utf8");
      const readFileTool = new ReadFileTool(projectRoot);

      await expect(readFileTool.execute("note.txt")).resolves.toBe("hello\n");
    });
  });

  it("reports missing files from the filesystem", async () => {
    await withTempProject(async (projectRoot) => {
      const readFileTool = new ReadFileTool(projectRoot);

      await expect(readFileTool.execute("missing.txt")).rejects.toThrow();
    });
  });

  it("rejects empty input", async () => {
    const readFileTool = new ReadFileTool(process.cwd());

    await expect(readFileTool.execute()).rejects.toThrow(
      "read_file tool requires a relative path.",
    );
  });

  it("rejects absolute paths", async () => {
    const readFileTool = new ReadFileTool(process.cwd());

    await expect(
      readFileTool.execute(path.resolve("package.json")),
    ).rejects.toThrow("read_file path must be relative.");
  });

  it("rejects traversal outside the project root", async () => {
    await withTempProject(async (projectRoot) => {
      const readFileTool = new ReadFileTool(projectRoot);

      await expect(readFileTool.execute("../secret.txt")).rejects.toThrow(
        "read_file path must stay inside the project root.",
      );
    });
  });

  it("allows normalized relative paths that stay inside the project root", async () => {
    await withTempProject(async (projectRoot) => {
      await mkdir(path.join(projectRoot, "subdir"));
      await writeFile(path.join(projectRoot, "note.txt"), "inside\n", "utf8");
      const readFileTool = new ReadFileTool(projectRoot);

      await expect(readFileTool.execute("subdir/../note.txt")).resolves.toBe(
        "inside\n",
      );
    });
  });

  it("allows dot-prefixed filenames inside the project root", async () => {
    await withTempProject(async (projectRoot) => {
      await writeFile(path.join(projectRoot, "..example"), "hidden\n", "utf8");

      expect(resolveProjectFilePath(projectRoot, "..example")).toBe(
        path.join(projectRoot, "..example"),
      );
    });
  });
});
```

The missing-file test deliberately does not assert the exact Node error text.
Different platforms can phrase filesystem errors differently. The important
contract is that a missing file fails instead of silently inventing content.

## Tests For The Model-Driven Path

Now extend the Chapter 6 `AgentLoop` tests with a file-read case.

`tests/agent-loop.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import {
  AgentLoop,
  AgentMessageFactory,
  Conversation,
  CurrentDirectoryTool,
  EchoModelClient,
  ReadFileTool,
  ToolRegistry,
  type AgentMessage,
  type ModelClient,
} from "@/index";

async function withTempProject<T>(
  callback: (projectRoot: string) => Promise<T>,
): Promise<T> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "ty-term-agent-loop-"));

  try {
    return await callback(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

class RecordingModelClient implements ModelClient {
  public receivedMessages: AgentMessage[] = [];

  async createResponse(messages: AgentMessage[]): Promise<string> {
    this.receivedMessages = messages;
    return "model response";
  }
}

class UnknownToolModelClient implements ModelClient {
  async createResponse(): Promise<string> {
    return "TOOL missing";
  }
}

describe("AgentLoop", () => {
  it("keeps the normal prompt path stable", async () => {
    const conversation = new Conversation();
    const agentLoop = new AgentLoop(
      new AgentMessageFactory(),
      new EchoModelClient(),
      new ToolRegistry([new CurrentDirectoryTool("/learn/harness")]),
    );

    await agentLoop.runTurn(conversation, "hello");

    expect(conversation.renderTranscript()).toBe(
      "user: hello\nassistant: agent heard: hello",
    );
  });

  it("passes prior conversation plus the new user message to the model", async () => {
    const modelClient = new RecordingModelClient();
    const conversation = new Conversation([
      { role: "user", content: "earlier" },
      { role: "assistant", content: "previous answer" },
    ]);
    const agentLoop = new AgentLoop(new AgentMessageFactory(), modelClient);

    await agentLoop.runTurn(conversation, "next");

    expect(modelClient.receivedMessages).toEqual([
      { role: "user", content: "earlier" },
      { role: "assistant", content: "previous answer" },
      { role: "user", content: "next" },
    ]);
  });

  it("runs one requested cwd tool and appends the final assistant response", async () => {
    const conversation = new Conversation();
    const registry = new ToolRegistry([
      new CurrentDirectoryTool("/learn/harness"),
    ]);
    const agentLoop = new AgentLoop(
      new AgentMessageFactory(),
      new EchoModelClient(),
      registry,
    );

    await agentLoop.runTurn(conversation, "use the cwd tool");

    expect(conversation.getMessages()).toEqual([
      { role: "user", content: "use the cwd tool" },
      { role: "assistant", content: "TOOL cwd" },
      { role: "tool", name: "cwd", content: "/learn/harness" },
      { role: "assistant", content: "saw tool cwd: /learn/harness" },
    ]);
  });

  it("runs one requested read_file tool and appends the final assistant response", async () => {
    await withTempProject(async (projectRoot) => {
      await writeFile(
        path.join(projectRoot, "README.md"),
        "chapter 7\n",
        "utf8",
      );

      const conversation = new Conversation();
      const registry = new ToolRegistry([new ReadFileTool(projectRoot)]);
      const agentLoop = new AgentLoop(
        new AgentMessageFactory(),
        new EchoModelClient(),
        registry,
      );

      await agentLoop.runTurn(conversation, "read file README.md");

      expect(conversation.getMessages()).toEqual([
        { role: "user", content: "read file README.md" },
        { role: "assistant", content: "TOOL read_file: README.md" },
        { role: "tool", name: "read_file", content: "chapter 7\n" },
        {
          role: "assistant",
          content: "saw tool read_file: chapter 7\n",
        },
      ]);
    });
  });

  it("uses the registry as the model tool allowlist", async () => {
    const conversation = new Conversation();
    const agentLoop = new AgentLoop(
      new AgentMessageFactory(),
      new UnknownToolModelClient(),
      new ToolRegistry([]),
    );

    await expect(agentLoop.runTurn(conversation, "try a tool")).rejects.toThrow(
      "Unknown tool: missing",
    );
  });
});
```

The new test proves the whole path:

```text
EchoModelClient -> ToolRequestParser -> ToolRegistry -> ReadFileTool -> Conversation
```

It does not add file-reading logic to the loop. The loop only knows that the
registry returned text for a requested tool.

## Registry Tests Stay General

`ToolRegistry` does not need a special `read_file` test beyond dispatching a
tool by name. If your Chapter 4 tests already cover duplicate names, lookup,
and `execute()`, they still apply.

It is useful to add one integration-style dispatch assertion for the new tool:

```ts
it("dispatches read_file through the registry", async () => {
  await withTempProject(async (projectRoot) => {
    await writeFile(path.join(projectRoot, "note.txt"), "hello\n", "utf8");
    const registry = new ToolRegistry([new ReadFileTool(projectRoot)]);

    await expect(registry.execute("read_file", "note.txt")).resolves.toBe(
      "hello\n",
    );
  });
});
```

That test belongs with registry or read-file tests depending on how your test
files are organized. The behavior is the same: the caller asks the registry for
`read_file`, not the concrete tool directly.

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
bun run dev -- "hello"
```

Expected output:

```text
user: hello
assistant: agent heard: hello
```

Run the model-driven read path:

```bash
bun run dev -- "read file package.json"
```

Expected shape:

```text
user: read file package.json
assistant: TOOL read_file: package.json
tool read_file: {"name":"ty-term", ...}
assistant: saw tool read_file: {"name":"ty-term", ...}
```

Run the manual read path:

```bash
bun run dev -- --tool read_file package.json
```

Expected shape:

```text
tool read_file:
{"name":"ty-term", ...}
```

Try traversal:

```bash
bun run dev -- --tool read_file ../package.json
```

Expected error:

```text
read_file path must stay inside the project root.
```

Manual bash still works:

```bash
bun run dev -- --tool bash "node -e \"process.stdout.write('ok')\""
```

But the model still cannot request bash because `BashTool` is not in the model
registry.

## What We Simplified

This chapter reads whole UTF-8 files only. There is no line range support, no
file-size guard, no binary detection, no ignore-file integration, no symlink
policy, and no provider-native tool schema.

Those are real production concerns, but they are separate from this chapter's
lesson:

```text
The harness owns filesystem resolution.
The model only supplies a relative project path.
```

The architecture can absorb those concerns later because the boundary is now in
one place: `ReadFileTool`.

## Checkpoint

You now have:

- `ReadFileTool` as a `Tool` implementation
- project-root-aware UTF-8 file reads
- missing-input rejection
- absolute-path rejection
- traversal rejection
- normalized inside-root path support
- separate manual and model tool registries
- a model-driven file-read path through the existing `AgentLoop`

The harness can now inspect project files during a conversation. The next
problem is memory: every run still starts from an empty `Conversation`. Chapter
8 fixes that by introducing `SessionStore` and `JsonlSessionStore` so messages
can survive across CLI runs without teaching persistence to `AgentLoop` or
`cli.ts`.
