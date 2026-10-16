/** Portable annotations stored under Jupyter cell.metadata.downMarker. */
export const colors = ['yellow', 'green', 'blue', 'pink'] as const;
export type Color = typeof colors[number];
export const palette: Record<Color, string> = { yellow: '#edc64b', green: '#65c99a', blue: '#6caef0', pink: '#e68bb4' };
export interface Anchor { start: number; end: number; exact: string; prefix: string; suffix: string }
export interface Annotation { id: string; color: Color; note: string; created: string; source?: Anchor; rendered?: Anchor }
export interface CellNotes { version: 1; cellId: string; annotations: Annotation[] }
export function anchor(text: string, start: number, end: number): Anchor {
  return { start, end, exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - 40), start), suffix: text.slice(end, end + 40) };
}
/** Resolve by quote/context. Never guess when a repeated quote is ambiguous. */
export function locate(text: string, a: Anchor): { start: number; end: number } | undefined {
  if (!a.exact) return;
  const matches: { start: number; end: number; score: number }[] = [];
  for (let at = text.indexOf(a.exact); at !== -1; at = text.indexOf(a.exact, at + 1)) {
    const before = text.slice(Math.max(0, at - a.prefix.length), at);
    const after = text.slice(at + a.exact.length, at + a.exact.length + a.suffix.length);
    let score = 0;
    for (let i = 1; i <= Math.min(before.length, a.prefix.length) && before.at(-i) === a.prefix.at(-i); i++) score++;
    for (let i = 0; i < Math.min(after.length, a.suffix.length) && after[i] === a.suffix[i]; i++) score++;
    matches.push({ start: at, end: at + a.exact.length, score });
  }
  if (matches.length === 1) return matches[0];
  matches.sort((x, y) => y.score - x.score);
  if (matches.length && matches[0].score > matches[1].score) return matches[0];
  // Exact position is safe only when both contexts still match.
  return matches.find(m => m.start === a.start && m.score === a.prefix.length + a.suffix.length && m.score > 0);
}
export function isAnchor(v: unknown): v is Anchor {
  if (!v || typeof v !== 'object') return false;
  const a = v as Anchor;
  return Number.isSafeInteger(a.start) && Number.isSafeInteger(a.end) && a.start >= 0 && a.end > a.start &&
    typeof a.exact === 'string' && a.exact.length > 0 && a.exact.length <= 100000 &&
    typeof a.prefix === 'string' && a.prefix.length <= 40 && typeof a.suffix === 'string' && a.suffix.length <= 40;
}
export function readNotes(metadata: Record<string, any>): CellNotes | undefined {
  const data = metadata.metadata?.downMarker;
  if (!data || data.version !== 1 || typeof data.cellId !== 'string' || !Array.isArray(data.annotations)) return;
  return { version: 1, cellId: data.cellId, annotations: data.annotations.filter((a: Annotation) =>
    a && typeof a.id === 'string' && colors.includes(a.color) && typeof a.note === 'string' && typeof a.created === 'string' &&
    (isAnchor(a.source) || isAnchor(a.rendered))) };
}
export function escapeHtml(s: string): string { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!)); }
