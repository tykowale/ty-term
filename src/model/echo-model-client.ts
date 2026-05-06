import { ModelClient } from "@/model/model-client";
import { AgentMessage } from "@/agent/agent-message";

export class EchoModelClient implements ModelClient {
  async createResponse(messages: AgentMessage[]): Promise<string> {
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");

    return `agent heard: ${lastUserMessage?.content ?? ""}`;
  }
}
