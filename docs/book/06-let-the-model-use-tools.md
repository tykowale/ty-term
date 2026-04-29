# Chapter 6: Let the Model Use Tools

Chapter 5 gave the harness two tool paths:

- `cwd`, a safe tool that returns the current working directory
- `bash`, a manual tool that runs a shell command

Both tools still sat outside the model loop. A human could type:

```bash
bun run dev -- --tool cwd
```

or:

```bash
bun run dev -- --tool bash "pwd"
```

but a normal prompt still flowed through one simple model turn:

```text
user: hello
assistant: agent heard: hello
```

This chapter connects the model loop to the tool boundary. The model can now ask
for one allowlisted tool, the harness can execute that tool through
`ToolRegistry`, and the tool result becomes part of the conversation before the
model writes its final answer.

The architectural rule is the important part:

```text
Conversation stores and renders messages.
AgentLoop orchestrates model/tool turns.
ToolRequestParser owns the text tool protocol.
ToolRegistry dispatches tool execution.
BashTool still owns command execution.
cli.ts composes dependencies and prints results.
```

The visible behavior is:

```text
$ bun run dev -- "use the cwd tool"
user: use the cwd tool
assistant: TOOL cwd
tool cwd: /path/to/ty-term
assistant: saw tool cwd: /path/to/ty-term
```

## Why The Loop Moves Here

Chapter 3 introduced `AgentLoop` because `Conversation` should not know how to
call a model. Chapter 4 introduced `ToolRegistry` but deliberately kept it out
of `AgentLoop` because the model did not know how to request a tool yet.
Chapter 5 added `BashTool` but kept it manual because shell commands are too
powerful to hand to a model in the first tool chapter.

Now the missing pieces line up:

```text
model response -> parse request -> registry executes tool -> tool result message
```

That sequence is orchestration. It belongs in `AgentLoop`.

It does not belong in `Conversation`. If `Conversation` executed tools, message
history would know about model behavior, tool allowlists, parser syntax, and
execution errors. That would turn the storage object into the new god object.

It also does not belong in `cli.ts`. If the CLI parsed model text and executed
tools, the command-line entrypoint would become the agent. Later chapters need
interactive mode, sessions, project instructions, and file tools. Those should
reuse the same `AgentLoop`, not duplicate hidden branches in the CLI.

## The Small Tool Protocol

Real model providers support structured tool calls. We will get there later.
For this chapter, the model uses a plain text protocol:

```text
TOOL cwd
TOOL bash: pwd
```

The syntax is intentionally inspectable. A reader can see the exact assistant
message that requested a tool:

```text
assistant: TOOL cwd
```

But even a small text protocol needs an owner. We should not scatter this
regular expression through `AgentLoop`, `cli.ts`, and tests. The parser gets its
own class:

```text
src/tools/tool-request-parser.ts
```

The parser does not execute tools. It only translates assistant text into a
small request object.

## The File Layout

The book's OOP spine now looks like this:

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
    tool-request-parser.ts
  cli.ts
  index.ts
tests/
  agent-loop.test.ts
  bash-tool.test.ts
  tool-registry.test.ts
  tool-request-parser.test.ts
```

The only new source file is `tool-request-parser.ts`. Existing files evolve to
carry tool messages through the loop.

## Tool Messages

Before the loop can record a tool result, the message type needs one more role.

`src/agent/agent-message.ts`:

```ts
export type AgentRole = "user" | "assistant" | "tool";

export interface AgentMessage {
  readonly role: AgentRole;
  readonly content: string;
  readonly name?: string;
}
```

The `name` field is only meaningful for tool messages:

```ts
{ role: "tool", name: "cwd", content: "/path/to/ty-term" }
```

A stricter implementation could use a discriminated union so TypeScript enforces
that `name` exists only when `role` is `"tool"`. That is a reasonable future
refactor. Here, the optional field keeps the chapter focused on the loop.

## The Message Factory Grows With The Role

Chapter 2 introduced `AgentMessageFactory` so message construction would not
become a pile of standalone helpers. This chapter adds a method to that object.

`src/agent/agent-message-factory.ts`:

```ts
import type { AgentMessage } from "@/agent/agent-message";

