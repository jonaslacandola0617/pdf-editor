import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSafePdfUri } from '../src/lib/url-security.ts'

test('normalizes bare web hosts to https', () => {
  assert.equal(normalizeSafePdfUri('example.com/path'), 'https://example.com/path')
})

test('allows https, http, and mailto links', () => {
  assert.equal(normalizeSafePdfUri('https://example.com/a'), 'https://example.com/a')
  assert.equal(normalizeSafePdfUri('http://example.com/a'), 'http://example.com/a')
  assert.equal(normalizeSafePdfUri('mailto:hello@example.com'), 'mailto:hello@example.com')
})

test('rejects executable and local-resource URI schemes', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
  ]) {
    assert.throws(() => normalizeSafePdfUri(value), /Only http, https, and mailto/)
  }
})

test('rejects control characters and empty destinations', () => {
  assert.throws(() => normalizeSafePdfUri(''), /Enter a URL/)
  assert.throws(() => normalizeSafePdfUri('https://example.com\nmalicious'), /control characters/)
})
