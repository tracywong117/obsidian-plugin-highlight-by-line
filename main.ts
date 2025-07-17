import { Plugin, TFile, MarkdownView } from "obsidian";

const COLOR_ORDER = ["yellow", "red", "pink", "green", "blue", "purple", "gray"];
const HL_MARKER = /%hl-(yellow|red|pink|green|blue|purple|gray)%\s*$/i;

export default class HighlightByLineNumPlugin extends Plugin {
  onload() {
    this.registerMarkdownPostProcessor((el, ctx) => {
      const HL_REGEX = /%hl-(yellow|red|pink|green|blue|purple|gray)%/i;
      
      for (const block of Array.from(el.children)) {
        const htmlBlock = block as HTMLElement;
        if (!['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE'].includes(htmlBlock.tagName)) continue;
      
        // Process the block using safe DOM manipulation
        this.processBlockWithDOM(htmlBlock, HL_REGEX);
      }
    });

    // Event delegation for line number clicks in writing mode
    document.body.addEventListener("click", this.onAnyClick.bind(this), true);
  }

  processBlockWithDOM(htmlBlock: HTMLElement, HL_REGEX: RegExp) {
    // Split block into "lines" by <br>
    const lineGroups: Node[][] = [];
    let currLine: Node[] = [];
    
    Array.from(htmlBlock.childNodes).forEach((child) => {
      if (child.nodeName === "BR") {
        lineGroups.push(currLine);
        currLine = [];
      } else {
        currLine.push(child);
      }
    });
    if (currLine.length) lineGroups.push(currLine);

    // Clear the block safely and rebuild with DOM methods
    htmlBlock.empty();

    for (let i = 0; i < lineGroups.length; i++) {
      const nodes = lineGroups[i];
      let lineText = "";
      
      // Extract text content safely
      nodes.forEach((n: Node) => {
        if (n.nodeType === Node.TEXT_NODE) {
          lineText += n.textContent || "";
        } else if (n instanceof HTMLElement) {
          lineText += n.textContent || "";
        }
      });

      const match = lineText.match(HL_REGEX);
      if (match) {
        const color = match[1].toLowerCase();
        
        // Create highlight block using DOM API
        const highlightSpan = htmlBlock.createEl("span", { 
          cls: `hl-block hl-block-${color}` 
        });
        
        // Add nodes to highlight block, cleaning marker text
        this.addNodesToBlock(nodes, highlightSpan, HL_REGEX);
      } else {
        // Add nodes without highlighting
        nodes.forEach(node => {
          htmlBlock.appendChild(node.cloneNode(true));
        });
      }
      
      // Add line break if not the last line
      if (i !== lineGroups.length - 1) {
        htmlBlock.createEl("br");
      }
    }
  }

  addNodesToBlock(nodes: Node[], blockEl: HTMLElement, HL_REGEX: RegExp) {
    nodes.forEach((node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || "";
        const cleanedText = text.replace(HL_REGEX, "");
        if (cleanedText) {
          blockEl.appendText(cleanedText);
        }
      } else if (node instanceof HTMLElement) {
        const cloned = node.cloneNode(true) as HTMLElement;
        // Clean marker text from cloned element
        const nodeText = cloned.textContent || "";
        const cleanedNodeText = nodeText.replace(HL_REGEX, "");
        cloned.textContent = cleanedNodeText;
        blockEl.appendChild(cloned);
      }
    });
  }

  async onAnyClick(evt: MouseEvent) {
    // Only act in writing mode (source/live preview)
    const writingView = document.querySelector(".markdown-source-view, .cm-content");
    if (!writingView) return;

    let target = evt.target as HTMLElement | null;
    if (!target) return;

    // Traverse up to check for line number
    while (target && !target.classList.contains("cm-gutterElement")) {
      target = target.parentElement;
    }
    if (!target) return;
    if (!(target.parentElement && target.parentElement.classList.contains("cm-lineNumbers"))) return;

    evt.preventDefault();
    evt.stopPropagation();

    if (!target.textContent?.trim().match(/^\d+$/)) return;
    document.querySelectorAll(".hl-palette").forEach(e => e.remove());
    const lineNum = Number(target.textContent.trim()) - 1;

    // Build palette using DOM API
    const palette = document.body.createEl("div", { cls: "hl-palette" });
    
    COLOR_ORDER.forEach(color => {
      const colorDot = palette.createEl("span", { 
        cls: `hl-palette-dot hl-palette-dot-${color}`,
        attr: { title: color }
      });
      colorDot.onclick = async (e) => {
        e.stopPropagation();
        palette.remove();
        await this.updateMarkdownForLine(lineNum, color);
      };
    });
    
    // Clear button
    const clearBtn = palette.createEl("span", { 
      cls: "hl-palette-dot hl-palette-clear",
      text: "−",
      attr: { title: "Clear highlight" }
    });
    clearBtn.onclick = async (e) => {
      e.stopPropagation();
      palette.remove();
      await this.updateMarkdownForLine(lineNum, "");
    };

    // Position palette
    const rect = target.getBoundingClientRect();
    palette.style.position = "fixed";
    palette.style.left = (rect.right + 8) + "px";
    palette.style.top = (rect.top - 2) + "px";

    setTimeout(() => {
      window.addEventListener("click", () => palette.remove(), { once: true });
    }, 20);
  }

  async updateMarkdownForLine(lineNum: number, color: string) {
    const file = this.getActiveFile();
    if (!file) return;
    const data = await this.app.vault.read(file);
    const lines = data.split("\n");
    if (lineNum < 0 || lineNum >= lines.length) return;

    let line = lines[lineNum].replace(HL_MARKER, "").trimEnd();
    if (color) {
      lines[lineNum] = line + ` %hl-${color}%`;
    } else {
      lines[lineNum] = line;
    }
    await this.app.vault.modify(file, lines.join("\n"));
  }

  getActiveFile(): TFile | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.file instanceof TFile) return view.file;
    return null;
  }
}