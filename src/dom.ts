import { anchor, locate, palette, type Anchor, type Annotation } from './model';
interface TextSegment { node: Text | HTMLBRElement; text: string }
export function textSegments(root: HTMLElement): TextSegment[] {
  const segments: TextSegment[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    if (element?.closest('script,style,.katex-mathml,[aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;
    return node.nodeType === Node.TEXT_NODE || (node as Element).tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
  } });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    segments.push({ node: node as Text | HTMLBRElement, text: node.nodeType === Node.TEXT_NODE ? (node as Text).data : '\n' });
  }
  return segments;
}
export function visibleText(root: HTMLElement): string { return textSegments(root).map(s => s.text).join(''); }
export function selectionAnchor(root: HTMLElement, range: Range): Anchor | undefined {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer) || range.collapsed) return;
  const nodes = textSegments(root);
  let offset = 0, start: number | undefined, end: number | undefined;
  for (const {node, text} of nodes) {
    if (range.intersectsNode(node)) {
      const from = node === range.startContainer ? range.startOffset : 0;
      const to = node === range.endContainer ? range.endOffset : text.length;
      if (start === undefined) start = offset + from;
      end = offset + to;
    }
    offset += text.length;
  }
  return start !== undefined && end !== undefined && end > start ? anchor(visibleText(root), start, end) : undefined;
}
export function paint(root: HTMLElement, annotations: Annotation[]): void {
  for (const mark of root.querySelectorAll('mark[data-down-marker]')) mark.replaceWith(...mark.childNodes);
  root.normalize();
  const text = visibleText(root);
  // Partition every text node at highlight boundaries; overlapping annotations remain independently addressable.
  const ranges = annotations.flatMap(a => {
    const position = a.rendered ? locate(text, a.rendered) : a.source ? locate(text, a.source) : undefined;
    return position ? [{ ...position, annotation: a }] : [];
  });
  let offset = 0;
  for (const {node, text: segmentText} of textSegments(root)) {
    const length = segmentText.length;
    if (node.nodeType !== Node.TEXT_NODE) { offset += length; continue; }
    const textNode = node as Text;
    const overlapping = ranges.filter(r => r.start < offset + length && r.end > offset);
    if (overlapping.length) {
      const cuts = [...new Set([0, length, ...overlapping.flatMap(r => [Math.max(0, r.start - offset), Math.min(length, r.end - offset)])])].sort((a,b) => a-b);
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < cuts.length - 1; i++) {
        const value = textNode.data.slice(cuts[i], cuts[i+1]);
        const active = overlapping.filter(r => r.start <= offset + cuts[i] && r.end >= offset + cuts[i+1]);
        if (!active.length) fragment.append(value);
        else {
          const mark = document.createElement('mark');
          mark.dataset.downMarker = JSON.stringify(active.map(r => r.annotation.id));
          mark.style.backgroundColor = palette[active.at(-1)!.annotation.color] + '75';
          mark.style.color = 'inherit'; mark.style.borderRadius = '2px'; mark.style.cursor = 'pointer';
          mark.title = active.map(r => r.annotation.note || 'Click to add a note').join('\n\n');
          mark.textContent = value; fragment.append(mark);
        }
      }
      node.replaceWith(fragment);
    }
    offset += length;
  }
}
