import { AgentMessageFactory } from "@/agent/agent-message-factory";
import { Conversation } from "@/agent/conversation";

describe("Conversation", () => {
  it("stores one user and assistant exchange", () => {
    const messageFactory = new AgentMessageFactory();
    const conversation = new Conversation(messageFactory);

    conversation.runTurn("hello");

    expect(conversation.getMessages()).toEqual([
      {
        role: "user",
        content: "hello",
      },
      {
        role: "assistant",
        content: "agent heard: hello",
      },
    ]);
  });

  it("renders the transcript without exposing storage concerns to the CLI", () => {
    const messageFactory = new AgentMessageFactory();
    const conversation = new Conversation(messageFactory);

    conversation.runTurn("hello");

    expect(conversation.renderTranscript()).toBe(
      "user: hello\nassistant: agent heard: hello",
    );
  });

  it("keeps an empty prompt visible", () => {
    const messageFactory = new AgentMessageFactory();
    const conversation = new Conversation(messageFactory);

    conversation.runTurn("");

    expect(conversation.renderTranscript()).toBe(
      "user: \nassistant: agent heard: ",
    );
  });
});
