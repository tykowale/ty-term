#!/usr/bin/env bun

import { respondToPrompt } from "./index";

const prompt = process.argv.slice(2).join(" ");
const response = respondToPrompt(prompt);

console.log(response);
