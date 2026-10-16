import type { ActivationFunction, RendererApi, OutputItem } from 'vscode-notebook-renderer';
import { colors, palette, readNotes, type Anchor, type Annotation, type Color } from './model';
import { paint, selectionAnchor, visibleText } from './dom';

export const activate: ActivationFunction = async context => {
  const base = await context.getRenderer('vscode.markdown-it-renderer') as RendererApi | undefined;
  if (!base) throw new Error('Down Marker requires the built-in Markdown notebook renderer.');
  const original = base.renderOutputItem.bind(base);
  const mounted = new Map<string, { element: HTMLElement; root: HTMLElement; annotations: Annotation[]; source: string; metadata: Record<string, any>; dispose: () => void }>();
  // Extend the existing renderer, preserving its Markdown plugins, math, attachments and sanitisation.
  base.renderOutputItem = async (item: OutputItem, element: HTMLElement, signal: AbortSignal) => {
    mounted.get(item.id)?.dispose(); mounted.delete(item.id);
    await original(item, element, signal);
    if (signal?.aborted || item.mime !== 'text/markdown') return;
    const root = (element.shadowRoot?.querySelector('#preview') ?? element.querySelector('#preview') ?? element) as HTMLElement;
    const metadata: Record<string, any> = item.metadata ?? {};
    const annotations = readNotes(metadata)?.annotations ?? [];
    const source = item.text();
    const abort = new AbortController();
    const style = document.createElement('style');
    style.textContent = `
      .dm-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:10px 0 4px; padding:6px; border:1px solid var(--vscode-widget-border,#8886); border-radius:6px; min-height:0; background:var(--vscode-editorWidget-background,#252526); color:var(--vscode-editor-foreground,#eee); font:12px var(--vscode-font-family,sans-serif); }
      .dm-toolbar[hidden] { display:none; }
      .dm-toolbar button { border:1px solid transparent; border-radius:4px; min-width:28px; height:28px; padding:3px 8px; cursor:pointer; font:inherit; background:var(--vscode-button-secondaryBackground,#444); color:var(--vscode-button-secondaryForeground,#eee); }
      .dm-toolbar button:focus-visible { outline:2px solid var(--vscode-focusBorder,#4af); outline-offset:2px; }
      .dm-toolbar .dm-swatch { color:#151515; font-weight:bold; }
      .dm-toolbar .dm-hint { opacity:.8; padding:0 4px; }
      #preview { user-select:text; -webkit-user-select:text; }
    `;
    const toolbar = document.createElement('div');
    toolbar.className = 'dm-toolbar'; toolbar.hidden = true; toolbar.role = 'toolbar'; toolbar.ariaLabel = 'Down Marker highlights';
    // Keep controls outside the annotated text so offsets do not depend on UI labels.
    root.after(toolbar); toolbar.after(style);
    let pending: Anchor | undefined;
    let selectedIds: string[] = [];
    const send = (type: string, extra: Record<string, unknown> = {}) => context.postMessage?.({
      type, rendererCell: item.id, cellId: readNotes(metadata)?.cellId, jupyterId: metadata.id,
      source, ...extra,
    });
    const button = (label: string, title: string, action: () => void, color?: Color) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.ariaLabel = title;
      if (color) { b.className = 'dm-swatch'; b.style.backgroundColor = palette[color]; }
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); action(); }, { signal: abort.signal });
      toolbar.append(b);
    };
    for (const color of colors) button('●', `Highlight ${color}`, () => {
      if (pending) send('create', { anchor: pending, color, renderedText: visibleText(root) });
      else if (selectedIds.length) send('recolor', { ids: selectedIds, color });
      toolbar.hidden = true;
    }, color);
    button('Add note', 'Add or edit a note', () => {
      if (pending) send('create', { anchor: pending, color: 'yellow', renderedText: visibleText(root), withNote: true });
      else if (selectedIds.length) send('edit', { ids: selectedIds });
      toolbar.hidden = true;
    });
    button('Remove', 'Remove selected highlight', () => { if (selectedIds.length) send('remove', { ids: selectedIds }); toolbar.hidden = true; });
    button('×', 'Close highlight toolbar', () => { toolbar.hidden = true; });
    const hint = document.createElement('span'); hint.className = 'dm-hint'; hint.textContent = 'Down Marker'; toolbar.append(hint);
    const selection = () => (root.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.() ?? window.getSelection();
    const capture = () => {
      const s = selection();
      if (!s?.rangeCount || s.isCollapsed) return;
      const a = selectionAnchor(root, s.getRangeAt(0));
      if (!a) return;
      pending = a; selectedIds = []; toolbar.hidden = false;
    };
    root.addEventListener('mouseup', capture, { signal: abort.signal });
    root.addEventListener('keyup', capture, { signal: abort.signal });
    root.addEventListener('keydown', e => {
      if (e.key === 'Escape') toolbar.hidden = true;
    }, { signal: abort.signal });
    root.addEventListener('click', e => {
      if (selection()?.toString()) return;
      const mark = (e.target as Element).closest<HTMLElement>('mark[data-down-marker]');
      if (!mark) return;
      e.preventDefault(); e.stopPropagation(); pending = undefined;
      selectedIds = JSON.parse(mark.dataset.downMarker!); toolbar.hidden = false;
    }, { signal: abort.signal });
    const state = { element, root, annotations, source, metadata, dispose: () => { abort.abort(); observer.disconnect(); toolbar.remove(); style.remove(); } };
    // VS Code asynchronously syntax-colours fenced code after the Markdown render.
    // Reapply marks after those DOM replacements without observing our own changes.
    const observer = new MutationObserver(() => repaint());
    const repaint = () => { observer.disconnect(); paint(root, state.annotations); observer.observe(root, { childList: true, subtree: true, characterData: true }); };
    mounted.set(item.id, state); repaint();
    send('ready');
    signal?.addEventListener('abort', state.dispose, { once: true });
  };
  context.onDidReceiveMessage?.(message => {
    if (message?.type !== 'annotations' || typeof message.rendererCell !== 'string') return;
    const state = mounted.get(message.rendererCell);
    if (state) { state.annotations = message.annotations; paint(state.root, state.annotations); }
  });
  const originalDispose = base.disposeOutputItem?.bind(base);
  base.disposeOutputItem = id => {
    if (id) { mounted.get(id)?.dispose(); mounted.delete(id); }
    else { for (const state of mounted.values()) state.dispose(); mounted.clear(); }
    originalDispose?.(id);
  };
};
