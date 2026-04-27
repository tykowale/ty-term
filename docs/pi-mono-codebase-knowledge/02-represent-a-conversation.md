# Chapter 2: Represent a Conversation

## Where We Are

Chapter 1 gave us the smallest runnable agent CLI:

- An npm TypeScript project rooted at `ty-term`.
- A `respondToPrompt(prompt: string): string` function.
- A CLI that turned command-line arguments into one prompt.
- A fake assistant response: `agent heard: hello`.

That proved the package, CLI, build, and test loop worked. But the core idea was still too flat: one prompt goes in, one string comes out.

Real coding agents operate over a conversation: user messages, assistant messages, tool messages, system instructions, and eventually model responses. This chapter introduces the smallest useful version of that idea.

We will still avoid model calls, tools, persistence, streaming, and `readline`. The goal is only to make hidden state visible.

## Learning Objective

Represent an agent turn as a structured conversation.

By the end of this chapter, the agent will:

- Store messages with explicit roles.
- Append a user message and a fake assistant message for each turn.
- Return a new conversation instead of mutating the old one.
- Render the conversation as a CLI-friendly transcript.
- Test both the internal message structure and the visible transcript.

The important shift is:

```ts
// Chapter 1
prompt: string -> response: string

// Chapter 2
conversation + prompt -> new conversation
```

## Build The Slice

Change three files from the Chapter 1 baseline:

- `src/index.ts`
- `src/cli.ts`
- `tests/agent.test.ts`

No new dependencies are needed, so Chapter 1's setup stays unchanged.

We will preserve prompt content exactly instead of trimming it. That includes the empty string. A terminal coding harness should not silently rewrite the user's input at the core logic layer. Later, a CLI or UI can choose to validate or normalize input before it reaches the agent loop.

## `src/index.ts`

```ts
export type AgentRole = "user" | "assistant";

export interface AgentMessage {
  role: AgentRole;
  content: string;
}

export type Conversation = AgentMessage[];

export function createUserMessage(content: string): AgentMessage {
  return {
    role: "user",
    content,
  };
}

export function createAssistantMessage(content: string): AgentMessage {
  return {
    role: "assistant",
    content,
  };
}

export function runTurn(
  conversation: Conversation,
  prompt: string,
): Conversation {
  const userMessage = createUserMessage(prompt);
  const assistantMessage = createAssistantMessage(`agent heard: ${prompt}`);

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

import { renderTranscript, runTurn } from "./index.js";

const prompt = process.argv.slice(2).join(" ");
const conversation = runTurn([], prompt);

console.log(renderTranscript(conversation));
```

The `.js` extension is intentional even though the source file is `index.ts`. With `module: "NodeNext"` and `moduleResolution: "NodeNext"`, TypeScript checks that relative ESM imports match the JavaScript paths Node will load after compilation.

## `tests/agent.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  type Conversation,
  createAssistantMessage,
  createUserMessage,
  renderTranscript,
  runTurn,
} from "../src/index.js";

describe("runTurn", () => {
  it("appends a user message and assistant message without mutating the input", () => {
    const existingConversation: Conversation = [
      createAssistantMessage("ready"),
    ];

    const nextConversation = runTurn(existingConversation, "hello");

    expect(existingConversation).toEqual([
      {
        role: "assistant",
        content: "ready",
      },
    ]);

    expect(nextConversation).toEqual([
      {
        role: "assistant",
        content: "ready",
      },
      {
        role: "user",
        content: "hello",
      },
      {
        role: "assistant",
        content: "agent heard: hello",
      },
    ]);

    expect(nextConversation).not.toBe(existingConversation);
  });

  it("keeps an empty prompt visible", () => {
    const conversation = runTurn([], "");

    expect(conversation).toEqual([
      {
        role: "user",
        content: "",
      },
      {
        role: "assistant",
        content: "agent heard: ",
      },
    ]);
  });
});

