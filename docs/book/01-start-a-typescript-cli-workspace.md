# Chapter 1: Start a Bun TypeScript CLI

## Where We Are

Start in a fresh project directory and run `bun init -y` to create the package root. By the end of this chapter, `ty-term` is a small Bun TypeScript project:

```text
ty-term/
  package.json
  tsconfig.json
  src/
  tests/
```

The goal here is to setup everything and make sure it works. We'll build a CLI that accepts one command-line prompt and prints a fixed response. Prove the package wiring, the Bun bundle, the test runner, and the CLI entry point.

This chapter is deliberately not where we design the agent. The fake response function gives the terminal something to call, but it is scaffolding. Starting in Chapter 2, the domain model moves into named objects such as `AgentMessageFactory` and `Conversation` so the CLI does not become the place where agent behavior piles up.

## Learning Objective

Set up the smallest Bun-driven TypeScript CLI that can be bundled, tested, and run on repeat.

```bash
bun install
bun run build
bun test
bun run dev -- "hello"
```

Expected output:

```text
agent heard: hello
```

If that command works, the chapter is done.

## Prerequisites

Use Bun `1.3.5`. This chapter was refreshed against Bun `1.3.5`.

Keep stable TypeScript `6.0.3` for editor and type-checking support. Bun handles the bundle and the tests.

## Build The Repo

If you are recreating this chapter from scratch, start in the directory where the project should live.

```bash
mkdir -p src
mkdir -p tests
```

Initialize the package with `bun init -y`, then add the files below. The layout stays small on purpose.

## `ty-term/package.json`

```json
{
  "name": "ty-term",
  "private": true,
  "version": "0.1.0",
  "description": "A minimal terminal coding harness built as a teaching project.",
  "type": "module",
  "packageManager": "bun@1.3.5",
  "bin": {
    "hobby-agent": "./dist/cli.js"
  },
  "scripts": {
    "build": "bun build src/cli.ts --outfile dist/cli.js --target bun",
    "test": "bun test",
    "dev": "bun run src/cli.ts"
  },
  "dependencies": {
    "openai": "^6.34.0"
  },
  "devDependencies": {
    "bun-types": "^1.3.5",
    "typescript": "^6.0.3"
  }
}
```

This manifest owns the CLI, the bundle, and the test command. The dependencies are the minimum foundation for later chapters:

- `openai` for the model-provider chapter later in the book
- `bun-types` for Bun globals and `bun:test`
- `typescript` for editor and type-checking support

`openai` is installed early so later chapters can use it without changing the project shape. Nothing in this chapter depends on an API key.

