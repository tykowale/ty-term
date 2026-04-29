import { type AgentMessage } from "./agent-message";
import { AgentMessageFactory } from "./agent-message-factory";

export class Conversation {
  private readonly messages: AgentMessage[];

  constructor(
    private readonly messageFactory: AgentMessageFactory,
    messages: readonly AgentMessage[] = [],
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
    return [...this.messages];
  }

  renderTranscript(): string {
    return this.messages
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");
  }
}
