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

The second boundary is provider auth. We do not want Chapter 3 to require every
reader to export a provider-specific API key before the basic harness works.
Tools like `pi` support both subscription providers and API-key providers, and
they resolve both through local auth state. We will use the same shape here, but
keep setup outside the agent for now:

```text
bun run setup:provider
  -> writes .ty-term/auth.json

bun run dev -- "hello"
  -> loads provider auth if present
  -> otherwise uses EchoModelClient
```

That is the chapter boundary:

```text
Provider setup creates local auth.
The CLI loads local auth.
AgentLoop only sees a ModelClient.
```

No in-agent login command yet. No callback server in the agent. Those are
later terminal-product features. Chapter 3 only needs the shape that will let us
plug them in later.

The no-auth path stays deterministic:

```text
$ bun run dev -- "hello"
user: hello
assistant: agent heard: hello
```

## The New Boundary

The important move in this chapter is not "add OpenAI." The important move is:

```text
Conversation owns history.
AgentLoop owns orchestration.
ModelClient owns provider interaction.
ProviderAuthStore owns local provider credentials.
```

That separation gives each object a narrow job:

- `Conversation` stores messages and renders a transcript.
- `AgentLoop` decides what happens during one turn.
- `ModelClient` turns conversation context into assistant text.
- `ProviderAuthStore` loads saved provider credentials.
- `scripts/setup-provider.ts` writes development provider credentials.
- `cli.ts` composes the objects and prints the result.

This keeps the dependency direction clean:

```text
setup-provider.ts
  -> .ty-term/auth.json

cli.ts
  -> ProviderAuthStore
  -> AgentLoop
  -> Conversation + AgentMessageFactory + ModelClient
```

`cli.ts` is allowed to know where local auth lives. It should not know how to
build a provider request. `Conversation` is allowed to know how to append
messages. It should not know whether assistant text came from an echo client, a
subscription provider, an API-key provider, or a future tool-aware loop.

## Why Local Auth Instead Of One Required Key

A direct OpenAI API integration uses API keys. That is still a valid provider
auth type, but it should not be the only story the book teaches. The shape we
want is closer to `pi`:

```text
subscription auth -> saved OAuth/session token in auth.json
API-key auth      -> saved key or environment variable
model client      -> reads resolved provider auth
```

So Chapter 3 creates a local provider-auth boundary instead of hard-coding one
environment variable into the CLI.

This keeps the book honest:

- tests do not need a provider account
- the default CLI path remains no-cost and deterministic
- subscription auth can become the normal path later
- API keys can still be supported as one auth type
- later chapters can keep using `ModelClient` without caring how auth was
  acquired

The setup script is intentionally outside the agent. In a later interactive
chapter, the same auth file can be written by an interactive terminal command.
We are not ready for that command vocabulary yet.

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

The revised `Conversation` keeps the storage methods from Chapter 2 and removes
`runTurn()`:

```ts
import type { AgentMessage } from "@/agent/agent-message";

export class Conversation {
  private readonly messages: AgentMessage[];

  constructor(messages: readonly AgentMessage[] = []) {
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
import type { AgentMessage } from "@/agent/agent-message";

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
import type { AgentMessage } from "@/agent/agent-message";
import type { ModelClient } from "@/model/model-client";

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

## Provider Auth

Now create a small local-auth shape in `src/model/provider-auth.ts`:

```ts
export type ProviderCredentials =
  | {
      readonly type: "subscription";
      readonly provider: "openai";
      readonly accessToken: string;
    }
  | {
      readonly type: "api_key";
      readonly provider: "openai";
      readonly key: string;
    };

export interface ProviderAuthFile {
  readonly openai?: ProviderCredentials;
}
```

This is deliberately small:

- one provider, `openai`
- two auth types, `subscription` and `api_key`
- one local file shape

The point is not to implement every provider in Chapter 3. The point is to stop
pretending provider access is just one environment variable. A later chapter can
add provider selection, model lists, auth refresh, logout, and more providers
without changing the `ModelClient` interface.

Now define the resolved config that a model client receives in
`src/model/provider-config.ts`:

```ts
import type { ProviderCredentials } from "@/model/provider-auth";