export class AgentMessageFactory {
  createUserMessage(content: string): AgentMessage {
    return { role: "user", content };
  }

  createAssistantMessage(content: string): AgentMessage {
    return { role: "assistant", content };
  }

  createToolMessage(name: string, content: string): AgentMessage {
    return { role: "tool", name, content };
  }
}
```

This keeps the ownership rule intact:

```text
AgentMessageFactory owns construction of agent messages.
Conversation owns storage of agent messages.
AgentLoop decides when each message is created.
```

## Conversation Still Stores And Renders

`Conversation` does not execute tools, but it does need to render tool messages
clearly.

`src/agent/conversation.ts`:

```ts
import type { AgentMessage } from "@/agent/agent-message";

export class Conversation {
  private readonly messages: AgentMessage[];

  constructor(messages: AgentMessage[] = []) {
    this.messages = messages.map((message) => ({ ...message }));
  }

  appendMessages(...messages: AgentMessage[]): void {
    this.messages.push(...messages.map((message) => ({ ...message })));
  }

  getMessages(): AgentMessage[] {
    return this.messages.map((message) => ({ ...message }));
  }

  renderTranscript(): string {
    return this.messages
      .map((message) => {
        if (message.role === "tool") {
          return `tool ${message.name}: ${message.content}`;
        }

        return `${message.role}: ${message.content}`;
      })
      .join("\n");
  }
}
```

The new branch is presentation logic, not orchestration. Rendering knows how to
display a message that already exists. It does not know why the message exists.

That distinction is small but important:

```text
Good: Conversation renders "tool cwd: ..."
Bad:  Conversation decides to run the cwd tool
```

## The Parser Boundary

Now add `src/tools/tool-request-parser.ts`:

```ts
export interface ToolRequest {
  readonly name: string;
  readonly input?: string;
}

export class ToolRequestParser {
  parse(text: string): ToolRequest | undefined {
    const match = text.trim().match(/^TOOL ([a-zA-Z0-9_-]+)(?:\s*:\s*(.*))?$/);

    if (!match) {
      return undefined;
    }

    const [, name, input] = match;

    return {
      name,
      input: input && input.length > 0 ? input : undefined,
    };
  }
}
```

The parser accepts two forms:

```text
TOOL cwd
TOOL bash: pwd
```

It ignores normal assistant text:

```text
agent heard: hello
```

Putting this in a class avoids an ad hoc string check inside `cli.ts` or a
buried helper in `index.ts`. `AgentLoop` can ask a parser whether assistant text
contains a request, and the parser can evolve later when the protocol becomes
structured.

## The Echo Model Simulates Tool Use

The deterministic model client needs just enough behavior to test both paths.

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

    return `agent heard: ${prompt}`;
  }
}
```

This class is still a fake. It is useful because it creates deterministic model
behavior:

- a normal prompt returns normal assistant text
- a tool-ish prompt returns `TOOL cwd`
- a conversation ending in a tool result returns a final assistant response

That last branch simulates the second model call. The model sees:

```text
user: use the cwd tool
assistant: TOOL cwd
tool cwd: /path/to/ty-term
```

and replies:

```text
saw tool cwd: /path/to/ty-term
```

## The Real Provider Gets Instructions

`OpenAIModelClient` still hides provider-specific details, but now it should
tell the model about the tiny text protocol.

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

The provider client maps local `tool` messages into text because this chapter is
not using provider-native tool calling yet. The rest of the harness does not
need to know that detail. It only depends on `ModelClient`.

The instruction "Do not request bash commands" matches the capability boundary:
manual CLI tool execution can still use `bash`, but the model-driven registry in
this chapter will only expose `cwd`.

