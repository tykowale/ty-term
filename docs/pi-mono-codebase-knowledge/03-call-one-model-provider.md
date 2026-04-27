# Chapter 3: Call One Model Provider

## Where We Are

Chapter 2 gave the harness a tiny conversation loop:

- `AgentRole = "user" | "assistant"`
- `AgentMessage`
- `Conversation`
- message constructors
- `runTurn(conversation, prompt)`
- `renderTranscript`
- a CLI that runs one fake assistant turn

That was enough to prove the shape of the loop, but the assistant response was still hard-coded. In this chapter, we add the first real boundary: a model client.

The important move is not "use OpenAI everywhere." The important move is that the loop should not care where assistant text comes from.

We are still in one package rooted at `ty-term`. The new concept is a boundary, not a new directory structure.

## Learning Objective

By the end of this chapter, the harness will:

- define a `ModelClient` interface
- keep a no-key `createEchoModelClient()` for tests and local learning
- add one real provider through the official `openai` npm package
- make `runTurn` async
- keep tests deterministic by using the echo client only
- let the CLI run without an API key by default

The chapter stays runnable for every reader. A real model call is optional.

## Chapter 1 Setup Update

Chapter 1's root `package.json` should already include `openai`:

```json
"dependencies": {
  "openai": "^6.34.0"
}
```

The official OpenAI JavaScript/TypeScript SDK supports the Responses API with `client.responses.create(...)` and exposes `response.output_text` for text output. See the official Node SDK and library docs:

- https://github.com/openai/openai-node
- https://platform.openai.com/docs/libraries/node-js-library

## Build The Slice

We are going to change one thing about the loop.

Chapter 2:

```ts
runTurn(conversation, prompt);
```

Chapter 3:

```ts
await runTurn(conversation, prompt, modelClient);
```

That one extra argument gives the loop a dependency it can call. Tests pass an echo client. The CLI can pass either echo or OpenAI.

## `ty-term/package.json`

If your Chapter 1 file does not already include `openai`, update it now:

```json
{
  "name": "ty-term",
  "private": true,
  "version": "0.1.0",
  "description": "A minimal terminal coding harness built as a teaching project.",
  "type": "module",
  "packageManager": "npm@11.12.1",
  "bin": {
    "hobby-agent": "./dist/cli.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "dev": "tsx src/cli.ts"
  },
  "dependencies": {
    "openai": "^6.34.0"
  },
  "devDependencies": {
    "@types/node": "^24.12.2",
    "tsx": "^4.21.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.5"
  }
}
```

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
```

## `src/cli.ts`

```ts
#!/usr/bin/env node

import {
  type Conversation,
  createEchoModelClient,
  createOpenAIModelClient,
  renderTranscript,
  runTurn,
} from "./index.js";

const args = process.argv.slice(2);
const useOpenAI = args.includes("--openai");
const prompt = args.filter((arg) => arg !== "--openai").join(" ");

if (prompt.length === 0) {
  console.error('Usage: npm run dev -- [--openai] "your prompt"');
  process.exit(1);
}

if (useOpenAI && !process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required when using --openai.");
  process.exit(1);
}

const modelClient = useOpenAI
  ? createOpenAIModelClient()
  : createEchoModelClient();
const conversation: Conversation = [];
const nextConversation = await runTurn(conversation, prompt, modelClient);

console.log(renderTranscript(nextConversation));
```

The CLI uses a flag instead of silently switching when `OPENAI_API_KEY` exists. That keeps the default path no-key and deterministic. A reader can keep an API key in their shell without accidentally spending tokens while following the early chapters.

## `tests/agent.test.ts`

Update the Chapter 2 test file with this behavior-focused version:

```ts
import { describe, expect, it } from "vitest";
import {
  createEchoModelClient,
  renderTranscript,
  runTurn,
  type Conversation,
} from "../src/index.js";

describe("runTurn", () => {
  it("adds a user message followed by the model response", async () => {
    const conversation = await runTurn([], "hello", createEchoModelClient());

    expect(conversation).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "agent heard: hello" },
    ]);
  });

  it("does not mutate the previous conversation", async () => {
    const original: Conversation = [{ role: "user", content: "earlier" }];

    await runTurn(original, "next", createEchoModelClient());

    expect(original).toEqual([{ role: "user", content: "earlier" }]);
  });

  it("renders a transcript", async () => {
    const conversation = await runTurn([], "hello", createEchoModelClient());

    expect(renderTranscript(conversation)).toBe(
      "user: hello\nassistant: agent heard: hello",
    );
  });
});
```

Tests use `createEchoModelClient()` only. They do not need network access, credentials, model availability, or stable model output.

## Try It

Install dependencies if needed:

```bash
npm install
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run the CLI without an API key:

```bash
npm run dev -- "hello"
```

Expected output:

```text
user: hello
assistant: agent heard: hello
```

Optionally call the real provider:

```bash
OPENAI_API_KEY=your_api_key npm run dev -- --openai "Explain what a model boundary is in one sentence"
```

Expected shape:

```text
user: Explain what a model boundary is in one sentence
assistant: A model boundary is the small interface where your application hands conversation context to a model provider and receives assistant text back.
```

The exact assistant text will vary because this command calls a real model.

You can choose a different model without changing code:

```bash
OPENAI_API_KEY=your_api_key OPENAI_MODEL=gpt-5.2 npm run dev -- --openai "Say hello from the harness"
```

## How It Works

`ModelClient` is the first real boundary in the harness:

```ts
export interface ModelClient {
  createResponse(prompt: string, conversation: Conversation): Promise<string>;
}
```

The core loop knows only this:

1. create a user message
2. ask a model client for assistant text
3. create an assistant message
4. return a new conversation

That makes `runTurn` independent from OpenAI, test doubles, local models, or future tool-aware model clients.

The echo client is intentionally boring:

```ts
return `agent heard: ${prompt}`;
```

It is not pretending to be intelligent. It gives the tests a stable oracle.

`runTurn` becomes async because real model calls are async:

```ts
const assistantContent = await modelClient.createResponse(prompt, conversation);
```

That is the main design pressure introduced in this chapter. Once the agent loop crosses a network boundary, the rest of the loop must be able to wait.

## Reference Note

Compare this chapter with:

- `pi-mono/packages/agent/src/agent-loop.ts`
- `pi-mono/packages/coding-agent/src/core/agent-session.ts`
- `pi-mono/packages/ai/src/stream.ts`

`pi-mono` has to think about streaming, cancellation, tool calls, retries, telemetry, context limits, provider configuration, and error reporting. Chapter 3 only needs the first boundary:

> given a conversation, return assistant text.

## Simplifications

We are deliberately not adding:

- streaming output
- system or developer messages
- tool calls
- retry configuration
- token counting
- conversation truncation
- provider registry
- multiple model vendors
- snapshot tests for real model output

Those are real concerns, but adding them now would blur the lesson. The important step is making the loop async and provider-independent.

## Handoff to Chapter 4

Chapter 3 gives the harness a model boundary.

Chapter 4 adds the next boundary: tools.

The next useful slice is:

- define a `ToolDefinition` interface
- add one safe toy tool, such as `getCurrentDirectory`
- keep tool execution separate from model calling
- teach the loop how to represent "the assistant wants a tool" without building a full agent yet

At that point, the harness will have the two basic edges of a coding agent: one boundary for model text and one boundary for actions in the terminal.
