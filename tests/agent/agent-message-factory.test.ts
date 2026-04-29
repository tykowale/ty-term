import { AgentMessageFactory } from "@/agent/agent-message-factory";

describe("AgentMessageFactory", () => {
  it("creates user and assistant messages", () => {
    const messageFactory = new AgentMessageFactory();

    expect(messageFactory.createUserMessage("hello")).toEqual({
      role: "user",
      content: "hello",
    });

    expect(messageFactory.createAssistantMessage("agent heard: hello")).toEqual(
      {
        role: "assistant",
        content: "agent heard: hello",
      },
    );
  });
});