## AgentLoop Owns The Tool Turn

Now update the orchestrator.

`src/agent/agent-loop.ts`:

```ts
import { AgentMessageFactory } from "@/agent/agent-message-factory";
import type { Conversation } from "@/agent/conversation";
import type { ModelClient } from "@/model/model-client";
import type { ToolRegistry } from "@/tools/tool-registry";
import { ToolRequestParser } from "@/tools/tool-request-parser";

export class AgentLoop {
  constructor(
    private readonly messageFactory: AgentMessageFactory,
    private readonly modelClient: ModelClient,
    private readonly toolRegistry?: ToolRegistry,
    private readonly toolRequestParser = new ToolRequestParser(),
  ) {}

  async runTurn(conversation: Conversation, prompt: string): Promise<void> {
    const userMessage = this.messageFactory.createUserMessage(prompt);
    const afterUser = [...conversation.getMessages(), userMessage];

    const assistantContent = await this.modelClient.createResponse(afterUser);
    const assistantMessage =
      this.messageFactory.createAssistantMessage(assistantContent);
    const afterAssistant = [...afterUser, assistantMessage];

    const toolRequest = this.toolRequestParser.parse(assistantContent);

    if (!toolRequest) {
      conversation.appendMessages(userMessage, assistantMessage);
      return;
    }

    if (!this.toolRegistry) {
      throw new Error(
        `Tool requested without a tool registry: ${toolRequest.name}`,
      );
    }

    const toolResult = await this.toolRegistry.execute(
      toolRequest.name,
      toolRequest.input,
    );
    const toolMessage = this.messageFactory.createToolMessage(
      toolRequest.name,
      toolResult,
    );
    const afterTool = [...afterAssistant, toolMessage];

    const finalAssistantContent =
      await this.modelClient.createResponse(afterTool);
    const finalAssistantMessage = this.messageFactory.createAssistantMessage(
      finalAssistantContent,
    );

    conversation.appendMessages(
      userMessage,
      assistantMessage,
      toolMessage,
      finalAssistantMessage,
    );
  }
}
```

Read the method as a small state machine:

```text
1. Create the user message.
2. Call the model with prior conversation plus the user message.
3. Parse the assistant response.
4. If there is no tool request, append user + assistant and stop.
5. If there is a tool request, execute it through ToolRegistry.
6. Create a tool message from the result.
7. Call the model again with the tool result included.
8. Append user + assistant + tool + final assistant.
```

The loop still mutates the conversation only after the turn succeeds. That keeps
the Chapter 3 invariant:

```text
Conversation contains complete turns after AgentLoop.runTurn() succeeds.
```

The first tool-aware loop also has two deliberate limits:

- it runs at most one tool per user turn
- it calls the model once after the tool result, then stops

Those limits prevent accidental infinite loops. A production agent eventually
needs a repeated loop with iteration limits, cancellation, approvals, and
structured events. This chapter teaches the first complete shape before adding
those guardrails.

## The Barrel File Exports Objects, Not Behavior

`src/index.ts` stays boring:

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
export type { Tool } from "@/tools/tool";
export { ToolRegistry } from "@/tools/tool-registry";
export {
  ToolRequestParser,
  type ToolRequest,
} from "@/tools/tool-request-parser";
```

There is still no `runTurnWithTools()` helper in this file. That behavior has a
home now: `AgentLoop`.

## The CLI Uses Two Registries

The CLI keeps the manual tool path from Chapters 4 and 5. That path can run
`bash` because a human explicitly asked for it:

```bash
bun run dev -- --tool bash "pwd"
```

The model-driven path gets a smaller registry:

```text
manual registry: cwd + bash
model registry:  cwd only
```

That split is the chapter's capability boundary.

`src/cli.ts`:

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
    const manualToolRegistry = new ToolRegistry([
      new CurrentDirectoryTool(),
      new BashTool(),
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
  const modelToolRegistry = new ToolRegistry([new CurrentDirectoryTool()]);
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

Notice what the CLI does not do:

- it does not parse `TOOL cwd`
- it does not append tool messages
- it does not call the model a second time
- it does not call `runShellCommand()`

The CLI composes the dependencies and then gets out of the way.

## Tests For The Parser

Start with the smallest new object.

`tests/tool-request-parser.test.ts`:

```ts
import { ToolRequestParser } from "@/tools/tool-request-parser";

