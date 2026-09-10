const ALLOWED_URI_SCHEMES = new Set(['http:', 'https:', 'mailto:'])
const MAX_URI_LENGTH = 4096

/**
 * Normalize user-entered PDF links and reject executable or local-resource URI schemes.
 * Bare hostnames are treated as HTTPS links.
 */
export function normalizeSafePdfUri(input: string) {
  const raw = input.trim()
  if (!raw) throw new Error('Enter a URL for this link.')
  if (raw.length > MAX_URI_LENGTH) throw new Error('This URL is too long.')
  if (/[\u0000-\u001F\u007F]/.test(raw)) throw new Error('This URL contains unsupported control characters.')

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('Enter a valid web or email link.')
  }

  if (!ALLOWED_URI_SCHEMES.has(parsed.protocol.toLowerCase())) {
    throw new Error('Only http, https, and mailto links are allowed.')
  }

  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.hostname) {
    throw new Error('Enter a valid web address.')
  }
  if (parsed.protocol === 'mailto:' && !parsed.pathname.trim()) {
    throw new Error('Enter a valid email address.')
  }

  return parsed.href
}
