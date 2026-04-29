import { type AgentMessage } from "./agent-message";

export class AgentMessageFactory {
  createUserMessage(content: string): AgentMessage {
    return {
      role: "user",
      content,
    };
  }

  createAssistantMessage(content: string): AgentMessage {
    return {
      role: "assistant",
      content,
    };
  }
}
