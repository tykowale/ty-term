export type AgentRole = "user" | "assistant";

export interface AgentMessage {
  role: AgentRole;
  content: string;
}

export type Conversation = AgentMessage[];

export function createUserMessage(content: string): AgentMessage {
  return {
    role: "user",
    content,
  };
}

export function createAssistantMessage(content: string): AgentMessage {
  return {
    role: "assistant",
    content,
  };
}

export function runTurn(
  conversation: Conversation,
  prompt: string,
): Conversation {
  const userMessage = createUserMessage(prompt);
  const assistantMessage = createAssistantMessage(`Agent heard: ${prompt}`);

  return [...conversation, userMessage, assistantMessage];
}

export function renderTranscript(conversation: Conversation): string {
  return conversation
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
}

export function respondToPrompt(prompt: string): string {
  const trimmedPrompt = prompt.trim();

  if (trimmedPrompt.length === 0) {
    return "agent needs a prompt";
  }

  return `agent heard: ${trimmedPrompt}`;
}