describe("ToolRequestParser", () => {
  it("parses a tool request without input", () => {
    const parser = new ToolRequestParser();

    expect(parser.parse("TOOL cwd")).toEqual({ name: "cwd" });
  });

  it("parses a tool request with input", () => {
    const parser = new ToolRequestParser();

    expect(parser.parse("TOOL bash: pwd")).toEqual({
      name: "bash",
      input: "pwd",
    });
  });

  it("ignores normal assistant text", () => {
    const parser = new ToolRequestParser();

    expect(parser.parse("agent heard: hello")).toBeUndefined();
  });
});
```

These tests keep the syntax local. If a later chapter replaces text requests
with structured provider calls, the parser tests show exactly what changed.

## Tests For The Tool-Aware Loop

Now update `tests/agent-loop.test.ts` so `AgentLoop` proves both branches.

```ts
import { AgentLoop } from "@/agent/agent-loop";
import type { AgentMessage } from "@/agent/agent-message";
import { AgentMessageFactory } from "@/agent/agent-message-factory";
import { Conversation } from "@/agent/conversation";
import { EchoModelClient } from "@/model/echo-model-client";
import type { ModelClient } from "@/model/model-client";
import { CurrentDirectoryTool } from "@/tools/current-directory-tool";
import { ToolRegistry } from "@/tools/tool-registry";

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

  it("renders tool messages in transcripts", async () => {
    const conversation = new Conversation([
      { role: "tool", name: "cwd", content: "/learn/harness" },
    ]);

    expect(conversation.renderTranscript()).toBe("tool cwd: /learn/harness");
  });
});
```

The tests cover the chapter's four important contracts:

- a normal prompt still works
- a tool request goes through `ToolRegistry`
- an unknown model-requested tool fails at the registry boundary
- tool messages render as transcript lines

Keep the Chapter 5 bash tests too. They still prove that `BashTool` owns command
execution and that manual `--tool bash` dispatch works through the registry.

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

Run the model-driven tool path:

```bash
bun run dev -- "use the cwd tool"
```

Expected shape:

```text
user: use the cwd tool
assistant: TOOL cwd
tool cwd: /path/to/ty-term
assistant: saw tool cwd: /path/to/ty-term
```

The exact path depends on your machine.

Run the manual bash path from Chapter 5:

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

That command still works because manual tools and model tools are separate
registries. The model did not gain the ability to run shell commands.

## What We Simplified

This chapter uses a text protocol instead of provider-native structured tool
calls. It allows only one model-requested tool per turn. It exposes only `cwd`
to the model, even though the manual registry still contains `bash`.

Those simplifications keep the core loop visible:

```text
user -> model -> parser -> registry -> tool message -> model -> transcript
```

The architecture is intentionally ready to grow:

- `ToolRequestParser` can evolve or be replaced when tool calls become
  structured.
- `ToolRegistry` remains the model capability allowlist.
- `AgentLoop` remains the orchestration owner.
- `Conversation` remains simple message storage and rendering.

## Checkpoint

You now have:

- structured user, assistant, and tool messages
- `AgentMessageFactory.createToolMessage()`
- a `ToolRequestParser` boundary
- a model-aware tool loop inside `AgentLoop`
- a registry acting as the model capability allowlist
- manual shell execution still separated from model-driven execution

The next chapter adds the first genuinely useful coding-agent tool:
`ReadFileTool`. It should be another `Tool` implementation, not a branch inside
`cli.ts` or `AgentLoop`.
