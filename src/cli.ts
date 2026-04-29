#!/usr/bin/env bun

import { AgentMessageFactory } from "./agent/agent-message-factory";
import { Conversation } from "./agent/conversation";

const prompt = process.argv.slice(2).join(" ");
const messageFactory = new AgentMessageFactory();
const conversation = new Conversation(messageFactory);

conversation.runTurn(prompt);

console.log(conversation.renderTranscript());
