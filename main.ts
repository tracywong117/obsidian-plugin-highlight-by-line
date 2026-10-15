import { App, ColorComponent, Plugin, MarkdownView, PluginSettingTab, Setting } from "obsidian";
import { Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

const COLORS = ["yellow", "red", "pink", "green", "blue", "purple", "gray"] as const;
type HighlightColor = typeof COLORS[number];
type ThemeColors = Record<HighlightColor, string>;
interface HighlightSettings { light: ThemeColors; dark: ThemeColors; }
const DEFAULT_SETTINGS: HighlightSettings = {
  light: { yellow: "#fff9c2", red: "#ffd1d1", pink: "#ffd1ed", green: "#e0f0db", blue: "#d7eaf9", purple: "#f6e0ff", gray: "#e6e6e6" },
  dark: { yellow: "#8e6921", red: "#bd3b39", pink: "#bd348a", green: "#397752", blue: "#296bd5", purple: "#7140a9", gray: "#121826" }
};

function editorHighlights(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const visible of view.visibleRanges) {
    let position = view.state.doc.lineAt(visible.from).from;
    while (position <= visible.to) {
      const line = view.state.doc.lineAt(position);
      if (!seen.has(line.from)) {
        seen.add(line.from);
        const match = line.text.match(HL_REGEX);
        if (match) {
          const color = match[1].toLowerCase();
          ranges.push(Decoration.line({ attributes: { class: `hl-editor-line hl-block-${color}` } }).range(line.from));
          const markers = /%hl-(yellow|red|pink|green|blue|purple|gray)%/gi;
          let marker: RegExpExecArray | null;
          while ((marker = markers.exec(line.text))) {
            ranges.push(Decoration.mark({ class: "hl-inline-marker" }).range(line.from + marker.index, line.from + marker.index + marker[0].length));
          }
        }
      }
      if (line.to === view.state.doc.length) break;
      position = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

const highlightEditor = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = editorHighlights(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) this.decorations = editorHighlights(update.view);
  }
}, { decorations: plugin => plugin.decorations });

// Block containers own their markers; never let a parent consume a child's marker.
const READING_BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, blockquote";
const READING_BOUNDARIES = `${READING_BLOCKS}, ul, ol, pre, table, div, hr, .hl-block`;

const HL_REGEX = /%hl-(yellow|red|pink|green|blue|purple|gray)%/i;

export default class HighlightByLineNumPlugin extends Plugin {
  settings: HighlightSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  private colorStyles: HTMLStyleElement;

  async onload() {
    const saved = await this.loadData();
    for (const theme of ["light", "dark"] as const) {
      for (const color of COLORS) {
        const value = saved?.[theme]?.[color];
        if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) this.settings[theme][color] = value;
      }
    }
    this.colorStyles = document.createElement("style");
    document.head.appendChild(this.colorStyles);
    this.register(() => this.colorStyles.remove());
    this.register(() => document.querySelectorAll(".hl-palette").forEach(el => el.remove()));
    this.applyColors();
    this.addSettingTab(new HighlightSettingTab(this.app, this));
    this.registerEditorExtension(highlightEditor);
    this.registerMarkdownPostProcessor((el) => {
      if (el.matches(READING_BLOCKS)) this.processElement(el);
      const blocks = el.querySelectorAll(READING_BLOCKS);
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
      if (node.nodeName === "BR" ||
          (node instanceof HTMLElement && node.matches(READING_BOUNDARIES))) {
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
            if ((node as HTMLElement).matches(`${READING_BOUNDARIES}, code`)) return false;
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
    const colors = COLORS;
    
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
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || lineNum < 0 || lineNum >= view.editor.lineCount()) return;
    const original = view.editor.getLine(lineNum);
    const line = original.replace(/[ \t]*%hl-(yellow|red|pink|green|blue|purple|gray)%/gi, "");
    view.editor.replaceRange(color ? `${line} %hl-${color}%` : line,
      { line: lineNum, ch: 0 }, { line: lineNum, ch: original.length });
  }

  applyColors() {
    this.colorStyles.textContent = (["light", "dark"] as const).map(theme =>
      `.theme-${theme} { ${COLORS.map(color => `--hl-line-${color}: ${this.settings[theme][color]};`).join(" ")} }`
    ).join("\n");
  }

  async saveSettings() {
    this.applyColors();
    await this.saveData(this.settings);
  }
}

class HighlightSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: HighlightByLineNumPlugin) { super(app, plugin); }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("p", { text: "Choose highlight backgrounds for Reading view and writing view. Changes apply immediately. The line-number palette always uses the default vivid colors." });
    for (const theme of ["light", "dark"] as const) {
      containerEl.createEl("h3", { text: `${theme === "light" ? "Light" : "Dark"} theme` });
      for (const color of COLORS) {
        const row = new Setting(containerEl).setName(color[0].toUpperCase() + color.slice(1));
        let colorPicker: ColorComponent;
        let textInput: HTMLInputElement;
        row.addColorPicker(picker => {
          colorPicker = picker;
          picker.setValue(this.plugin.settings[theme][color]).onChange(async value => {
            this.plugin.settings[theme][color] = value;
            textInput.value = value;
            textInput.setCustomValidity("");
            await this.plugin.saveSettings();
          });
        }).addText(text => {
          textInput = text.inputEl;
          text.setPlaceholder("#rrggbb").setValue(this.plugin.settings[theme][color]).onChange(async value => {
            const valid = /^#[0-9a-f]{6}$/i.test(value.trim());
            textInput.setCustomValidity(valid ? "" : "Enter a six-digit hex color, such as #fffacd.");
            textInput.reportValidity();
            if (!valid) return;
            this.plugin.settings[theme][color] = value.trim();
            colorPicker.setValue(value.trim());
            await this.plugin.saveSettings();
          });
          text.inputEl.setAttribute("aria-label", `${theme} ${color} hex color`);
        }).addExtraButton(button => button.setIcon("reset").setTooltip("Reset color").onClick(async () => {
          this.plugin.settings[theme][color] = DEFAULT_SETTINGS[theme][color];
          await this.plugin.saveSettings();
          this.display();
        }));
      }
    }
  }
}
