# Chapter 3: Call One Hosted Model Provider

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

This chapter changes that. A turn now crosses a model boundary, but it should
not ask each reader to bring an OpenAI API key. In the product shape we are
building toward, model access belongs behind the application subscription. The
terminal harness receives an app-scoped provider token from setup and sends
model requests to a hosted provider gateway.

The important restraint is timing: Chapter 3 should not add in-agent login
commands, provider picker commands, localhost callback servers, or interactive
auth. Those are product behaviors we can tie into the agent later. For now,
setup stays outside the agent:

```text
bun run setup:provider
```

That setup script can open a browser, let the user choose a provider, listen for
a callback, and write a local provider config file. The agent loop does not know
how that happened. It only receives a `ModelClient`.

The local chapter remains runnable without setup by keeping the echo client as
the deterministic default:

```text
$ bun run dev -- "hello"
user: hello
assistant: agent heard: hello
```

## The New Boundary

The important move in this chapter is not "add an API key." The important move
is:

```text
Conversation owns history.
AgentLoop owns orchestration.
ModelClient owns model interaction.
Provider setup stays outside the agent.
```

That separation gives each object a narrow job:

- `Conversation` stores messages and renders a transcript.
- `AgentLoop` decides what happens during one turn.
- `ModelClient` turns conversation context into assistant text.
- `scripts/setup-provider.ts` obtains and saves hosted-provider configuration.
- `cli.ts` composes objects and prints the transcript.

This keeps the dependency direction clean:

```text
setup script -> hosted auth service -> provider config file

cli.ts
  -> load provider config when present
  -> AgentLoop
  -> Conversation + AgentMessageFactory + ModelClient
```

`cli.ts` may load configuration and compose dependencies. It should not know how
to perform a login callback. `Conversation` is allowed to know how to append
messages. It should not know whether assistant text came from an echo client, a
hosted OpenAI-backed gateway, a local model, or a future tool-aware loop.

## Why Not A Local Provider API Key

A direct OpenAI API integration uses API keys. That is the right shape for a
server-side gateway, but it is the wrong default lesson for this product.

If we make Chapter 3 require a local provider API key, we teach readers that
every local CLI user must provision platform credentials. That conflicts with
the intended subscription experience:

```text
user signs in through setup
app manages provider access
setup stores an app-scoped provider token
gateway performs provider calls
```

So this chapter treats provider access as application configuration. The setup
script may eventually perform browser login and a callback, but that behavior is
outside the agent for now. The callback does not mint an OpenAI API key for the
user. It completes a login against our app's subscription service. The hosted
service can then call OpenAI using server-held credentials, enforce
entitlements, meter usage, switch providers, or deny access without changing the
agent loop.

That distinction keeps the book honest:

- local tests do not need a network or provider account
- the CLI does not store provider secrets
- provider setup can evolve without touching `AgentLoop`
- later chapters can keep using `ModelClient` without caring how billing works

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

It is async because hosted providers are async. Even the deterministic echo
client implements the same async interface so the rest of the loop has one
shape.

## A Deterministic Model Client

Tests should not call a real model. They should not need credentials, network
access, provider availability, subscription state, or stable model output.

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
that a hosted provider needs. By reading the latest user message from the
context, the fake client behaves like a tiny implementation of the real
boundary.

## The Provider Config

Provider setup is not agent behavior yet. Give it a small data shape in
`src/model/provider-config.ts`:

```ts
export interface ProviderConfig {
  readonly baseUrl: string;
  readonly provider: string;
  readonly token: string;
}
```

The setup script will write that shape to a local file such as
`.ty-term/provider.json`:

```json
{
  "baseUrl": "https://api.ty-term.example",
  "provider": "openai",
  "token": "app-scoped-provider-token"
}
```

This is intentionally not called `OpenAIConfig`. OpenAI is one hosted provider
behind the application gateway. The local harness should depend on the app's
provider contract, not on OpenAI credentials.

In a production CLI, the token should live in the OS keychain or another
protected store. This chapter can use a local JSON file because the lesson is
the model boundary, not secure credential storage.

## The Hosted Provider Client

The real provider implementation talks to the app gateway, not directly to
OpenAI:

```ts
import type { AgentMessage } from "@/agent/agent-message";
import type { ModelClient } from "@/model/model-client";
import type { ProviderConfig } from "@/model/provider-config";

export class HostedModelClient implements ModelClient {
  constructor(private readonly config: ProviderConfig) {}

  async createResponse(messages: AgentMessage[]): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        provider: this.config.provider,
        messages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Hosted model request failed: ${response.status}`);
    }

    const body = (await response.json()) as { outputText: string };
    return body.outputText;
  }
}
```

This class hides the product-specific details:

- where the hosted model endpoint lives
- which provider setup selected
- how the app-scoped token is sent
- what response shape the gateway returns

The rest of the harness only sees `ModelClient`.

The chapter does not implement the gateway. The gateway is a product service,
not part of the local terminal harness. For local learning, the echo client is
the correctness oracle. For production shape, `HostedModelClient` shows the
boundary the CLI will call after setup exists.

## The Setup Script

Create `scripts/setup-provider.ts` as a setup utility, not an agent command.

The chapter can start with a development version:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProviderConfig } from "@/model/provider-config";

const configPath = ".ty-term/provider.json";

const config: ProviderConfig = {
  baseUrl:
    process.env.TY_TERM_PROVIDER_BASE_URL ?? "https://api.ty-term.example",
  provider: process.env.TY_TERM_PROVIDER ?? "openai",
  token: process.env.TY_TERM_PROVIDER_TOKEN ?? "dev-token",
};

await mkdir(dirname(configPath), { recursive: true });
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

console.log(`wrote ${configPath} for ${config.provider}`);
```

