# Chapter 3: Call One Model Provider

Chapter 2 gave the harness its first real domain objects:

- `AgentMessage`, the role-tagged record of one thing said in the conversation
- `AgentMessageFactory`, the owner of message construction
- `Conversation`, the owner of ordered message history and transcript rendering

That chapter still faked the assistant:

```text
user: hello
assistant: agent heard: hello
```

The fake response lived in `Conversation.runTurn()` because, at that point, a
turn was only a local state change:

```text
append user message
append fake assistant message
```

This chapter changes that. A turn now crosses a model boundary. That means
`Conversation` should stop owning the turn. It should keep owning the data it is
good at owning: message storage, safe access, and transcript rendering.

The new owner is `AgentLoop`.

```text
src/
  agent/
    agent-message.ts
    agent-message-factory.ts
    conversation.ts
    agent-loop.ts
  model/
    model-client.ts
    echo-model-client.ts
    openai-model-client.ts
  cli.ts
  index.ts
tests/
  agent-loop.test.ts
```

The no-key path stays deterministic:

```text
$ bun run dev -- "hello"
user: hello
assistant: agent heard: hello
```

But the source of assistant text is no longer hard-coded into the conversation.

## The New Boundary

The important move in this chapter is not "add OpenAI." The important move is:

```text
Conversation owns history.
AgentLoop owns orchestration.
ModelClient owns provider interaction.
```

That separation gives each object a narrow job:

- `Conversation` stores messages and renders a transcript.
- `AgentLoop` decides what happens during one turn.
- `ModelClient` turns conversation context into assistant text.
- `cli.ts` composes the objects and prints the result.

This keeps the dependency direction clean:

```text
cli.ts
  -> AgentLoop
  -> Conversation + AgentMessageFactory + ModelClient
```

`cli.ts` is allowed to know about command-line flags and environment variables.
It should not know how to build a provider request. `Conversation` is allowed to
know how to append messages. It should not know whether assistant text came from
an echo client, OpenAI, a local model, or a future tool-aware loop.

## Moving `runTurn()` Out Of `Conversation`

Chapter 2 used this shape:

```ts
conversation.runTurn("hello");
```

That was a temporary simplification. It let the book introduce message history
before introducing model calls.

Now the call becomes:

```ts
await agentLoop.runTurn(conversation, "hello");
```

That may look like a small change, but it moves an important responsibility.
`Conversation` no longer decides how assistant messages are produced. It only
records messages after another object decides what the messages are.

The revised `Conversation` keeps the storage methods from Chapter 2 and replaces
`runTurn()` with `appendMessages()`:

```ts
import type { AgentMessage } from "./agent-message";

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
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");
  }
}
```

Notice what disappeared:

```ts
runTurn(prompt: string): void
```

That method had to go because a turn now means more than "append two local
messages." It means "build a user message, ask a model for assistant text, build
an assistant message, then append both messages in order."

That is orchestration, so it belongs one level up.

## The Model Interface

The model boundary starts with an interface in `src/model/model-client.ts`:

```ts
import type { AgentMessage } from "../agent/agent-message";

export interface ModelClient {
  createResponse(messages: AgentMessage[]): Promise<string>;
}
```

The interface receives messages, not a raw prompt. A model provider needs the
conversation context in order:

```text
earlier user message
earlier assistant message
new user message
```

For this chapter, the model client returns plain assistant text. Later chapters
will need richer results for tool calls, but adding that now would blur the
lesson. The first boundary is simply:

```text
AgentMessage[] -> assistant text
```

It is async because real providers are async. Even the deterministic echo client
implements the same async interface so the rest of the loop has one shape.

## A Deterministic Model Client

Tests should not call a real model. They should not need credentials, network
access, provider availability, or stable model output.

So the first implementation is `src/model/echo-model-client.ts`:

```ts
import type { AgentMessage } from "../agent/agent-message";
import type { ModelClient } from "./model-client";

export class EchoModelClient implements ModelClient {
  async createResponse(messages: AgentMessage[]): Promise<string> {
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");

    return `agent heard: ${lastUserMessage?.content ?? ""}`;
  }
}
```

This class is intentionally boring. It is not pretending to be intelligent. It
only gives the loop a stable model-shaped dependency.

It also proves why the interface accepts message history. The echo client could
have accepted a single prompt, but then tests would not exercise the same shape
that a real provider needs. By reading the latest user message from the context,
the fake client behaves like a tiny implementation of the real boundary.

## A Real Provider Client

The second implementation is `src/model/openai-model-client.ts`:

```ts
import OpenAI from "openai";
import type { AgentMessage } from "../agent/agent-message";
import type { ModelClient } from "./model-client";

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
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });

    return response.output_text;
  }
}
```

