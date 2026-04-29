# Chapter 2: Represent a Conversation

Chapter 1 gave us the smallest useful command-line program:

```text
$ bun run dev -- "hello"
agent heard: hello
```

That proved the package, the Bun entry point, the build command, and the test
runner. It did not prove any agent architecture. The program still had this
shape:

```text
prompt -> response
```

The helper that made that work, `respondToPrompt()`, was disposable scaffolding.
This chapter removes it. A real agent does not only transform one string into
another string. It carries an ordered conversation: the user says something, the
assistant answers, and future turns need to see that history.

We are still not calling a model. We are not adding tools, persistence,
streaming, or an interactive terminal loop. We are making the first real domain
objects:

```text
src/
  agent/
    agent-message.ts
    agent-message-factory.ts
    conversation.ts
  cli.ts
  index.ts
tests/
  conversation.test.ts
```

The new output is still fake, but the shape is real:

```text
user: hello
assistant: agent heard: hello
```

## The New Boundary

Chapter 1 intentionally kept all domain behavior behind one function:

```ts
respondToPrompt(prompt: string): string
```

That was useful for proving the workspace. It is a bad long-term home for agent
behavior. If we keep adding to that function, or keep exporting more standalone
helpers from `src/index.ts`, the book teaches the same problem it should help
readers avoid: a pile of unrelated behavior with no clear owner.

This chapter replaces that helper with two owners:

- `AgentMessageFactory` owns message construction.
- `Conversation` owns ordered message history and transcript rendering.

The CLI remains a process adapter. It reads arguments and prints output. It does
not know how messages are shaped, how history is stored, or how transcripts are
formatted.

The barrel file, `src/index.ts`, also gets simpler. It exports the public pieces
from the `agent` folder, but it does not contain agent behavior itself.

## Message Data

Start with the plain data. A conversation is made of messages, and each message
needs a role and content:

```ts
export type AgentRole = "user" | "assistant";

export interface AgentMessage {
  role: AgentRole;
  content: string;
}
```

This belongs in `src/agent/agent-message.ts`.

The type is intentionally small. Real model APIs support more roles than this:
system instructions, tool calls, tool results, and provider-specific message
shapes. We will add those when the book needs them. For this chapter, only two
actors exist:

- `user`, the person typing into the CLI
- `assistant`, the fake local response

Keeping the role type narrow gives us one useful invariant: if a value is an
`AgentMessage`, its role cannot accidentally be `"usr"`, `"bot"`, or another
spelling. That matters because these role strings will become part of the model
boundary later.

The message type itself stays plain. It has no methods and no hidden state. A
message is a record of what happened.

Full file:

```ts
export type AgentRole = "user" | "assistant";

export interface AgentMessage {
  role: AgentRole;
  content: string;
}
```

## Message Construction Has An Owner

We could create messages inline:

```ts
{ role: "user", content: prompt }
```

That works once. It does not scale well. As soon as message creation is repeated
across the CLI, tests, model calls, tools, and session loading, every call site
has to remember the exact shape.

Instead, create `src/agent/agent-message-factory.ts`:

```ts
import type { AgentMessage } from "@/agent/agent-message";

export class AgentMessageFactory {
  createUserMessage(content: string): AgentMessage {
    return {
      role: "user",
      content,
    };
  }

  createAssistantMessage(content: string): AgentMessage {
    return {
      role: "assistant",
      content,
    };
  }
}
```

This class is small on purpose. The point is not ceremony. The point is
ownership.

When the code says:

```ts
messageFactory.createUserMessage(prompt);
```

the call site says what it wants, not how to shape it. If later chapters add
message IDs, timestamps, tool result roles, or provider metadata, construction
has one natural place to change.

The factory protects two simple invariants:

- user messages always have role `"user"`
- assistant messages always have role `"assistant"`

It does not trim content. It does not reject empty content. The conversation
model should record what happened. Validation can live at the process boundary
or user-experience layer when we need it.

## Conversation Owns History

Now we can name the central object for the chapter. A `Conversation` owns an
ordered list of messages:

```ts
import type { AgentMessage } from "@/agent/agent-message";
import { AgentMessageFactory } from "@/agent/agent-message-factory";

export class Conversation {
  private readonly messages: AgentMessage[];

  constructor(
    private readonly messageFactory: AgentMessageFactory,
    messages: AgentMessage[] = [],
  ) {
    this.messages = [...messages];
  }

  runTurn(prompt: string): void {
    const userMessage = this.messageFactory.createUserMessage(prompt);
    const assistantMessage = this.messageFactory.createAssistantMessage(
      `agent heard: ${prompt}`,
    );

    this.messages.push(userMessage, assistantMessage);
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

This is the first real domain object in the book.

The private `messages` array is important. If other code can freely push into a
conversation, the conversation does not really own its history. By keeping the
array private, every mutation has to go through a method on `Conversation`.

The constructor copies the incoming messages:

```ts
this.messages = [...messages];
```

That keeps a caller from handing the conversation an array and mutating it later
behind the conversation's back.

`getMessages()` also returns copies:

```ts
return this.messages.map((message) => ({ ...message }));
```

That gives tests and later model clients safe access to message records without
giving them the actual internal array.

## Why `runTurn()` Lives Here For Now

`Conversation.runTurn()` appends both sides of one fake exchange:

```ts
conversation.runTurn("hello");
```

In this chapter, that is acceptable because the assistant response is local and
deterministic:

```ts
`agent heard: ${prompt}`;
```

There is no model provider, no tool registry, no session store, and no project
instructions yet. The whole turn is just a state change inside the
conversation:

```text
append user message
append fake assistant message
```

That will not remain true forever. Once a turn means "call a model, maybe run a
tool, maybe call the model again, then persist the result," orchestration will
move up into an `AgentLoop`. `Conversation` will keep owning storage and
rendering, but it should not become a god object.

For now, `runTurn()` gives us a runnable checkpoint without introducing a
future abstraction too early.

## Transcript Rendering Belongs With The Conversation

A conversation is structured data. A transcript is a terminal view of that data.
The renderer walks the messages in order:

```ts
renderTranscript(): string {
  return this.messages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
}
```

The order matters. The first message happened before the second message. Later,
model calls will depend on that same order because a provider needs the history
in the order the conversation happened.

Keeping transcript rendering on `Conversation` is reasonable because rendering a
basic transcript is a view of the state the conversation owns. It does not read
from the terminal, print to stdout, call a model, or persist a session.

Full file:

```ts
import type { AgentMessage } from "@/agent/agent-message";
import { AgentMessageFactory } from "@/agent/agent-message-factory";

export class Conversation {
  private readonly messages: AgentMessage[];

  constructor(
    private readonly messageFactory: AgentMessageFactory,
    messages: AgentMessage[] = [],
  ) {
    this.messages = [...messages];
  }