export interface ProviderConfig {
  readonly provider: "openai";
  readonly model: string;
  readonly credentials: ProviderCredentials;
}
```

The auth file is storage. `ProviderConfig` is runtime configuration. Keeping
those separate lets later chapters add model selection, base URLs, provider
metadata, and credential refresh without changing `AgentLoop`.

## The Auth Store

`ProviderAuthStore` owns reading the local auth file:

```ts
import { readFile } from "node:fs/promises";
import type { ProviderAuthFile } from "@/model/provider-auth";
import type { ProviderConfig } from "@/model/provider-config";

export class ProviderAuthStore {
  constructor(private readonly path = ".ty-term/auth.json") {}

  async loadProviderConfig(): Promise<ProviderConfig | undefined> {
    try {
      const rawAuth = await readFile(this.path, "utf8");
      const authFile = JSON.parse(rawAuth) as ProviderAuthFile;
      const credentials = authFile.openai;

      if (!credentials) {
        return undefined;
      }

      return {
        provider: "openai",
        model: "gpt-4.1-mini",
        credentials,
      };
    } catch {
      return undefined;
    }
  }
}
```

The class does not validate every possible malformed file yet. It has one
teaching job: keep auth-file I/O out of `cli.ts` and out of `AgentLoop`.

## The Setup Script

Create `scripts/setup-provider.ts` as a setup utility, not an agent command.

The chapter can start with a development version:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProviderAuthFile } from "@/model/provider-auth";

const authPath = ".ty-term/auth.json";
const authType = process.env.TY_TERM_PROVIDER_AUTH_TYPE ?? "subscription";
const token = process.env.TY_TERM_PROVIDER_TOKEN ?? "dev-token";

const authFile: ProviderAuthFile = {
  openai:
    authType === "api_key"
      ? { type: "api_key", provider: "openai", key: token }
      : { type: "subscription", provider: "openai", accessToken: token },
};

await mkdir(dirname(authPath), { recursive: true });
await writeFile(authPath, `${JSON.stringify(authFile, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});

console.log(`wrote ${authPath} for openai ${authFile.openai.type} auth`);
```

Then add a package script:

```json
{
  "scripts": {
    "setup:provider": "bun run scripts/setup-provider.ts"
  }
}
```

Later, the same setup boundary can grow into a real subscription flow:

```text
setup script opens browser
user signs in with subscription provider
provider redirects to localhost callback
setup script writes refreshed auth.json
```

That later growth does not require `AgentLoop` to change. It also does not force
Chapter 3 to teach callback servers before the harness has learned tools,
sessions, or an interactive loop.

## A Real Provider Client

The real-provider implementation depends on provider auth, not on process
environment:

```ts
import OpenAI from "openai";
import type { AgentMessage } from "@/agent/agent-message";
import type { ModelClient } from "@/model/model-client";
import type { ProviderConfig } from "@/model/provider-config";

export class ProviderModelClient implements ModelClient {
  private readonly client: OpenAI;

  constructor(private readonly config: ProviderConfig) {
    if (config.provider !== "openai") {
      throw new Error(`Unsupported provider: ${config.provider}`);
    }

    if (config.credentials.type !== "api_key") {
      throw new Error(
        "subscription auth transport is added in a later chapter",
      );
    }

    this.client = new OpenAI({ apiKey: config.credentials.key });
  }

  async createResponse(messages: AgentMessage[]): Promise<string> {
    const response = await this.client.responses.create({
      model: this.config.model,
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });

    return response.output_text;
  }
}
```

The constructor guard is honest. Chapter 3 teaches the auth shape that can hold
subscription credentials, but it does not implement the subscription transport
yet. That can come later, when the book is ready to teach provider-specific auth
refresh and request plumbing.

The important part is that `ProviderModelClient` receives resolved provider
config. It does not read `process.env` itself, and `AgentLoop` does not know
what kind of auth was used.

## The Agent Loop

Now we can name the object that owns a turn.

`src/agent/agent-loop.ts`:

```ts
import { AgentMessageFactory } from "@/agent/agent-message-factory";
import type { Conversation } from "@/agent/conversation";
import type { ModelClient } from "@/model/model-client";

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

## The CLI Composes Dependencies

The CLI now chooses a model client and wires the objects together.

`src/cli.ts`:

