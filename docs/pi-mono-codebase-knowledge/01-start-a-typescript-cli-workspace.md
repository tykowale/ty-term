# Chapter 1: Start a Bun TypeScript CLI

## Where We Are

If you are recreating this chapter from scratch, start in a fresh project directory and run `bun init -y` to create the package root. By the end of this chapter, `ty-term` is a small Bun TypeScript project:

```text
ty-term/
  package.json
  tsconfig.json
  src/
  tests/
```

The build step writes a bundled CLI to `dist/cli.js`. The program still does almost nothing. It accepts one command-line prompt and prints a fixed response. That is enough for this chapter: prove the package wiring, the Bun bundle, the test runner, and the CLI entry point.

## Learning Objective

Set up the smallest Bun-driven TypeScript CLI that can be bundled, tested, and run on repeat.

The fake response is just a placeholder. The real outcome is a clean development loop:

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

This is a placeholder on purpose. Later chapters will replace it with model calls, parsing, and tool use. For now, `respondToPrompt` gives us one stable function to test and call from the terminal.

The empty-input branch adds one real edge case without turning this chapter into validation infrastructure.

## `ty-term/src/cli.ts`

```ts
import { respondToPrompt } from "./index";

const prompt = process.argv.slice(2).join(" ");
const response = respondToPrompt(prompt);

console.log(response);
```

The CLI is only an adapter: it reads arguments, joins them into one prompt, calls `respondToPrompt`, and prints the result.

Notice the import path:

```ts
import { respondToPrompt } from "./index";
```

The source stays extensionless on purpose. Bun resolves that path while bundling, and `moduleResolution: "Bundler"` lets TypeScript validate the same source-level import.

## `ty-term/tests/respond-to-prompt.test.ts`

```ts
import { describe, expect, it } from "bun:test";
import { respondToPrompt } from "../src/index";

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

The source files split behavior from the terminal adapter:

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

The CLI owns side effects. The function owns behavior. That separation is the pattern this book keeps using.

## Reference Note

Compare this wrapper with the real agent loop and session code in the reference project. Chapter 1 strips all of that away so we can focus on Bun, TypeScript, tests, and argument flow.

## Simplifications

The response is static and model-free.

The CLI takes one prompt from command-line arguments. It is not interactive.

There is one package rooted at `ty-term`, so the layout stays fixed across the book.

There is no linting, formatting, or docs site yet. Bun, TypeScript, and tests are enough for the first runnable slice.

## Handoff to Chapter 2

Chapter 1 leaves us with a working shell around fake behavior.

Chapter 2 replaces the single prompt string with a conversation representation. The next useful artifact is likely an `AgentMessage` type with `user` and `assistant` roles.

The next check should show the program building a small conversation and printing something inspectable, still without a model call.