## `ty-term/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@tests/*": ["tests/*"]
    },
    "ignoreDeprecations": "6.0",
    "lib": ["ES2022"],
    "types": ["bun-types"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

The compiler config is for editor and type-checking support now. Bun owns the actual bundle, so `tsconfig.json` only needs to understand the source graph and the test files.

The key settings are:

- `strict: true`, so the project starts with useful type checking.
- `moduleResolution: "Bundler"`, so TypeScript accepts the same extensionless imports Bun bundles.
- `baseUrl` and `paths`, so project files can use absolute imports like `@/index` instead of walking through relative paths.
- `types: ["bun-types"]`, so the test runner and Bun globals are available to the checker.
- `noEmit: true`, so `tsc` stays in the background while Bun produces the runnable bundle.

## `ty-term/src/index.ts`

```ts
export function respondToPrompt(prompt: string): string {
  const trimmedPrompt = prompt.trim();

  if (trimmedPrompt.length === 0) {
    return "agent needs a prompt";
  }

  return `agent heard: ${trimmedPrompt}`;
}
```

This is a placeholder on purpose. It is not the first draft of our agent architecture; it is a temporary seam that lets us test the package before the real domain objects exist.

For now, `respondToPrompt` gives us one stable function to test and call from the terminal. In Chapter 2, this function goes away. Message construction will belong to `AgentMessageFactory`, and ordered conversation state will belong to `Conversation`.

The empty-input branch adds one real edge case without turning this chapter into validation infrastructure.

## `ty-term/src/cli.ts`

```ts
import { respondToPrompt } from "@/index";

const prompt = process.argv.slice(2).join(" ");
const response = respondToPrompt(prompt);

console.log(response);
```

The CLI is only an adapter: it reads arguments, joins them into one prompt, calls `respondToPrompt`, and prints the result.

That boundary matters more than the tiny code suggests. `cli.ts` is allowed to know about `process.argv` and `console.log()` because those are process I/O concerns. It should not become the home for message history, model calls, tool execution, or session persistence. As the book grows, those responsibilities move into classes with names that describe what they own.

Notice the import path:

```ts
import { respondToPrompt } from "@/index";
```

The source stays extensionless on purpose. Bun resolves that path while bundling, and `moduleResolution: "Bundler"` lets TypeScript validate the same source-level import.

## `ty-term/tests/respond-to-prompt.test.ts`

```ts
import { describe, expect, it } from "bun:test";
import { respondToPrompt } from "@/index";

describe("respondToPrompt", () => {
  it("echoes a fake agent response for a prompt", () => {
    expect(respondToPrompt("hello")).toBe("agent heard: hello");
  });

  it("handles an empty prompt", () => {
    expect(respondToPrompt("   ")).toBe("agent needs a prompt");
  });
});
```

This test locks down the only behavior in the chapter. It is not testing model quality; it is checking that the program boundary is callable and predictable.

Later chapters will swap in real conversation logic, and the tests will follow that boundary.

## Try It

Install dependencies:

```bash
bun install
```

Build the bundle:

```bash
bun run build
```

Run the tests:

```bash
bun test
```

Run the CLI in development mode:

```bash
bun run dev -- "hello"
```

Expected output:

```text
agent heard: hello
```

Run the bundled CLI directly:

```bash
bun run dist/cli.js -- "hello"
```

Expected output:

```text
agent heard: hello
```

Try the empty prompt too:

```bash
bun run dev
```

Expected output:

```text
agent needs a prompt
```

The chapter is complete when all of these work:

```bash
bun install
bun run build
bun test
bun run dist/cli.js -- "hello"
```

## How It Works

The project has two layers. The package root owns Bun commands, dependencies, and compiler configuration:

```text
ty-term/package.json
ty-term/tsconfig.json
```

The source files split temporary behavior from the terminal adapter:

```text
src/index.ts
src/cli.ts
```

The data flow is:

```text
terminal args
  -> cli.ts
  -> respondToPrompt(prompt)
  -> console.log(response)
```

Bun's bundler turns that source graph into `dist/cli.js`. The invariant is simple: `respondToPrompt` takes a string and returns a string. It does not read the terminal, print, call a model, or touch the filesystem.

The CLI owns process side effects. The placeholder function owns the fake behavior for this one chapter.

The separation is the pattern this book keeps using, but the owner will change. A single standalone function is fine for proving the workspace. It would be a poor home for a real agent. Once we need messages, history, providers, tools, and sessions, each concept gets an object boundary instead of being jammed into `index.ts` or `cli.ts`.

## Reference Note

Compare this wrapper with the real agent loop and session code in the reference project. Chapter 1 strips all of that away so we can focus on Bun, TypeScript, tests, and argument flow.

## Simplifications

The response is static and model-free.

`respondToPrompt` is intentionally disposable. It exists so this chapter has a runnable checkpoint before Chapter 2 introduces the real conversation objects.

The CLI takes one prompt from command-line arguments. It is not interactive.

There is one package rooted at `ty-term`, so the layout stays fixed across the book.

ESLint and Prettier are configured in the repo, but this chapter leaves them out for brevity. Bun, TypeScript, and tests are enough for the first runnable slice.

## Handoff to Chapter 2

Chapter 1 leaves us with a working shell around fake behavior.

Chapter 2 replaces the single prompt string with a conversation representation. The next useful artifacts are `AgentMessageFactory`, which creates user and assistant messages, and `Conversation`, which owns ordered message history and transcript rendering.

The next check should show the program building a small conversation and printing something inspectable, still without a model call.
