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

    const match = element.textContent.match(HL_REGEX);
    if (!match) return;

    const fullMarker = match[0]; 
    const color = match[1].toLowerCase(); 

    // 1. Remove the marker text (%hl-red%) first
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null = null;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.includes(fullMarker)) {
        node.nodeValue = node.nodeValue.replace(fullMarker, "");
        break; 
      }
    }

    // 2. Create a wrapper span to hold the content
    // This ensures the highlight is INLINE (hugging the text) 
    // instead of BLOCK (filling the width)
    const wrapper = element.createSpan({
      cls: `hl-block hl-block-${color}`
    });

    // 3. Move all original children into the wrapper
    // We iterate backwards or use a while loop to move nodes safely
    while (element.firstChild && element.firstChild !== wrapper) {
      wrapper.appendChild(element.firstChild);
    }
    
    // 4. Append the wrapper back to the element
    element.appendChild(wrapper);
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