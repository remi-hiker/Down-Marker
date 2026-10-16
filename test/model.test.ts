import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { anchor, locate, readNotes, isAnchor } from '../src/model';
test('relocates a quote after lines are inserted above it', () => {
  const text = 'one\nimportant result\nthree'; const a = anchor(text,4,20);
  assert.equal(locate('new\n' + text,a)?.start, 8);
});
test('uses context to distinguish repeated quotes', () => {
  const text = 'first result then second result done'; const a = anchor(text,25,31);
  assert.equal(a.exact,'result'); assert.equal(locate('inserted '+text,a)?.start,34);
});
test('does not guess when a quote is ambiguous or deleted', () => {
  const a = anchor('result',0,6);
  assert.equal(locate('result result',a), undefined);
  assert.equal(locate('gone',a), undefined);
});
test('supports unicode UTF-16 offsets and multiline quotes', () => {
  const text = '🐟 café\n日本語'; const a = anchor(text,3,text.length);
  assert.equal(locate('🐠 '+text,a)?.start,6);
});
test('metadata validation rejects malformed and unknown versions', () => {
  assert.equal(readNotes({ metadata: { downMarker: { version: 2 } } }),undefined);
  assert.equal(isAnchor({start:0,end:2,exact:'ok',prefix:42,suffix:''}),false);
  const a = {id:'a',color:'yellow',note:'note',created:'today',source:anchor('abc',0,2)};
  const stored = {metadata:{downMarker:{version:1,cellId:'cell',annotations:[a, null, {...a,color:'javascript:alert(1)'}]}}};
  assert.equal(readNotes(stored)?.annotations.length,1);
});
