import { respondToPrompt } from "./index.js";

const prompt = process.argv.slice(2).join(" ");
const response = respondToPrompt(prompt);

console.log(response);