import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const index = readFileSync('index.html', 'utf8')
const robots = readFileSync('public/robots.txt', 'utf8')
const sitemap = readFileSync('public/sitemap.xml', 'utf8')
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  headers: Array<{ headers: Array<{ key: string; value: string }> }>
}

function header(name: string) {
  return vercel.headers.flatMap((rule) => rule.headers).find((item) => item.key.toLowerCase() === name.toLowerCase())?.value || ''
}

test('publishes canonical SEO metadata and crawler files', () => {
  assert.match(index, /<link rel="canonical" href="https:\/\/pdfforge\.jonasl\.online\/"/)
  assert.match(index, /<meta name="description" content="[^"]+"/)
  assert.match(index, /<meta property="og:title"/)
  assert.match(index, /<script type="application\/ld\+json">/)
  assert.match(robots, /Sitemap: https:\/\/pdfforge\.jonasl\.online\/sitemap\.xml/)
  assert.match(sitemap, /<loc>https:\/\/pdfforge\.jonasl\.online\/<\/loc>/)
})

test('production headers block framing and MIME sniffing', () => {
  assert.equal(header('X-Frame-Options'), 'DENY')
  assert.equal(header('X-Content-Type-Options'), 'nosniff')
  assert.equal(header('Referrer-Policy'), 'strict-origin-when-cross-origin')
})

test('content security policy blocks plugins and inline executable scripts', () => {
  const csp = header('Content-Security-Policy')
  assert.match(csp, /object-src 'none'/)
  assert.match(csp, /frame-ancestors 'none'/)
  assert.match(csp, /base-uri 'self'/)
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' 'sha256-/)
  assert.doesNotMatch(csp.match(/script-src[^;]+/)?.[0] || '', /'unsafe-inline'/)
})
