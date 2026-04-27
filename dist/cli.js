#!/usr/bin/env bun
// @bun

// src/index.ts
function respondToPrompt(prompt) {
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length === 0) {
    return "agent needs a prompt";
  }
  return `agent heard: ${trimmedPrompt}`;
}

// src/cli.ts
var prompt = process.argv.slice(2).join(" ");
var response = respondToPrompt(prompt);
console.log(response);