  runTurn(prompt: string): void {
    const userMessage = this.messageFactory.createUserMessage(prompt);
    const assistantMessage = this.messageFactory.createAssistantMessage(
      `agent heard: ${prompt}`,
    );

    this.messages.push(userMessage, assistantMessage);
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

Read the chapter's core data flow as:

```text
AgentMessageFactory -> Conversation.runTurn() -> Conversation.renderTranscript()
```

## The CLI Stays Boring

The command-line file remains a process adapter. Update `src/cli.ts`:

```ts
#!/usr/bin/env bun

import { AgentMessageFactory } from "@/agent/agent-message-factory";
import { Conversation } from "@/agent/conversation";

const prompt = process.argv.slice(2).join(" ");
const messageFactory = new AgentMessageFactory();
const conversation = new Conversation(messageFactory);

conversation.runTurn(prompt);

console.log(conversation.renderTranscript());
```

This file does five things:

1. Reads command-line arguments.
2. Creates the dependencies for this tiny program.
3. Creates an empty conversation.
4. Runs one fake turn.
5. Prints the transcript.

That is all `cli.ts` should do. It is allowed to know about `process.argv` and
`console.log()` because those are process I/O concerns. It should not own
message construction, transcript formatting, model calls, tool execution, or
session persistence.

Each CLI invocation still starts from an empty conversation. Later, an
interactive loop or session store will provide an existing conversation. This
chapter keeps the run short so the representation is easy to inspect.

## What To Test

The tests should lock down ownership, not just output.

Add `tests/agent/agent-message-factory.test.ts`

```ts
import { AgentMessageFactory } from "@/agent/agent-message-factory";

describe("AgentMessageFactory", () => {
  it("creates user and assistant messages", () => {
    const messageFactory = new AgentMessageFactory();

    expect(messageFactory.createUserMessage("hello")).toEqual({
      role: "user",
      content: "hello",
    });

    expect(messageFactory.createAssistantMessage("agent heard: hello")).toEqual(
      {
        role: "assistant",
        content: "agent heard: hello",
      },
    );
  });
});
```

Add `tests/agent/conversation.test.ts`:

```ts
import { AgentMessageFactory } from "@/agent/agent-message-factory";
import { Conversation } from "@/agent/conversation";

describe("Conversation", () => {
    it("stores one user and assistant exchange", () => {
        const messageFactory = new AgentMessageFactory();
        const conversation = new Conversation(messageFactory);

        conversation.runTurn("hello");

        expect(conversation.getMessages()).toEqual([
            {
                role: "user",
                content: "hello",
            },
            {
                role: "assistant",
                content: "agent heard: hello",
            },
        ]);
    });

    it("renders the transcript without exposing storage concerns to the CLI", () => {
        const messageFactory = new AgentMessageFactory();
        const conversation = new Conversation(messageFactory);

        conversation.runTurn("hello");

        expect(conversation.renderTranscript()).toBe(
            "user: hello\nassistant: agent heard: hello",
        );
    });

    it("keeps an empty prompt visible", () => {
        const messageFactory = new AgentMessageFactory();
        const conversation = new Conversation(messageFactory);

        conversation.runTurn("");

        expect(conversation.renderTranscript()).toBe(
            "user: \nassistant: agent heard: ",
        );
    });
});
```

The second test is the architectural one. It checks that `Conversation` copies
messages at its boundary and returns safe snapshots. That is what makes it an
owner instead of a thin wrapper around an array.

The empty-prompt test may look surprising because Chapter 1 printed
`agent needs a prompt` for blank input. That validation belonged to the
temporary scaffold. This chapter is about representation. An empty prompt is
still a user turn, so the representation keeps it visible instead of silently
erasing it.

That does not mean empty input is good user experience. It means the core data
model should preserve what happened. A later terminal layer can decide whether
to reject blank input before it reaches the conversation.

## Remove The Old Scaffold

Because `respondToPrompt()` disappears in this chapter, the Chapter 1 test no
longer describes the program. Remove `tests/respond-to-prompt.test.ts` and use
`tests/conversation.test.ts` instead.

The replacement is not just a rename. The old test checked:

```text
prompt -> response
```

The new test checks:

```text
message factory -> conversation history -> transcript
```

That is the architectural shift.

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

Run the bundled CLI:

```bash
bun run dist/cli.js -- "hello"
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

The no-prompt case is not polished, but it is inspectable. We can see the user
turn, and we can see the assistant response generated from that turn.

The chapter is complete when all of these work:

```bash
bun install
bun run build
bun test
bun run dist/cli.js -- "hello"
```

## What Changed

Chapter 1 had this shape:

```text
terminal args -> cli.ts -> respondToPrompt(prompt) -> console.log(response)
```

Chapter 2 has this shape:

```text
terminal args
  -> cli.ts
  -> AgentMessageFactory
  -> Conversation.runTurn(prompt)
  -> Conversation.renderTranscript()
  -> console.log(transcript)
```

The important pieces are:

- `AgentMessage` names the role-tagged message record.
- `AgentMessageFactory` owns user and assistant message construction.
- `Conversation` owns ordered message history.
- `Conversation.runTurn()` appends one fake user/assistant exchange.
- `Conversation.getMessages()` exposes safe snapshots, not the internal array.
- `Conversation.renderTranscript()` turns structured state into terminal text.
- `src/index.ts` becomes a barrel instead of a behavior dump.
- `src/cli.ts` stays a process adapter.

The simplification is also explicit: the assistant response is fake and local.
That is why `Conversation.runTurn()` can own the turn for now.

Chapter 3 will introduce the model boundary. When a turn starts depending on a
`ModelClient`, we should be careful not to shove provider orchestration into
`Conversation`. The likely next object is `AgentLoop`: it can coordinate a
conversation and a model client while `Conversation` continues to own message
storage and rendering.
