export function respondToPrompt(prompt) {
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length === 0) {
        return "agent needs a prompt";
    }
    return `agent heard: ${trimmedPrompt}`;
}
//# sourceMappingURL=index.js.map