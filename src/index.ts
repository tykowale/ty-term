export function respondToPrompt(prompt: string): string {
    const trimmedPrompt = prompt.trim();

    if (trimmedPrompt.length === 0) {
        return "agent needs a prompt";
    }

    return `agent heard: ${trimmedPrompt}`;
}