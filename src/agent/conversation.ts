import { type AgentMessage } from "@/agent/agent-message";
import { AgentMessageFactory } from "@/agent/agent-message-factory";

export class Conversation {
  private readonly messages: AgentMessage[];

  constructor(messages: readonly AgentMessage[] = []) {
    this.messages = [...messages];
  }

  appendMessages(...messages: AgentMessage[]) {
    this.messages.push(...messages.map((message) => ({ ...message })));
  }

  getMessages(): AgentMessage[] {
    return [...this.messages];
  }

  renderTranscript(): string {
    return this.messages
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");
  }
}
