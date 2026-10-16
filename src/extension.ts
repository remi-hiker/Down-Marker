import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { anchor, colors, isAnchor, locate, palette, readNotes, escapeHtml, type Annotation, type CellNotes, type Color } from './model';
const rendererId = 'down-marker.markdown';

export function activate(context: vscode.ExtensionContext) {
  const channel = vscode.notebooks.createRendererMessaging(rendererId);
  let current = vscode.window.activeNotebookEditor?.notebook;
  let view: vscode.WebviewView | undefined;
  let focusId: string | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const links = new WeakMap<vscode.NotebookEditor, Map<string, vscode.NotebookCell>>();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work); queue = next.catch(() => undefined); return next;
  };
  const report = (error: unknown) => { void vscode.window.showErrorMessage(`Down Marker: ${error instanceof Error ? error.message : String(error)}`); };
  const decorations = new Map(colors.map(color => [color, vscode.window.createTextEditorDecorationType({
    backgroundColor: palette[color] + '55', borderRadius: '2px', overviewRulerColor: palette[color],
    overviewRulerLane: vscode.OverviewRulerLane.Right, rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  })]));
  const notebookFor = (editor: vscode.TextEditor) => vscode.workspace.notebookDocuments.find(n => n.notebookType === 'jupyter-notebook' && n.getCells().some(c => c.document === editor.document));
  function refresh(saved?: string) {
    for (const editor of vscode.window.visibleTextEditors) {
      const cell = notebookFor(editor)?.getCells().find(c => c.document === editor.document);
      const notes = cell ? readNotes(cell.metadata)?.annotations ?? [] : [];
      const text = editor.document.getText();
      for (const [color, decoration] of decorations) {
        editor.setDecorations(decoration, notes.filter(a => a.color === color && a.source).flatMap(a => {
          const p = locate(text, a.source!);
          return p ? [{ range: new vscode.Range(editor.document.positionAt(p.start), editor.document.positionAt(p.end)), hoverMessage: new vscode.MarkdownString(a.note || 'Down Marker highlight — open Annotations to add a note.') }] : [];
        }));
      }
    }
    if (current?.isClosed) current = undefined;
    const rows = current?.getCells().flatMap(cell => (readNotes(cell.metadata)?.annotations ?? []).map(a => ({
      ...a, cell: cell.index, kind: cell.kind === vscode.NotebookCellKind.Code ? cell.document.languageId : 'Markdown',
      stale: !!a.source && !locate(cell.document.getText(), a.source),
    }))) ?? [];
    void view?.webview.postMessage({ type: 'state', notebook: current ? vscode.workspace.asRelativePath(current.uri) : '', notebookUri: current?.uri.toString() ?? '', rows, focus: focusId, saved });
    if (view) focusId = undefined;
  }
  async function update(cell: vscode.NotebookCell, change: (data: CellNotes) => CellNotes): Promise<void> {
    await enqueue(async () => {
      if (cell.notebook.isClosed || !cell.notebook.getCells().includes(cell)) throw new Error('This cell is no longer in the notebook.');
      const existing = readNotes(cell.metadata) ?? { version: 1 as const, cellId: randomUUID(), annotations: [] };
      const next = change(existing);
      const metadata = { ...cell.metadata, metadata: { ...cell.metadata.metadata, downMarker: next } };
      const edit = new vscode.WorkspaceEdit();
      edit.set(cell.notebook.uri, [vscode.NotebookEdit.updateCellMetadata(cell.index, metadata)]);
      if (!await vscode.workspace.applyEdit(edit)) throw new Error('Could not update this notebook. Check that it is writable.');
      current = cell.notebook; refresh();
      for (const editor of vscode.window.visibleNotebookEditors) {
        for (const [rendererCell, linked] of links.get(editor) ?? []) if (linked === cell) {
          await channel.postMessage({ type: 'annotations', rendererCell, annotations: next.annotations }, editor);
        }
      }
    });
  }
  async function showAnnotations(id?: string) {
    focusId = id;
    await vscode.commands.executeCommand('downMarker.annotations.focus');
    view?.show(true); refresh();
  }
  async function add(cell: vscode.NotebookCell, data: Pick<Annotation, 'color' | 'source' | 'rendered'>, withNote = false) {
    const annotation: Annotation = { id: randomUUID(), note: '', created: new Date().toISOString(), ...data };
    await update(cell, notes => ({ ...notes, annotations: [...notes.annotations, annotation] }));
    if (withNote) await showAnnotations(annotation.id);
    return annotation.id;
  }
  async function highlight(withNote: boolean, pickColor = false) {
    const editor = vscode.window.activeTextEditor;
    const cell = editor && notebookFor(editor)?.getCells().find(c => c.document === editor.document);
    if (!editor || !cell || editor.selection.isEmpty) {
      void vscode.window.showInformationMessage('Select text inside a notebook code or Markdown editor first. In rendered Markdown, select text and use the colour toolbar.'); return;
    }
    // Capture before opening Quick Pick, which changes focus.
    const text = editor.document.getText();
    const source = anchor(text, editor.document.offsetAt(editor.selection.start), editor.document.offsetAt(editor.selection.end));
    let color = vscode.workspace.getConfiguration('downMarker').get<Color>('defaultColor', 'yellow');
    if (!colors.includes(color)) color = 'yellow';
    if (pickColor) {
      const choice = await vscode.window.showQuickPick(colors.map(label => ({ label })), { placeHolder: 'Highlight colour' });
      if (!choice) return; color = choice.label;
    }
    await add(cell, { color, source }, withNote);
  }
  async function resolveCell(editor: vscode.NotebookEditor, message: any, interactive: boolean) {
    let map = links.get(editor); if (!map) { map = new Map(); links.set(editor, map); }
    const cached = map.get(message.rendererCell);
    if (cached && editor.notebook.getCells().includes(cached) && cached.document.getText() === message.source) return cached;
    let candidates = editor.notebook.getCells().filter(c => c.kind === vscode.NotebookCellKind.Markup && c.document.getText() === message.source);
    if (typeof message.cellId === 'string') {
      const matching = candidates.filter(c => readNotes(c.metadata)?.cellId === message.cellId);
      if (matching.length) candidates = matching;
    }
    if (typeof message.jupyterId === 'string') {
      const matching = candidates.filter(c => c.metadata.id === message.jupyterId);
      if (matching.length) candidates = matching;
    }
    let cell = candidates.length === 1 ? candidates[0] : undefined;
    if (!cell && candidates.length > 1 && interactive) {
      const chosen = await vscode.window.showQuickPick(candidates.map(c => ({ label: `Cell ${c.index + 1}`, description: 'Identical Markdown content', cell: c })), { placeHolder: 'Which identical cell are you annotating?' });
      cell = chosen?.cell;
    }
    if (cell && typeof message.rendererCell === 'string') map.set(message.rendererCell, cell);
    return cell;
  }
  context.subscriptions.push(channel.onDidReceiveMessage(event => {
    void (async () => {
      const m = event.message;
      if (!m || typeof m !== 'object' || typeof m.source !== 'string' || typeof m.rendererCell !== 'string' || event.editor.notebook.notebookType !== 'jupyter-notebook') return;
      const cell = await resolveCell(event.editor, m, m.type !== 'ready');
      if (!cell) { if (m.type !== 'ready') void vscode.window.showWarningMessage('Down Marker could not identify this cell. Reopen its Markdown preview and try again.'); return; }
      if (m.type === 'ready') { await channel.postMessage({ type: 'annotations', rendererCell: m.rendererCell, annotations: readNotes(cell.metadata)?.annotations ?? [] }, event.editor); return; }
      current = cell.notebook;
      if (m.type === 'create' && isAnchor(m.anchor) && colors.includes(m.color) && typeof m.renderedText === 'string' && m.renderedText.slice(m.anchor.start, m.anchor.end) === m.anchor.exact) {
        const match = locate(cell.document.getText(), m.anchor);
        await add(cell, { color: m.color, rendered: m.anchor, source: match ? anchor(cell.document.getText(), match.start, match.end) : undefined }, m.withNote === true);
      } else if (Array.isArray(m.ids) && m.ids.every((id: unknown) => typeof id === 'string')) {
        if (m.type === 'edit') await showAnnotations(m.ids[0]);
        if (m.type === 'remove') await update(cell, data => ({ ...data, annotations: data.annotations.filter(a => !m.ids.includes(a.id)) }));
        if (m.type === 'recolor' && colors.includes(m.color)) await update(cell, data => ({ ...data, annotations: data.annotations.map(a => m.ids.includes(a.id) ? { ...a, color: m.color } : a) }));
      }
    })().catch(report);
  }));
  function find(id: string, notebook = current) {
    for (const cell of notebook?.getCells() ?? []) {
      const annotation = readNotes(cell.metadata)?.annotations.find(a => a.id === id);
      if (annotation) return { cell, annotation };
    }
  }
  async function exportNotes(notebook = current) {
    if (!notebook) return;
    const entries = notebook.getCells().flatMap(cell => (readNotes(cell.metadata)?.annotations ?? []).map(a =>
      `## Cell ${cell.index + 1} · ${a.color}\n\n${(a.rendered?.exact ?? a.source?.exact ?? '').split('\n').map(line => `> ${line}`).join('\n')}\n\n${a.note || '_No note._'}\n`));
    const destination = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(notebook.uri.fsPath.replace(/\.ipynb$/i, '') + '-annotations.md'), filters: { Markdown: ['md'] } });
    if (destination) { await vscode.workspace.fs.writeFile(destination, Buffer.from(`# Annotations: ${vscode.workspace.asRelativePath(notebook.uri)}\n\n${entries.join('\n')}`)); void vscode.window.showTextDocument(destination); }
  }
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('downMarker.annotations', {
    resolveWebviewView(webviewView) {
      view = webviewView;
      view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')] };
      const nonce = randomUUID().replaceAll('-', '');
      const script = view.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist/sidebar.js'));
      view.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><style>
        body{padding:16px 12px;font:13px var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-sideBar-background)}
        h1{font-size:18px;font-weight:600;margin:0 0 6px}#notebook{opacity:.75;overflow-wrap:anywhere;font-size:12px}header{margin-bottom:18px}.top{display:flex;justify-content:space-between;align-items:center;margin:12px 0}#count{font-size:12px;opacity:.7}input,textarea,select{box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:4px;font:inherit;padding:8px}input,textarea{width:100%}textarea{resize:vertical;line-height:1.5;min-height:74px}button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:0;border-radius:4px;padding:7px 9px;cursor:pointer;font:inherit}button:hover{filter:brightness(1.12)}:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.card{border:1px solid var(--vscode-widget-border,#8884);border-left:4px solid;border-radius:6px;padding:12px;margin-bottom:12px}.card.active{outline:1px solid var(--vscode-focusBorder)}.location{padding:0;background:none;color:var(--vscode-textLink-foreground);font-size:11px}.controls{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.controls select{padding:5px;max-width:90px}blockquote{margin:10px 0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;font-size:12px;line-height:1.6}.empty{opacity:.75;line-height:1.7}#status{font-size:12px;line-height:1.5}footer{opacity:.65;font-size:11px;margin-top:16px;line-height:1.6}
      </style></head><body><header><h1>Highlights & notes</h1><div id="notebook"></div></header><input id="search" type="search" aria-label="Search highlights and notes" placeholder="Search your annotations…"><div class="top"><span id="count"></span><button id="export">Export</button></div><p id="status" role="status"></p><main id="list"></main><footer>Annotations travel with your notebook. Save the notebook after making changes.<br>⌘ / Ctrl + Enter saves a note.</footer><script nonce="${nonce}" src="${escapeHtml(script.toString())}"></script></body></html>`;
      webviewView.onDidDispose(() => { if (view === webviewView) view = undefined; });
      webviewView.webview.onDidReceiveMessage(m => {
        void (async () => {
          if (!m || typeof m.type !== 'string') return;
          if (m.type === 'ready') { refresh(); return; }
          const notebook = vscode.workspace.notebookDocuments.find(n => n.uri.toString() === m.notebookUri);
          if (!notebook) return;
          if (m.type === 'export') { await exportNotes(notebook); return; }
          if (typeof m.id !== 'string') return;
          const found = find(m.id, notebook); if (!found) return;
          if (m.type === 'save' && typeof m.note === 'string' && m.note.length <= 100000 && colors.includes(m.color)) {
            await update(found.cell, data => ({ ...data, annotations: data.annotations.map(a => a.id === m.id ? { ...a, note: m.note, color: m.color } : a) })); refresh(m.id);
          } else if (m.type === 'remove') {
            await update(found.cell, data => ({ ...data, annotations: data.annotations.filter(a => a.id !== m.id) }));
          } else if (m.type === 'reveal') {
            const editor = await vscode.window.showNotebookDocument(notebook);
            editor.selection = new vscode.NotebookRange(found.cell.index, found.cell.index + 1);
            editor.revealRange(editor.selection, vscode.NotebookEditorRevealType.InCenter);
            if (found.cell.kind === vscode.NotebookCellKind.Code && found.annotation.source) {
              const p = locate(found.cell.document.getText(), found.annotation.source);
              if (p) await vscode.window.showTextDocument(found.cell.document, { selection: new vscode.Range(found.cell.document.positionAt(p.start), found.cell.document.positionAt(p.end)) });
            }
          }
        })().catch(error => { void webviewView.webview.postMessage({ type: 'error', message: String(error) }); report(error); });
      }, undefined, context.subscriptions);
      refresh();
    },
  }, { webviewOptions: { retainContextWhenHidden: true } }));
  const command = (id: string, fn: () => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, async () => { try { return await fn(); } catch (e) { report(e); } }));
  command('downMarker.highlight', () => highlight(false));
  command('downMarker.highlightColor', () => highlight(false, true));
  command('downMarker.addNote', () => highlight(true));
  command('downMarker.showAnnotations', () => showAnnotations());
  command('downMarker.export', () => exportNotes());
  command('downMarker.removeHighlight', async () => {
    const editor = vscode.window.activeTextEditor;
    const cell = editor && notebookFor(editor)?.getCells().find(c => c.document === editor.document);
    if (!cell || !editor) return;
    const start = editor.document.offsetAt(editor.selection.start), end = editor.document.offsetAt(editor.selection.end);
    await update(cell, data => ({ ...data, annotations: data.annotations.filter(a => {
      const p = a.source && locate(editor.document.getText(), a.source);
      return !p || (start === end ? start < p.start || start >= p.end : p.end <= start || p.start >= end);
    }) }));
  });
  context.subscriptions.push(...decorations.values(),
    vscode.window.onDidChangeVisibleTextEditors(() => refresh()),
    vscode.workspace.onDidChangeTextDocument(() => refresh()),
    vscode.workspace.onDidChangeNotebookDocument(() => refresh()),
    vscode.workspace.onDidCloseNotebookDocument(() => refresh()),
    vscode.window.onDidChangeActiveNotebookEditor(editor => { if (editor?.notebook.notebookType === 'jupyter-notebook') current = editor.notebook; refresh(); }),
  );
  refresh();
}
