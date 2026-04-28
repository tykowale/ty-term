#!/usr/bin/env bun

import { renderTranscript, runTurn } from "./index";

const prompt = process.argv.slice(2).join(" ");
const conversation = runTurn([], prompt);

console.log(renderTranscript(conversation));
