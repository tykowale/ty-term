const chapters = [
  ["index.md", "Overview"],
  ["01-start-a-typescript-cli-workspace.md", "01. TypeScript CLI"],
  ["02-represent-a-conversation.md", "02. Represent a Conversation"],
  ["03-call-one-model-provider.md", "03. Call One Model Provider"],
  ["04-add-a-tool-boundary.md", "04. Add a Tool Boundary"],
  ["05-execute-a-bash-tool.md", "05. Execute a Bash Tool"],
  ["06-let-the-model-use-tools.md", "06. Let the Model Use Tools"],
  ["07-read-project-files.md", "07. Read Project Files"],
  ["08-persist-sessions-as-jsonl.md", "08. Persist Sessions as JSONL"],
  ["09-load-project-instructions.md", "09. Load Project Instructions"],
  ["10-build-a-tiny-interactive-loop.md", "10. Build a Tiny Interactive Loop"],
];

const nav = document.querySelector("#nav");
const content = document.querySelector("#content");
const title = document.querySelector("#chapter-title");
const menuButton = document.querySelector("#menu-button");

marked.setOptions({
  gfm: true,
  breaks: false,
});

mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  themeVariables: {
    primaryColor: "#e8f2ef",
    primaryTextColor: "#202124",
    primaryBorderColor: "#0b6f6a",
    lineColor: "#6f766f",
    secondaryColor: "#fffdf8",
    tertiaryColor: "#ebe5d8",
    fontFamily: "Inter, system-ui, sans-serif",
  },
});

function chapterFromHash() {
  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (chapters.some(([file]) => file === hash)) {
    return hash;
  }
  return "index.md";
}

function renderNav(activeFile) {
  nav.innerHTML = "";
  for (const [file, label] of chapters) {
    const link = document.createElement("a");
    link.href = `#${encodeURIComponent(file)}`;
    link.textContent = label;
    link.className = file === activeFile ? "active" : "";
    nav.append(link);
  }
}

function rewriteMarkdownLinks(root) {
  for (const link of root.querySelectorAll('a[href$=".md"]')) {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("http")) continue;
    link.setAttribute("href", `#${encodeURIComponent(href)}`);
  }
}

function prepareMermaid(root) {
  for (const block of root.querySelectorAll("pre code.language-mermaid")) {
    const graph = document.createElement("div");
    graph.className = "mermaid";
    graph.textContent = block.textContent;
    block.closest("pre").replaceWith(graph);
  }
}

async function loadChapter(file) {
  renderNav(file);
  const selected = chapters.find(([chapterFile]) => chapterFile === file);
  title.textContent = selected?.[1] ?? "Pi Mono Codebase Knowledge";
  content.innerHTML = "<p>Loading...</p>";

  try {
    const response = await fetch(file);
    if (!response.ok) {
      throw new Error(`Could not load ${file}: ${response.status}`);
    }

    const markdown = await response.text();
    content.innerHTML = marked.parse(markdown);
    rewriteMarkdownLinks(content);
    prepareMermaid(content);
    await mermaid.run({ nodes: content.querySelectorAll(".mermaid") });
    window.scrollTo({ top: 0, behavior: "instant" });
    document.body.classList.remove("nav-open");
  } catch (error) {
    content.innerHTML = `<h1>Unable to load chapter</h1><pre><code>${String(error)}</code></pre>`;
  }
}

menuButton.addEventListener("click", () => {
  document.body.classList.toggle("nav-open");
});

window.addEventListener("hashchange", () => {
  loadChapter(chapterFromHash());
});

loadChapter(chapterFromHash());
