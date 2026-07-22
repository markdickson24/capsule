// Run: npx tsx src/lib/limitSheet.test.ts
import assert from 'node:assert/strict';
import { limitSheet } from './limitSheet';

let ticks = 0;
const unsub = limitSheet.subscribe(() => { ticks++; });
assert.equal(limitSheet.get(), null);

limitSheet.show({ title: 'T', message: 'M', actions: [{ label: 'OK', onPress: () => {} }] });
assert.equal(limitSheet.get()?.title, 'T');
assert.equal(limitSheet.get()?.actions.length, 1);
assert.equal(ticks, 1);

const firstId = limitSheet.get()!.id;
limitSheet.show({ title: 'T2', message: 'M2', actions: [] });
assert.notEqual(limitSheet.get()!.id, firstId); // new id each show
assert.equal(ticks, 2);

limitSheet.hide();
assert.equal(limitSheet.get(), null);
assert.equal(ticks, 3);
unsub();
console.log('limitSheet.test.ts: all assertions passed');