This class hides the provider-specific details:

- how to construct the SDK client
- which model name to use
- how to map `AgentMessage` into provider input
- where to read text from the provider response

The rest of the harness only sees `ModelClient`.

The constructor accepts an optional `client` so tests in later chapters can
inject a recording fake if they need to inspect provider input. Chapter 3's
deterministic tests should still use `EchoModelClient`; they do not need to
mock the OpenAI SDK.

## The Agent Loop

Now we can name the object that owns a turn.

`src/agent/agent-loop.ts`:

```ts
import { AgentMessageFactory } from "./agent-message-factory";
import type { Conversation } from "./conversation";
import type { ModelClient } from "../model/model-client";

export class AgentLoop {
  constructor(
    private readonly messageFactory: AgentMessageFactory,
    private readonly modelClient: ModelClient,
  ) {}

  async runTurn(conversation: Conversation, prompt: string): Promise<void> {
    const userMessage = this.messageFactory.createUserMessage(prompt);
    const modelContext = [...conversation.getMessages(), userMessage];
    const assistantContent =
      await this.modelClient.createResponse(modelContext);
    const assistantMessage =
      this.messageFactory.createAssistantMessage(assistantContent);

    conversation.appendMessages(userMessage, assistantMessage);
  }
}
```

Read the method in order:

```text
create user message
copy current conversation context
include the pending user message
ask the model for assistant text
create assistant message
append user + assistant to the conversation
```

The loop asks the model before mutating the conversation. That means a failed
model call does not leave a half-written turn with a user message but no
assistant message. That is a deliberate invariant for this chapter:

```text
Conversation contains complete turns after AgentLoop.runTurn() succeeds.
```

Later we may choose to record failed turns or partial events. That should be a
deliberate design change, not an accident caused by mutation order.

The loop also does not render anything. Rendering still belongs to
`Conversation`, and printing still belongs to `cli.ts`.

## The Barrel File

`src/index.ts` remains a barrel. It exports the public objects without
implementing behavior:

```ts
export { AgentLoop } from "./agent/agent-loop";
export type { AgentMessage, AgentRole } from "./agent/agent-message";
export { AgentMessageFactory } from "./agent/agent-message-factory";
export { Conversation } from "./agent/conversation";
export { EchoModelClient } from "./model/echo-model-client";
export type { ModelClient } from "./model/model-client";
export { OpenAIModelClient } from "./model/openai-model-client";
```

This rule matters more as the book grows. `index.ts` is a public import surface,
not a junk drawer for agent behavior.

## The CLI Composes Dependencies

The CLI now chooses a model client and wires the objects together.

`src/cli.ts`:

```ts
#!/usr/bin/env bun

import {
  AgentLoop,
  AgentMessageFactory,
  Conversation,
  EchoModelClient,
  OpenAIModelClient,
} from "./index";

const args = process.argv.slice(2);
const useOpenAI = args.includes("--openai");
const prompt = args.filter((arg) => arg !== "--openai").join(" ");

if (prompt.length === 0) {
  console.error('Usage: bun run dev -- [--openai] "your prompt"');
  process.exit(1);
}

if (useOpenAI && !process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required when using --openai.");
  process.exit(1);
}

const messageFactory = new AgentMessageFactory();
const modelClient = useOpenAI ? new OpenAIModelClient() : new EchoModelClient();
const agentLoop = new AgentLoop(messageFactory, modelClient);
const conversation = new Conversation();

await agentLoop.runTurn(conversation, prompt);

console.log(conversation.renderTranscript());
```

This file still has a few responsibilities, but they are process-level
responsibilities:

- read process arguments
- choose whether `--openai` was requested
- reject a missing prompt
- reject a missing API key when the real provider is requested
- construct the objects for this process
- print the transcript

It does not build messages, call the provider SDK, append conversation history,
or render transcript lines itself.

The `--openai` flag is explicit. The CLI does not silently switch to a real
provider just because `OPENAI_API_KEY` exists in the shell. That keeps the
default chapter path deterministic and no-cost.

## The Tests

The tests should lock down the object boundaries:

- `EchoModelClient` is deterministic.
- `AgentLoop` appends a complete user/assistant turn.
- `AgentLoop` passes prior context to the model.
- `Conversation` still renders the final transcript.
- The optional OpenAI path is selected by the CLI flag, not by accident.

