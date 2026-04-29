#!/usr/bin/env bun
// @bun

// src/agent/agent-message-factory.ts
class AgentMessageFactory {
  createUserMessage(content) {
    return {
      role: "user",
      content
    };
  }
  createAssistantMessage(content) {
    return {
      role: "assistant",
      content
    };
  }
}

// src/agent/conversation.ts
class Conversation {
  #messages;
  #messageFactory;
  constructor(messageFactory, messages = []) {
    this.#messageFactory = messageFactory;
    this.#messages = [...messages];
  }
  runTurn(prompt) {
    const userMessage = this.#messageFactory.createUserMessage(prompt);
    const assistantMessage = this.#messageFactory.createAssistantMessage(`agent heard: ${prompt}`);
    this.#messages.push(userMessage, assistantMessage);
  }
  getMessages() {
    return [...this.#messages];
  }
  renderTranscript() {
    return this.#messages.map((message) => `${message.role}: ${message.content}`).join(`
`);
  }
}

// src/cli.ts
var prompt = process.argv.slice(2).join(" ");
var messageFactory = new AgentMessageFactory;
var conversation = new Conversation(messageFactory);
conversation.runTurn(prompt);
console.log(conversation.renderTranscript());
