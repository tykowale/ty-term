# Chapter 1: Start a TypeScript CLI

## Where We Are

We are starting from an empty `ty-term/` directory.

By the end of this chapter, `ty-term` will be a real, buildable Node TypeScript project:

```text
ty-term/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
  tests/
```

The agent will not call a model yet. It will not read files, run tools, or hold a conversation. It will only accept one command-line prompt and print a fake response.

That is intentional. Chapter 1 proves the wiring: npm, TypeScript build, test runner, and CLI execution.

## Learning Objective

Learn how to set up a small TypeScript package for a terminal coding harness.

The important idea is not the fake agent response. The important idea is that we now have a repeatable development loop:

```bash
npm install
npm run build
npm test
npm run dev -- "hello"
```

The oracle for this chapter is:

```text
agent heard: hello
```

If you can build, test, and run that command, the chapter is complete.

## Prerequisites

Install Node.js 24 LTS. This chapter was refreshed against Node `24.12.0` and npm `11.12.1`.

TypeScript 7 is available as a beta through `@typescript/native-preview@beta`, but this chapter stays on stable `typescript@6.0.3`. The TypeScript 7 beta uses the separate `tsgo` command today, so adopting it would add a compiler comparison to a chapter that is meant to teach package wiring.

## Build The Repo

Start from the parent directory where you want the book project to live.

```bash
mkdir ty-term
cd ty-term
mkdir -p src
mkdir -p tests
```

Initialize the package files manually. We are avoiding scaffolding tools because the goal is to see every moving part.

## `ty-term/package.json`

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

This manifest owns the runnable program and the project tooling.

We install conservative foundation dependencies up front:

- `openai` for the model-provider chapter later in the book
- `typescript` for type checking and build output
- `tsx` for running TypeScript directly during development
- `vitest` for tests
- `@types/node` for Node 24 globals like `process`

We install `openai` up front because Chapter 1 owns setup for the whole main path. Chapter 3 will be the first chapter that uses it, and tests will still run without an API key.

## `ty-term/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

This config builds only `src/`.

Tests live at `tests/`, but they are not emitted to `dist/`. Vitest can run TypeScript tests directly, so the build output stays focused on the CLI.

The most important choices are:

- `strict: true`, so the project starts with useful type checking.
- `module: NodeNext`, so TypeScript follows modern Node ESM rules.
- `declaration: true`, so the build can produce `.d.ts` files.
- `rootDir` and `outDir`, so source files build from `src/` into `dist/`.

## `ty-term/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"]
  }
});
```

The config is intentionally small. It makes the test location explicit without introducing aliases or framework-specific structure.

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

This is deliberately fake.

A real coding harness will eventually send messages to a model, parse the model's response, and maybe execute tools. Chapter 1 does none of that.

For now, `respondToPrompt` gives us a stable behavior to test and run from the terminal.

The small empty-prompt branch gives the function one real edge case without turning this chapter into validation infrastructure.

## `ty-term/src/cli.ts`

```ts
import { respondToPrompt } from "./index.js";

const prompt = process.argv.slice(2).join(" ");
const response = respondToPrompt(prompt);

console.log(response);
```

The CLI is only an adapter.

It reads command-line arguments, turns them into one prompt string, calls `respondToPrompt`, and prints the result.

Notice the import path:

```ts
import { respondToPrompt } from "./index.js";
```

The `.js` extension is intentional even though the source file is `index.ts`. With `module: "NodeNext"` and `moduleResolution: "NodeNext"`, TypeScript checks that relative ESM imports match the JavaScript paths Node will load after compilation.

## `ty-term/tests/respond-to-prompt.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { respondToPrompt } from "../src/index.js";

describe("respondToPrompt", () => {
  it("echoes a fake agent response for a prompt", () => {
    expect(respondToPrompt("hello")).toBe("agent heard: hello");
  });

  it("handles an empty prompt", () => {
    expect(respondToPrompt("   ")).toBe("agent needs a prompt");
  });
});
```

This test locks down the tiny behavior we have.

It is not testing model intelligence. It is testing that the first boundary of the program is callable and predictable.

That matters because future chapters will replace the fake implementation with real conversation and model behavior. When that happens, the tests will move with the concept.

## Try It

Install dependencies:

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

Run the CLI in development mode:

```bash
npm run dev -- "hello"
```

Expected output:

```text
agent heard: hello
```

Try the empty prompt too:

```bash
npm run dev
```

Expected output:

```text
agent needs a prompt
```

The chapter oracle is complete when all of these work:

```bash
npm install
npm run build
npm test
npm run dev -- "hello"
```

## How It Works

The project has two layers.

First, the package root owns commands, dependencies, and compiler configuration:

```text
ty-term/package.json
ty-term/tsconfig.json
ty-term/vitest.config.ts
```

Second, the source files separate behavior from the terminal adapter:

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

The invariant is simple:

`respondToPrompt` accepts a string and returns a string. It does not read from the terminal, write to stdout, call a model, or touch the filesystem.

That makes it easy to test.

The CLI owns side effects. The function owns behavior.

This is the first tiny version of a pattern we will keep using: isolate the part that decides what should happen from the part that talks to the outside world.

## Reference Note

Compare this tiny CLI wrapper with `pi-mono/packages/agent/src/agent-loop.ts` and `pi-mono/packages/coding-agent/src/core/agent-session.ts`.

`pi-mono` has a real agent loop, model calls, tools, session state, and TUI. Chapter 1 simplifies all of that away so we can prove only npm, TypeScript, tests, and CLI argument flow.

## Simplifications

The agent response is static. It does not use a language model.

The CLI accepts one prompt as command-line arguments. It is not interactive.

There is one npm package rooted at `ty-term`. The book keeps one layout so the learner can focus on harness behavior instead of repository structure.

There is no linting or formatting setup yet. TypeScript and tests are enough for the first runnable slice.

There is no README or documentation site in the build. The book chapter itself is the guide for now.

## Handoff to Chapter 2

Chapter 1 created a working shell around fake behavior.

Chapter 2 replaces the single prompt string with a conversation representation. The next useful artifact is likely an `AgentMessage` type with roles like `user` and `assistant`.

The Chapter 2 oracle should show the program constructing a small conversation and producing an inspectable representation, still without calling a model.