Start with `tests/agent-loop.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  AgentLoop,
  AgentMessageFactory,
  Conversation,
  EchoModelClient,
  type AgentMessage,
  type ModelClient,
} from "../src/index";

class RecordingModelClient implements ModelClient {
  public receivedMessages: AgentMessage[] = [];

  async createResponse(messages: AgentMessage[]): Promise<string> {
    this.receivedMessages = messages;
    return "model response";
  }
}

describe("EchoModelClient", () => {
  it("echoes the latest user message from the provided context", async () => {
    const modelClient = new EchoModelClient();

    await expect(
      modelClient.createResponse([
        { role: "user", content: "first" },
        { role: "assistant", content: "agent heard: first" },
        { role: "user", content: "second" },
      ]),
    ).resolves.toBe("agent heard: second");
  });
});

describe("AgentLoop", () => {
  it("adds a user message followed by the model response", async () => {
    const conversation = new Conversation();
    const agentLoop = new AgentLoop(
      new AgentMessageFactory(),
      new EchoModelClient(),
    );

    await agentLoop.runTurn(conversation, "hello");

    expect(conversation.getMessages()).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "agent heard: hello" },
    ]);
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

  it("renders the completed transcript through Conversation", async () => {
    const conversation = new Conversation();
    const agentLoop = new AgentLoop(
      new AgentMessageFactory(),
      new EchoModelClient(),
    );

    await agentLoop.runTurn(conversation, "hello");

    expect(conversation.renderTranscript()).toBe(
      "user: hello\nassistant: agent heard: hello",
    );
  });
});
```

These tests do not touch `OpenAIModelClient`. The real provider is intentionally
an optional runtime path, not the chapter's correctness oracle.

If you want a CLI-level test for the optional provider flag, keep it focused on
the guard behavior:

```ts
import { describe, expect, it } from "bun:test";

describe("CLI provider selection", () => {
  it("requires OPENAI_API_KEY when --openai is requested", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "run", "src/cli.ts", "--openai", "hello"],
      env: {
        ...process.env,
        OPENAI_API_KEY: "",
      },
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("OPENAI_API_KEY is required");
  });
});
```

That test still does not call OpenAI. It only proves that the real-provider path
is opt-in and guarded.

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

Run the deterministic CLI path:

```bash
bun run dev -- "hello"
```

Expected output:

```text
user: hello
assistant: agent heard: hello
```

Optionally call the real provider:

```bash
OPENAI_API_KEY=your_api_key bun run dev -- --openai "Explain a model boundary in one sentence"
```

Expected shape:

```text
user: Explain a model boundary in one sentence
assistant: A model boundary is the interface where application-owned conversation state is converted into a provider request and returned as assistant text.
```

The exact assistant text will vary because this command calls a real model.

You can choose a different model without changing code:

```bash
OPENAI_API_KEY=your_api_key OPENAI_MODEL=gpt-5.2 bun run dev -- --openai "Say hello from the harness"
```

## How It Works

The chapter's data flow is:

```text
cli.ts
  -> new AgentMessageFactory()
  -> new EchoModelClient() or new OpenAIModelClient()
  -> new AgentLoop(messageFactory, modelClient)
  -> new Conversation()
  -> await agentLoop.runTurn(conversation, prompt)
  -> conversation.renderTranscript()
```

The architectural shift from Chapter 2 is this:

```text
Chapter 2:
Conversation.runTurn(prompt)

Chapter 3:
AgentLoop.runTurn(conversation, prompt)
```

That keeps `Conversation` from turning into a god object. It owns state. It does
not own provider calls.

The `ModelClient` interface is also deliberately small. It does not expose SDK
objects, request options, streaming events, retries, or provider-specific
response shapes. The loop asks for assistant text and receives assistant text.

That is enough for one model call. Future chapters will widen this boundary only
when the code needs more behavior.

## Simplifications

We are deliberately not adding:

- streaming output
- system or developer messages
- tool calls
- retries
- token counting
- conversation truncation
- provider registries
- multiple real model vendors
- snapshot tests for real model output

Those are real concerns, but adding them here would hide the lesson. The lesson
is that a model call is a boundary, and orchestration belongs in `AgentLoop`, not
in `Conversation`, `cli.ts`, or `index.ts`.

## Handoff To Chapter 4

Chapter 3 gives the harness a model boundary and a real orchestration object:

```text
AgentLoop + ModelClient
```

Chapter 4 should add the next boundary: tools.

The next useful slice is:

- introduce `src/tools/tool.ts`
- introduce `src/tools/tool-registry.ts`
- implement one safe toy tool, such as `CurrentDirectoryTool`
- keep tool lookup and execution out of `cli.ts`
- pass a tool registry into `AgentLoop` only when the loop needs it

The continuity rule for Chapter 4 is the same one this chapter followed:

```text
Conversation stores and renders messages.
AgentLoop orchestrates the turn.
ToolRegistry owns tool lookup and execution dispatch.
```

Do not put tool helpers back into `src/index.ts`, and do not make `cli.ts`
execute tools directly.
