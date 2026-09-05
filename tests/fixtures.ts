import { test as base, expect } from '@playwright/test'
export * from '@playwright/test'

// Every browser scenario enforces these cross-cutting product contracts.
export const test = base.extend<{ runtimeGuard: void }>({
  runtimeGuard: [async ({ page }, use, testInfo) => {
    const exceptions: string[] = []
    const consoleErrors: string[] = []
    const outboundWrites: string[] = []
    const failedRequests: string[] = []
    page.on('pageerror', error => exceptions.push(error.message))
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('requestfailed', request => {
      const error = request.failure()?.errorText || 'failed'
      if (error.includes('ERR_ABORTED') || !['document', 'script', 'stylesheet', 'worker'].includes(request.resourceType())) return
      failedRequests.push(`${request.method()} ${request.url()} — ${error}`)
    })
    page.on('request', request => {
      const url = new URL(request.url())
      if (['http:', 'https:'].includes(url.protocol) &&
          !['127.0.0.1', 'localhost'].includes(url.hostname) &&
          !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        outboundWrites.push(`${request.method()} ${url.origin}${url.pathname}`)
      }
    })
    await use()
    await testInfo.attach('runtime-and-privacy', {
      body: JSON.stringify({ exceptions, consoleErrors, outboundWrites, failedRequests }, null, 2), contentType: 'application/json',
    })
    expect(exceptions, 'Uncaught browser exceptions').toEqual([])
    expect(consoleErrors, 'Unexpected browser console errors').toEqual([])
    expect(outboundWrites, 'Core editing must not upload document data').toEqual([])
    expect(failedRequests, 'Browser requests failed').toEqual([])
  }, { auto: true }],
})
