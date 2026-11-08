import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalHash, canonicalJson, jsonHash } from './hashing.js';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

test('jsonHash is byte-compatible with the legacy JSON hash', () => {
    const value = { b: 1, a: [2, { d: undefined, c: 3 }] };
    assert.equal(jsonHash(value), sha256(JSON.stringify(value)));
});

test('canonicalHash is byte-compatible with the legacy snapshot hash', () => {
    const value = { b: 1, a: [{ d: 2 }] };
    assert.equal(canonicalHash(value), sha256('{"a":[{"d":2}],"b":1}'));
});

test('canonicalJson sorts keys, drops undefined members and preserves array order', () => {
    assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] }), '{"a":[{"d":2}],"b":1}');
});

test('canonicalHash ignores insertion order while jsonHash does not', () => {
    assert.equal(canonicalHash({ a: 1, b: 2 }), canonicalHash({ b: 2, a: 1 }));
    assert.notEqual(jsonHash({ a: 1, b: 2 }), jsonHash({ b: 2, a: 1 }));
});
