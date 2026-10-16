import MarkdownIt from 'markdown-it';
import { activate } from '../src/renderer';
import { anchor } from '../src/model';
const md = new MarkdownIt({html:true});
const messages: any[] = [];
const listeners: ((m: any) => void)[] = [];
const base = {
  renderOutputItem(item: any, element: HTMLElement) {
    const shadow = element.shadowRoot ?? element.attachShadow({mode:'open'});
    let root = shadow.querySelector('#preview');
    if (!root) {root = document.createElement('div'); root.id = 'preview'; shadow.append(root);}
    root.innerHTML = md.render(item.text());
  },
};
const context = { getRenderer: async () => base, postMessage: (m: any) => messages.push(m), onDidReceiveMessage: (cb: (m: any) => void) => listeners.push(cb) };
const ready = activate(context as any);
Object.assign(window, { harness: {
  messages,
  async render(source: string, annotations: any[] = [], id = 'cell-1') {
    await ready;
    let element = document.getElementById(id);
    if (!element) { element = document.createElement('section'); element.id = id; document.body.append(element); }
    await (base.renderOutputItem as any)({id,mime:'text/markdown',text:()=>source,metadata:{id,metadata:{downMarker:{version:1,cellId:id,annotations}}}},element,new AbortController().signal);
  },
  update(annotations: any[]) { listeners.forEach(cb => cb({type:'annotations',rendererCell:'cell-1',annotations})); },
  anchor,
} });
