import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { signHookdeckBody, verifyHookdeckSignature } from '../src/hookdeck-signature';

const SECRET = 'test-signing-secret';
const BODY = JSON.stringify({ event: 'call_ended', call: { call_id: 'c1' } });

describe('verifyHookdeckSignature', () => {
  it('signs with base64 HMAC-SHA256 of the raw body', () => {
    const expected = createHmac('sha256', SECRET).update(BODY).digest('base64');
    assert.equal(signHookdeckBody(BODY, SECRET), expected);
    assert.equal(signHookdeckBody(Buffer.from(BODY), SECRET), expected);
  });

  it('accepts a valid signature, for a string or a Buffer body', () => {
    const signature = signHookdeckBody(BODY, SECRET);
    assert.equal(verifyHookdeckSignature(BODY, signature, SECRET), true);
    assert.equal(verifyHookdeckSignature(Buffer.from(BODY), signature, SECRET), true);
  });

  it('rejects a signature made with a different secret', () => {
    assert.equal(verifyHookdeckSignature(BODY, signHookdeckBody(BODY, 'another-secret'), SECRET), false);
  });

  it('rejects a tampered body', () => {
    const signature = signHookdeckBody(BODY, SECRET);
    assert.equal(verifyHookdeckSignature(BODY.replace('c1', 'c2'), signature, SECRET), false);
    assert.equal(verifyHookdeckSignature(BODY + ' ', signature, SECRET), false);
  });

  it('rejects a missing or empty header, and a header of another length', () => {
    assert.equal(verifyHookdeckSignature(BODY, undefined, SECRET), false);
    assert.equal(verifyHookdeckSignature(BODY, '', SECRET), false);
    assert.equal(verifyHookdeckSignature(BODY, 'short', SECRET), false);
  });

  it('rejects everything when no secret is configured', () => {
    assert.equal(verifyHookdeckSignature(BODY, signHookdeckBody(BODY, ''), undefined), false);
    assert.equal(verifyHookdeckSignature(BODY, signHookdeckBody(BODY, ''), ''), false);
  });

  it('accepts the signature in x-hookdeck-signature-2 while a rolled secret is still active', () => {
    const signature = signHookdeckBody(BODY, SECRET);
    assert.equal(verifyHookdeckSignature(BODY, signHookdeckBody(BODY, 'old-secret'), SECRET, signature), true);
    assert.equal(verifyHookdeckSignature(BODY, signHookdeckBody(BODY, 'old-secret'), SECRET, signHookdeckBody(BODY, 'older')), false);
  });
});
