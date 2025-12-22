import { Plugin, TFile, MarkdownView } from "obsidian";

const HL_REGEX = /%hl-(yellow|red|pink|green|blue|purple|gray)%/i;

export default class HighlightByLineNumPlugin extends Plugin {
  onload() {
    this.registerMarkdownPostProcessor((el, ctx) => {
      const blocks = el.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote");
      blocks.forEach((block) => {
        this.processElement(block as HTMLElement);
      });
    });

    this.registerDomEvent(document, "click", this.onAnyClick.bind(this), true);
  }

  processElement(element: HTMLElement) {
    if (!element.textContent || !HL_REGEX.test(element.textContent)) {
      return;
    }

    const childNodes = Array.from(element.childNodes);
    let currentLineNodes: Node[] = [];
    
    for (let i = 0; i < childNodes.length; i++) {
      const node = childNodes[i];
      if (node.nodeName === "BR") {
        this.processLine(currentLineNodes, element);
        currentLineNodes = [];
      } else {
        currentLineNodes.push(node);
      }
    }
    this.processLine(currentLineNodes, element);
  }

  processLine(nodes: Node[], parent: HTMLElement) {
    let found = false;
    let color = "";
    
    const findAndRemove = (node: Node): boolean => {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue) {
            const match = node.nodeValue.match(HL_REGEX);
            if (match) {
                color = match[1].toLowerCase();
                node.nodeValue = node.nodeValue.replace(match[0], "");
                return true;
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            for (let i = 0; i < node.childNodes.length; i++) {
                if (findAndRemove(node.childNodes[i])) return true;
            }
        }
        return false;
    };

    for (const node of nodes) {
        if (findAndRemove(node)) {
            found = true;
            break; 
        }
    }

    if (!found) return;

    const wrapper = document.createElement("span");
    wrapper.className = `hl-block hl-block-${color}`;

    if (nodes.length > 0) {
        const firstNode = nodes[0];
        parent.insertBefore(wrapper, firstNode);
        nodes.forEach(node => wrapper.appendChild(node));
    }
  }

  async onAnyClick(evt: MouseEvent) {
    const writingView = document.querySelector(".markdown-source-view, .cm-content");
    if (!writingView) return;

    let target = evt.target as HTMLElement | null;
    if (!target) return;

    while (target && !target.classList.contains("cm-gutterElement")) {
      target = target.parentElement;
    }

    if (!target) return;
    if (!(target.parentElement && target.parentElement.classList.contains("cm-lineNumbers"))) return;

    evt.preventDefault();
    evt.stopPropagation();

    const lineText = target.textContent?.trim();
    if (!lineText || !/^\d+$/.test(lineText)) return;
    
    document.querySelectorAll(".hl-palette").forEach(e => e.remove());
    
    const lineNum = Number(lineText) - 1;

    this.showPalette(target, lineNum);
  }

  showPalette(target: HTMLElement, lineNum: number) {
    const palette = document.body.createEl("div", { cls: "hl-palette" });
    const colors = ["yellow", "red", "pink", "green", "blue", "purple", "gray"];
    
    colors.forEach(color => {
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
    
    const clearBtn = palette.createEl("span", { 
      cls: "hl-palette-dot hl-palette-clear",
      text: "×",
      attr: { title: "Clear highlight" }
    });
    
    clearBtn.onclick = async (e) => {
      e.stopPropagation();
      palette.remove();
      await this.updateMarkdownForLine(lineNum, null);
    };

    const rect = target.getBoundingClientRect();
    palette.style.position = "fixed";
    palette.style.left = (rect.right + 12) + "px";
    palette.style.top = (rect.top - 6) + "px";

    setTimeout(() => {
      const closeHandler = () => {
        if (palette.isConnected) palette.remove();
      };
      window.addEventListener("click", closeHandler, { once: true });
    }, 50);
  }

  async updateMarkdownForLine(lineNum: number, color: string | null) {
    const file = this.getActiveFile();
    if (!file) return;

    const data = await this.app.vault.read(file);
    const lines = data.split("\n");
    
    if (lineNum < 0 || lineNum >= lines.length) return;

    let line = lines[lineNum].replace(/\s*%hl-[a-z]+%\s*/gi, "");
    
    if (color) {
      line = `${line} %hl-${color}%`;
    }
    
    lines[lineNum] = line;
    
    await this.app.vault.modify(file, lines.join("\n"));
  }

  getActiveFile(): TFile | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.file instanceof TFile) return view.file;
    return null;
  }
}