```ts
#!/usr/bin/env bun

import { AgentLoop } from "@/agent/agent-loop";
import { AgentMessageFactory } from "@/agent/agent-message-factory";
import { Conversation } from "@/agent/conversation";
import { EchoModelClient } from "@/model/echo-model-client";
import { ProviderModelClient } from "@/model/provider-model-client";
import { ProviderAuthStore } from "@/model/provider-auth-store";

const prompt = process.argv.slice(2).join(" ");

if (prompt.length === 0) {
  console.error('Usage: bun run dev -- "your prompt"');
  process.exit(1);
}

const providerAuthStore = new ProviderAuthStore();
const providerConfig = await providerAuthStore.loadProviderConfig();
const messageFactory = new AgentMessageFactory();
const modelClient =
  providerConfig?.credentials.type === "api_key"
    ? new ProviderModelClient(providerConfig)
    : new EchoModelClient();
const agentLoop = new AgentLoop(messageFactory, modelClient);
const conversation = new Conversation();

await agentLoop.runTurn(conversation, prompt);

console.log(conversation.renderTranscript());
```

This file still has a few responsibilities, but they are process-level
responsibilities:

- read process arguments
- reject a missing prompt
- load local provider auth
- choose the model client for this process
- construct the objects for this process
- print the transcript

It does not build messages, call the provider SDK, append conversation history,
or render transcript lines itself.

Notice the fallback: if setup has not produced usable provider auth, the CLI
uses `EchoModelClient`. That keeps the chapter runnable and keeps provider setup
from becoming a prerequisite for learning the architecture.

## The Tests

The tests should lock down the object boundaries:

- `EchoModelClient` is deterministic.
- `AgentLoop` appends a complete user/assistant turn.
- `AgentLoop` passes prior context to the model.
- `Conversation` still renders the final transcript.
- `ProviderAuthStore` reads local auth without involving `AgentLoop`.

Start with `tests/agent-loop.test.ts`:

```ts
import { AgentLoop } from "@/agent/agent-loop";
import type { AgentMessage } from "@/agent/agent-message";
import { AgentMessageFactory } from "@/agent/agent-message-factory";
import { Conversation } from "@/agent/conversation";
import { EchoModelClient } from "@/model/echo-model-client";
import type { ModelClient } from "@/model/model-client";

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

Keep real provider calls out of the test suite. If you test auth loading, use a
temporary auth file and assert the parsed structure. Do not snapshot model
output.

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

Write development provider auth:

```bash
TY_TERM_PROVIDER_AUTH_TYPE=api_key TY_TERM_PROVIDER_TOKEN=sk-... bun run setup:provider
```

Expected output:

```text
wrote .ty-term/auth.json for openai api_key auth
```

Then run the same prompt command:

```bash
bun run dev -- "Explain a model boundary in one sentence"
```

The exact assistant text will vary if this path calls the real provider.

If setup writes subscription auth instead, Chapter 3 still falls back to echo
until a later chapter adds the subscription transport:

```bash
TY_TERM_PROVIDER_AUTH_TYPE=subscription TY_TERM_PROVIDER_TOKEN=dev-token bun run setup:provider
bun run dev -- "hello"
```

That is an intentional simplification. The file shape is ready for subscription
auth, but the real request path remains small.

## How It Works

The chapter's data flow is:

```text
bun run setup:provider
  -> writes .ty-term/auth.json

cli.ts
  -> new ProviderAuthStore()
  -> load provider config if present
  -> new EchoModelClient() or new ProviderModelClient(config)
  -> new AgentMessageFactory()
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
objects, request options, streaming events, retries, auth refresh, model lists,
or provider-specific response shapes. The loop asks for assistant text and
receives assistant text.

That is enough for one model call. Future chapters will widen this boundary only
when the code needs more behavior.

## Simplifications

We are deliberately not adding:

- in-agent login commands
- subscription OAuth transport
- token refresh
- provider model lists
- logout
- OS keychain integration
- browser launching
- callback server handling
- streaming output
- system or developer messages
- tool calls
- retries
- token counting
- conversation truncation
- multiple real model vendors
- snapshot tests for real model output

Those are real concerns, but adding them here would hide the lesson. The lesson
is that a model call is a boundary, provider auth is a separate boundary, and
orchestration belongs in `AgentLoop`, not in `Conversation` or `cli.ts`.

## Handoff To Chapter 4

Chapter 3 gives the harness a model boundary, a real orchestration object, and a
local provider-auth boundary:

```text
AgentLoop + ModelClient + ProviderAuthStore
```

It also leaves setup outside the agent:

```text
scripts/setup-provider.ts
```

Chapter 4 should add the next runtime boundary: tools.

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
ProviderAuthStore owns local provider auth.
ToolRegistry owns tool lookup and execution dispatch.
```

Do not make `cli.ts` execute tools directly.