Then add a package script:

```json
{
  "scripts": {
    "setup:provider": "bun run scripts/setup-provider.ts"
  }
}
```

Later, the same script can grow into the real flow:

```text
setup script asks hosted auth service for a login URL
user chooses a provider in the browser
hosted auth service redirects to a localhost callback
setup script writes provider config
```

That later growth does not require `AgentLoop` to change. It also does not force
Chapter 3 to teach callback servers before the harness has even learned tools,
sessions, or an interactive loop.

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
hosted call does not leave a half-written turn with a user message but no
assistant message. That is a deliberate invariant for this chapter:

```text
Conversation contains complete turns after AgentLoop.runTurn() succeeds.
```

Later we may choose to record failed turns or partial events. That should be a
deliberate design change, not an accident caused by mutation order.

## The CLI Composes Dependencies

The CLI still has one job: run one prompt. It may choose a hosted model client
if setup has produced a provider config file, but it does not perform setup.

`src/cli.ts`:

```ts
#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { AgentLoop } from "@/agent/agent-loop";
import { AgentMessageFactory } from "@/agent/agent-message-factory";
import { Conversation } from "@/agent/conversation";
import { EchoModelClient } from "@/model/echo-model-client";
import { HostedModelClient } from "@/model/hosted-model-client";
import type { ModelClient } from "@/model/model-client";
import type { ProviderConfig } from "@/model/provider-config";

async function loadProviderConfig(): Promise<ProviderConfig | undefined> {
  try {
    const rawConfig = await readFile(".ty-term/provider.json", "utf8");
    return JSON.parse(rawConfig) as ProviderConfig;
  } catch {
    return undefined;
  }
}

const prompt = process.argv.slice(2).join(" ");

if (prompt.length === 0) {
  console.error('Usage: bun run dev -- "your prompt"');
  process.exit(1);
}

const providerConfig = await loadProviderConfig();
const messageFactory = new AgentMessageFactory();
const modelClient: ModelClient = providerConfig
  ? new HostedModelClient(providerConfig)
  : new EchoModelClient();
const agentLoop = new AgentLoop(messageFactory, modelClient);
const conversation = new Conversation();

await agentLoop.runTurn(conversation, prompt);

console.log(conversation.renderTranscript());
```

This is intentionally still a teaching version:

- setup is a separate script
- the CLI has no in-agent login command
- no callback server appears in the agent code
- no OpenAI API key is read from the shell

That is enough to move the architecture in the right direction. The CLI chooses
between a deterministic local client and an authenticated hosted client. It
does not know how OpenAI requests are made behind the gateway.

## The Tests

The tests should lock down the object boundaries:

- `EchoModelClient` is deterministic.
- `AgentLoop` appends a complete user/assistant turn.
- `AgentLoop` passes prior context to the model.
- `Conversation` still renders the final transcript.
- `HostedModelClient` sends the app-scoped token, not an OpenAI API key.

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

If you test `HostedModelClient`, keep the test focused on the HTTP contract. It
should assert that the request uses the app-scoped token:

```text
authorization: Bearer dev-token
```

Do not snapshot real model output. Do not call OpenAI from the test suite.

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

Prepare hosted-provider config during development:

```bash
TY_TERM_PROVIDER_TOKEN=dev-token bun run setup:provider
```

Expected output:

```text
wrote .ty-term/provider.json for openai
```

After that, the same prompt command can use the hosted model path:

```bash
bun run dev -- "Explain a model boundary in one sentence"
```

The exact assistant text will vary because that path calls the hosted gateway.

## How It Works

The chapter's data flow is:

```text
bun run setup:provider
  -> writes .ty-term/provider.json

cli.ts
  -> load provider config if present
  -> new AgentMessageFactory()
  -> new EchoModelClient() or new HostedModelClient(config)
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

The `ModelClient` interface is also deliberately small. It does not expose
provider SDK objects, request options, streaming events, retries, billing, or
provider-specific response shapes. The loop asks for assistant text and
receives assistant text.

That is enough for one model call. Future chapters will widen this boundary only
when the code needs more behavior.

## Simplifications

We are deliberately not adding:

- in-agent login commands
- a real hosted auth service
- OS keychain integration
- browser launching
- CSRF/state validation for the callback
- streaming output
- system or developer messages
- tool calls
- retries
- token counting
- conversation truncation
- multiple direct model vendors
- snapshot tests for real model output

Those are real concerns, but adding them here would hide the lesson. The lesson
is that model access is a boundary, and in this product that boundary is
subscription-backed. Orchestration belongs in `AgentLoop`, setup belongs outside
the agent, and provider credentials belong on the hosted service.

## Handoff To Chapter 4

Chapter 3 gives the harness a model boundary and a real orchestration object:

```text
AgentLoop + ModelClient
```

It also leaves a setup script outside the agent:

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
ToolRegistry owns tool lookup and execution dispatch.
```

Do not make `cli.ts` execute tools directly.
