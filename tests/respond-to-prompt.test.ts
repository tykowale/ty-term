import {describe, expect, it} from "vitest";
import {respondToPrompt} from "../src";

describe("respondToPrompt", () => {
    it("echoes a fake agent response for a prompt", () => {
        expect(respondToPrompt("hello")).toBe("agent heard: hello");
    });

    it("handles an empty prompt", () => {
        expect(respondToPrompt("   ")).toBe("agent needs a prompt");
    });
});