describe("renderTranscript", () => {
  it("renders messages in CLI-friendly role order", () => {
    const conversation: Conversation = [
      createUserMessage("hello"),
      createAssistantMessage("agent heard: hello"),
    ];

    expect(renderTranscript(conversation)).toBe(
      "user: hello\nassistant: agent heard: hello",
    );
  });

  it("renders empty message content without hiding the message", () => {
    const conversation = runTurn([], "");

    expect(renderTranscript(conversation)).toBe(
      "user: \nassistant: agent heard: ",
    );
  });
});
```

## Try It

Install dependencies if needed:

```bash
npm install
```

Build the package:

```bash
npm run build
```

Run the tests:

```bash
npm test
```

Run the CLI with a prompt:

```bash
npm run dev -- "hello"
```

Expected output:

```text
user: hello
assistant: agent heard: hello
```

Run the CLI with no prompt:

```bash
npm run dev
```

Expected output:

```text
user:
assistant: agent heard:
```

The empty prompt is intentionally visible. The agent still records that a user turn happened. A later interface can decide whether empty input should be rejected before it reaches the core.

## How It Works

The new central type is `AgentMessage`:

```ts
export interface AgentMessage {
  role: AgentRole;
  content: string;
}
```

A message has two pieces of information:

- `role`: who produced the message.
- `content`: what they said.

For now, there are only two roles:

```ts
export type AgentRole = "user" | "assistant";
```

That is enough for a fake conversation. Later chapters can add tool-related roles or richer message types, but adding them now would make this chapter about architecture instead of representation.

The conversation is just an array:

```ts
export type Conversation = AgentMessage[];
```

This is deliberately plain. A future `AgentSession` may own the conversation, model client, tools, and execution state. For Chapter 2, an array teaches the shape without hiding it behind a class.

The main behavior moved from `respondToPrompt` to `runTurn`:

```ts
export function runTurn(
  conversation: Conversation,
  prompt: string,
): Conversation {
  const userMessage = createUserMessage(prompt);
  const assistantMessage = createAssistantMessage(`agent heard: ${prompt}`);

  return [...conversation, userMessage, assistantMessage];
}
```

The function takes the existing conversation and returns the next conversation. It does not push into the input array.

That gives us an important invariant:

> Running a turn creates a new conversation value.

This makes tests easier to reason about, and it prevents surprising side effects when later code wants to inspect the previous state.

The CLI now renders a transcript instead of printing only the assistant response:

```ts
const conversation = runTurn([], prompt);

console.log(renderTranscript(conversation));
```

The renderer is intentionally simple:

```ts
export function renderTranscript(conversation: Conversation): string {
  return conversation
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
}
```

This is not a fancy terminal UI. It is a debugging window into the agent's state.

## Reference Note

Compare this chapter with `pi-mono/packages/agent/src/types.ts`, `pi-mono/packages/agent/src/agent-loop.ts`, and `pi-mono/packages/coding-agent/src/core/session-manager.ts`.

`pi-mono` has richer message types, custom UI-only messages, tool-result messages, session entries, and context conversion for model providers. The simplified idea we keep is this:

> An agent loop is easier to understand when every turn produces structured state, not just a string.

The part we intentionally skip is production session machinery. Our `Conversation` array is the smallest version of the same concept.

## Simplifications

This chapter still avoids:

- Model APIs.
- Tool calls.
- Streaming output.
- Persistent chat history.
- Multi-turn interactive input.
- `readline`.
- System prompts.
- Error handling around external services.

The assistant response is still fake. That is useful because it lets us focus on state shape and tests before introducing network behavior.

## Handoff to Chapter 3

Chapter 2 gives the agent a visible conversation representation.

Chapter 3 introduces the first external boundary: a `ModelClient`. The fake assistant text will move behind a model-like interface first, then the chapter will show how to swap in one real provider without changing the conversation representation.
