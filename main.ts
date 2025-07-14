import { Plugin, TFile, MarkdownView } from "obsidian";

const COLORS: Record<string, string> = {
  yellow: "rgb(255, 250, 205)",
  red: "rgb(255, 237, 237)",
  pink: "rgb(255,235,247)",
  green: "rgb(228,248,236)",
  blue: "rgb(233, 245, 254)",
  purple: "rgb(249, 239, 253)",
  gray: "rgb(241, 242, 244)"
};

/* Palette dot colors: vivid, easy to distinguish */
const PALETTE_COLORS: Record<string, string> = {
  yellow: "#FFD600",  // vivid yellow
  red: "#FF1744",     // vivid red
  pink: "#F500A3",    // vivid pink
  green: "#00C853",   // vivid green
  blue: "#2979FF",    // vivid blue
  purple: "#AA00FF",  // vivid purple
  gray: "#616161"     // near-black gray
};

const COLOR_ORDER = ["yellow", "red", "pink", "green", "blue", "purple", "gray"];
const HL_MARKER = /%hl-(yellow|red|pink|green|blue|purple|gray)%\s*$/i;

export default class HighlightByLineNumPlugin extends Plugin {
  onload() {
    this.addStyles();

    this.registerMarkdownPostProcessor((el, ctx) => {
      const HL_REGEX = /%hl-(yellow|red|pink|green|blue|purple|gray)%/i;

      for (const block of Array.from(el.children)) {
        const htmlBlock = block as HTMLElement;

        // Only skip <style> and <script>
        if (htmlBlock.tagName === "STYLE" || htmlBlock.tagName === "SCRIPT") continue;

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

        let newContent = "";
        for (let i = 0; i < lineGroups.length; i++) {
          const nodes = lineGroups[i];
          let lineHTML = "";
          let lineText = "";
          nodes.forEach((n: Node) => {
            if (n.nodeType === Node.TEXT_NODE) {
              lineHTML += n.textContent;
              lineText += n.textContent;
            } else if (n instanceof HTMLElement) {
              lineHTML += n.outerHTML;
              lineText += n.innerText;
            }
          });

          const match = lineText.match(HL_REGEX);
          if (match) {
            const color = match[1].toLowerCase();

            // For Live Preview: show colored pill
            // For Reading: show highlighted line
            const cleanedHTML = lineHTML.replace(HL_REGEX, "");
            const markerSpan = `<span class="hl-inline-marker" style="background:${COLORS[color]};color:#666;">%hl-${color}%</span>`;

            newContent += `
<span class="hl-block-container">
  <span class="hl-block" style="background:${COLORS[color]};border-radius:0.25em;">${cleanedHTML}</span>
</span>
<span class="hl-inline-container">
  ${lineHTML.replace(HL_REGEX, markerSpan)}
</span>
            `.trim();
          } else {
            newContent += lineHTML;
          }
          if (i !== lineGroups.length - 1) newContent += "<br>";
        }
        htmlBlock.innerHTML = newContent;
      }
    });

    // Event delegation for line number clicks in writing mode
    document.body.addEventListener("click", this.onAnyClick.bind(this), true);
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

    // Build palette
    const palette = document.createElement("div");
    palette.className = "hl-palette";
    COLOR_ORDER.forEach(color => {
      const colorDot = document.createElement("span");
      colorDot.className = "hl-palette-dot";
      colorDot.style.background = PALETTE_COLORS[color];
      colorDot.title = color;
      colorDot.onclick = async (e) => {
        e.stopPropagation();
        palette.remove();
        await this.updateMarkdownForLine(lineNum, color);
      };
      palette.appendChild(colorDot);
    });
    // Clear button
    const clearBtn = document.createElement("span");
    clearBtn.className = "hl-palette-dot clear";
    clearBtn.innerHTML = "&minus;";
    clearBtn.title = "Clear highlight";
    clearBtn.onclick = async (e) => {
      e.stopPropagation();
      palette.remove();
      await this.updateMarkdownForLine(lineNum, "");
    };
    palette.appendChild(clearBtn);

    document.body.appendChild(palette);
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

  addStyles() {
    const style = document.createElement("style");
    style.textContent = `
      /* Only show for reading or writing mode, never both */
      .markdown-reading-view .hl-block-container { display:block; }
      .markdown-reading-view .hl-inline-container { display:none; }
      .markdown-source-view .hl-block-container { display:none; }
      .markdown-source-view .hl-inline-container { display:block; }
      .cm-content .hl-block-container { display:none; }
      .cm-content .hl-inline-container { display:block; }

      .hl-block {
        border-radius: 0.25em;
        margin-left: 0em;
        transition: background 0.2s;
      }
      .hl-inline-marker {
        display: inline-block;
        border-radius: 0.5em;
        font-size: 0.95em;
        padding: 0.08em 0.40em;
        margin: 0 0.1em;
        font-family: inherit !important;
        font-weight: 400;
        letter-spacing: 0.03em;
        vertical-align: baseline;
        box-shadow: 0 0 0 1px #ddd;
        user-select: none;
        transition: background 0.2s, color 0.2s;
      }
      .hl-palette {
        display: flex;
        align-items: center;
        gap: 0.2em;
        padding: 0.25em 0.5em;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 1.5em;
        box-shadow: 0 2px 12px 0 rgba(60,60,60,0.10);
        z-index: 9999;
        min-width: 0;
      }
      .hl-palette-dot {
        width: 1.2em;
        height: 1.2em;
        border-radius: 50%;
        border: 2px solid #fff;
        box-shadow: 0 0 0 2px #bbb;
        cursor: pointer;
        margin: 0 0.1em;
        display: inline-block;
        transition: transform 0.12s, box-shadow 0.12s;
      }
      .hl-palette-dot:hover {
        transform: scale(1.22);
        box-shadow: 0 0 0 3px #2196f3;
      }
      .hl-palette-dot.clear {
        background: #fff !important;
        color: #2196f3;
        font-size: 1.25em;
        border: 1.5px solid #bbb;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.3em;
        height: 1.3em;
        font-weight: bold;
        box-shadow: none;
      }
      .cm-lineNumbers .cm-gutterElement {
        cursor: pointer !important;
        color: #2196f3 !important;
        font-weight: bold !important;
        background: #e5f0fd !important;
        border-radius: 1em !important;
        transition: background 0.12s;
      }
      .cm-lineNumbers .cm-gutterElement:hover {
        filter: brightness(0.95);
        background: #dbeafe !important;
      }
    `;
    document.head.appendChild(style);
  }
}