import { AgentMessage } from "@/agent/agent-message";

export interface ModelClient {
  createResponse(messages: AgentMessage[]): Promise<string>;
}
