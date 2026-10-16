import { colors, palette, type Annotation } from './model';
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
type Row = Annotation & { cell: number; kind: string; stale: boolean };
let rows: Row[] = [];
let notebook = '';
let notebookUri = '';
let active: string | undefined;
const drafts = new Map<string, { note: string; color: string }>();
const draftKey = (id: string) => `${notebookUri}#${id}`;
const list = document.getElementById('list')!;
const search = document.getElementById('search') as HTMLInputElement;
const status = document.getElementById('status')!;
const send = (type: string, data: object = {}) => vscode.postMessage({type, notebookUri, ...data});
function render() {
  const query = search.value.toLowerCase();
  list.replaceChildren();
  const filtered = rows.filter(r => `${r.note} ${r.source?.exact ?? ''} ${r.rendered?.exact ?? ''}`.toLowerCase().includes(query));
  document.getElementById('notebook')!.textContent = notebook || 'Open a Jupyter notebook';
  document.getElementById('count')!.textContent = `${rows.length} ${rows.length === 1 ? 'annotation' : 'annotations'}`;
  if (!filtered.length) {
    const empty = document.createElement('p'); empty.className = 'empty';
    empty.textContent = query ? 'No matching highlights.' : 'Select text in a code cell and choose “Down Marker: Highlight selection”. In rendered Markdown, select text to reveal the colour toolbar.';
    list.append(empty);
  }
  for (const row of filtered) {
    const card = document.createElement('article'); card.className = 'card'; card.style.borderLeftColor = palette[row.color]; card.dataset.id = row.id;
    const label = document.createElement('button'); label.className = 'location'; label.textContent = `Cell ${row.cell + 1} · ${row.kind}${row.stale ? ' · text changed' : ''}`;
    label.onclick = () => send('reveal', { id: row.id });
    const quote = document.createElement('blockquote'); quote.textContent = row.rendered?.exact ?? row.source?.exact ?? '';
    const note = document.createElement('textarea'); note.placeholder = 'Add your thoughts…'; note.value = row.note; note.ariaLabel = `Note for cell ${row.cell + 1}`; note.rows = Math.max(3, Math.min(10, row.note.split('\n').length + 1));
    const controls = document.createElement('div'); controls.className = 'controls';
    const select = document.createElement('select'); select.ariaLabel = 'Highlight colour';
    for (const color of colors) { const option = document.createElement('option'); option.value = color; option.textContent = color; option.selected = color === row.color; select.append(option); }
    const draft = drafts.get(draftKey(row.id));
    if (draft) { note.value = draft.note; select.value = draft.color; }
    const rememberDraft = () => drafts.set(draftKey(row.id), { note: note.value, color: select.value });
    note.oninput = rememberDraft; select.onchange = rememberDraft;
    // Colour and note are saved together so changing a colour never discards a draft.
    const save = document.createElement('button'); save.className = 'primary'; save.textContent = 'Save note';
    save.onclick = () => { send('save', { id: row.id, note: note.value, color: select.value }); status.textContent = 'Saving…'; };
    note.onkeydown = e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save.click(); } };
    const remove = document.createElement('button'); remove.textContent = 'Delete'; remove.onclick = () => { drafts.delete(draftKey(row.id)); send('remove', { id: row.id }); };
    controls.append(select, save, remove); card.append(label, quote, note, controls); list.append(card);
    if (row.id === active) { card.classList.add('active'); queueMicrotask(() => { card.scrollIntoView({ block: 'nearest' }); note.focus(); }); }
  }
  active = undefined;
}
search.oninput = render;
document.getElementById('export')!.onclick = () => send('export');
window.addEventListener('message', event => {
  const m = event.data;
  if (m.type === 'state') {
    notebook = m.notebook; notebookUri = m.notebookUri; rows = m.rows; active = m.focus;
    if (m.saved) {
      const draft = drafts.get(draftKey(m.saved));
      const row = rows.find(r => r.id === m.saved);
      if (draft && row && draft.note === row.note && draft.color === row.color) drafts.delete(draftKey(m.saved));
    }
    render();
    status.textContent = m.saved ? 'Note saved to notebook. Save the notebook to keep it on disk.' : '';
  }
  if (m.type === 'error') status.textContent = m.message;
});
send('ready');
