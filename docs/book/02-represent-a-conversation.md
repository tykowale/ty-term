# Chapter 2: Represent a Conversation

## Where We Are

Chapter 1 gave us the smallest runnable Bun CLI:

- A Bun TypeScript project rooted at `ty-term`.
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

## What We're Building

This chapter turns the single-string prompt from Chapter 1 into a conversation value. A turn will take the current conversation plus a new prompt and return a new conversation that includes both the user message and a fake assistant response.

That gives us three useful pieces at once:

- A small, explicit message type with a role and content.
- A pure turn function that returns a new conversation instead of mutating the old one.
- A transcript renderer that makes the result easy to inspect from the CLI.

We will keep the imports extensionless because Bun bundles the source directly, and `moduleResolution: "Bundler"` matches that source-level style.

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
#!/usr/bin/env bun

import { renderTranscript, runTurn } from "./index";

const prompt = process.argv.slice(2).join(" ");
const conversation = runTurn([], prompt);

console.log(renderTranscript(conversation));
```

The source stays extensionless on purpose. Bun resolves these imports while bundling, and `moduleResolution: "Bundler"` lets TypeScript validate the same source-level import style.

## `tests/agent.test.ts`

```ts
import { describe, expect, it } from "bun:test";
import {
  type Conversation,
  createAssistantMessage,
  createUserMessage,
  renderTranscript,
  runTurn,
} from "../src/index";

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
bun install
```

Build the package:

```bash
bun run build
```

Run the tests:

```bash
bun test
```

Run the CLI with a prompt:

```bash
bun run dev -- "hello"
```

Expected output:

```text
user: hello
assistant: agent heard: hello
```

Run the CLI with no prompt:

```bash
bun run dev
```

Expected output:

```text
user:
assistant: agent heard:
```

The empty prompt is intentionally visible. The agent still records that a user turn happened. A later interface can decide whether empty input should be rejected before it reaches the core.

That is the whole chapter: one plain conversation type, one pure turn function, and one CLI transcript. Chapter 3 will introduce the first model boundary without changing that structure.
