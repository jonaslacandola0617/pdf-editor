import { expect, test, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve('visual-audit')

async function makeAuditPdf(filePath: string) {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  for (let index = 0; index < 4; index++) {
    const page = pdf.addPage([612, 792])
    page.drawText(`PDF FORGE VISUAL AUDIT — PAGE ${index + 1}`, { x: 58, y: 724, size: 18, font: bold, color: rgb(.12, .14, .18) })
    page.drawText('A deliberately realistic page used to audit layout, text selection, search and editing controls.', { x: 58, y: 692, size: 10.5, font: regular, color: rgb(.25, .27, .3) })
    page.drawRectangle({ x: 58, y: 560, width: 496, height: 96, borderWidth: 1, borderColor: rgb(.82, .84, .87) })
    page.drawText('Summary', { x: 74, y: 625, size: 13, font: bold, color: rgb(.1, .12, .15) })
    page.drawText('Detail-oriented technical professional with experience building and troubleshooting practical web applications.', { x: 74, y: 600, size: 10, font: regular, color: rgb(.25, .27, .3) })
    page.drawText('This sentence is searchable and editable native PDF text.', { x: 74, y: 580, size: 10, font: regular, color: rgb(.25, .27, .3) })
    for (let row = 0; row < 7; row++) {
      page.drawRectangle({ x: 58, y: 500 - row * 50, width: 496, height: 34, color: row % 2 ? rgb(.965, .97, .98) : rgb(.985, .987, .99) })
      page.drawText(`Content row ${row + 1}`, { x: 74, y: 512 - row * 50, size: 9.5, font: regular, color: rgb(.28, .3, .33) })
    }
  }
  await writeFile(filePath, await pdf.save())
}

async function openAuditPdf(page: Page, filePath: string) {
  await page.goto('/')
  await page.locator('input[type="file"]').first().setInputFiles(filePath)
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.pdf-page canvas')).toBeVisible({ timeout: 20_000 })
}

async function shot(page: Page, name: string) {
  await mkdir(OUT, { recursive: true })
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
}

async function expectNoViewportOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    width: window.innerWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))
  expect(metrics.html, `html overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.width + 1)
  expect(metrics.body, `body overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.width + 1)
}

async function expectVisibleFocus(page: Page, selector: string) {
  const target = page.locator(selector).first()
  await target.focus()
  const focus = await target.evaluate((node) => {
    const style = getComputedStyle(node)
    return { outline: style.outline, boxShadow: style.boxShadow, borderColor: style.borderColor }
  })
  const visible = !/^none(?:\s|$)/.test(focus.outline) || focus.boxShadow !== 'none'
  expect(visible, `Missing visible keyboard focus for ${selector}: ${JSON.stringify(focus)}`).toBe(true)
}

async function expectCoreDesktopGeometry(page: Page) {
  const result = await page.evaluate(() => {
    const rect = (selector: string) => {
      const node = document.querySelector<HTMLElement>(selector)
      const r = node?.getBoundingClientRect()
      return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } : null
    }
    const rail = rect('.rail')
    const left = rect('.left-panel')
    const editor = rect('.editor-column')
    const right = rect('.right-panel')
    const toolbar = document.querySelector<HTMLElement>('.editor-toolbar')
    const floating = rect('.floating-nav')
    const stage = rect('.document-stage')
    return {
      rail, left, editor, right, floating, stage,
      toolbarOverflow: toolbar ? toolbar.scrollWidth - toolbar.clientWidth : 999,
    }
  })
  expect(result.rail).not.toBeNull()
  expect(result.editor).not.toBeNull()
  expect(result.toolbarOverflow).toBeLessThanOrEqual(1)
  if (result.rail && result.left) expect(result.rail.right).toBeLessThanOrEqual(result.left.left + 1)
  if (result.left && result.editor) expect(result.left.right).toBeLessThanOrEqual(result.editor.left + 1)
  if (result.editor && result.right && result.right.width > 0) expect(result.editor.right).toBeLessThanOrEqual(result.right.left + 1)
  if (result.floating && result.stage) {
    expect(result.floating.left).toBeGreaterThanOrEqual(result.stage.left)
    expect(result.floating.right).toBeLessThanOrEqual(result.stage.right)
  }
}

async function expectCriticalTargets(page: Page, min: number) {
  const failures = await page.evaluate(({ min }) => {
    const selectors = [
      '.top-actions button:not([disabled])', '.rail button', '.tool-group button',
      '.floating-nav button', '.all-tools-launcher', '.all-tools-close',
    ]
    const nodes = selectors.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
    return nodes.filter((node) => {
      const r = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0 && (r.width < min || r.height < min)
    }).map((node) => {
      const r = node.getBoundingClientRect()
      return { label: node.getAttribute('title') || node.getAttribute('aria-label') || node.textContent?.trim().slice(0, 28), width: Math.round(r.width), height: Math.round(r.height) }
    })
  }, { min })
  expect(failures, `Critical controls below ${min}px: ${JSON.stringify(failures)}`).toEqual([])
}

test('visual audit — welcome hierarchy at desktop and mobile widths', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.welcome')).toBeVisible()
  await shot(page, '01-welcome-desktop')
  await expectNoViewportOverflow(page)
  await expect(page.getByRole('button', { name: /Open PDF or images/i })).toBeVisible()
  await expectVisibleFocus(page, '.primary.large')

  await page.setViewportSize({ width: 390, height: 844 })
  await shot(page, '02-welcome-mobile')
  await expectNoViewportOverflow(page)
  const cta = await page.getByRole('button', { name: /Open PDF or images/i }).boundingBox()
  expect(cta?.width || 0).toBeLessThan(360)
})

test('visual audit — editor desktop hierarchy, density, focus and primary workflows', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const source = testInfo.outputPath('visual-audit.pdf')
  await makeAuditPdf(source)
  await openAuditPdf(page, source)
  await shot(page, '03-editor-desktop')
  await expectNoViewportOverflow(page)
  await expectCoreDesktopGeometry(page)
  await expectCriticalTargets(page, 28)
  await expectVisibleFocus(page, '.editor-toolbar button')
  await expectVisibleFocus(page, '.rail button')
  await expect(page.getByRole('button', { name: 'Export PDF' })).toBeVisible()

  const search = page.getByPlaceholder('Find in document')
  await search.fill('Detail-oriented')
  await search.press('Enter')
  await expect(page.locator('.search-highlight')).toBeVisible({ timeout: 20_000 })
  await shot(page, '04-editor-search-result')
})

test('visual audit — progressive disclosure surfaces stay usable and unclipped', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const source = testInfo.outputPath('visual-audit-tools.pdf')
  await makeAuditPdf(source)
  await openAuditPdf(page, source)

  await page.getByTitle('All Tools').click()
  await expect(page.locator('.all-tools-drawer')).toBeVisible()
  await shot(page, '05-all-tools-desktop')
  const drawer = await page.locator('.all-tools-drawer').boundingBox()
  expect(drawer?.height || 9999).toBeLessThanOrEqual(900)
  expect(drawer?.width || 9999).toBeLessThanOrEqual(430)
  await expectNoViewportOverflow(page)
  await page.getByTitle('Close All Tools').click()

  await page.getByTitle('Document tools').click()
  await expect(page.locator('.advanced-modal')).toBeVisible()
  await shot(page, '06-document-tools-desktop')
  const advanced = await page.locator('.advanced-modal').boundingBox()
  expect(advanced?.top || 0).toBeGreaterThanOrEqual(8)
  expect(advanced?.bottom || 9999).toBeLessThanOrEqual(892)
  await page.locator('.advanced-modal header .icon-btn').click()

  await page.getByTitle('Embedded PDF objects').click()
  await expect(page.locator('.native-object-modal')).toBeVisible()
  await shot(page, '07-objects-desktop')
  const objects = await page.locator('.native-object-modal').boundingBox()
  expect(objects?.top || 0).toBeGreaterThanOrEqual(8)
  expect(objects?.bottom || 9999).toBeLessThanOrEqual(892)
  await page.getByTitle('Close embedded objects').click()
})

test('visual audit — tablet and mobile flows remain discoverable', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const source = testInfo.outputPath('visual-audit-responsive.pdf')
  await makeAuditPdf(source)

  await page.setViewportSize({ width: 1024, height: 768 })
  await openAuditPdf(page, source)
  await shot(page, '08-editor-tablet')
  await expectNoViewportOverflow(page)
  await expect(page.locator('.editor-toolbar')).toBeVisible()
  const toolbarOverflow = await page.locator('.editor-toolbar').evaluate((node) => (node as HTMLElement).scrollWidth - (node as HTMLElement).clientWidth)
  expect(toolbarOverflow).toBeLessThanOrEqual(1)

  await page.setViewportSize({ width: 390, height: 844 })
  await shot(page, '09-editor-mobile')
  await expectNoViewportOverflow(page)
  await expectCriticalTargets(page, 36)
  const float = await page.locator('.floating-nav').boundingBox()
  expect(float?.left || -1).toBeGreaterThanOrEqual(0)
  expect(float?.right || 9999).toBeLessThanOrEqual(390)

  await page.getByTitle('All Tools').click()
  await shot(page, '10-all-tools-mobile')
  await expect(page.locator('.all-tools-drawer')).toBeVisible()
  await page.getByRole('button', { name: /Pages/i }).first().click()
  await expect(page.locator('.left-panel')).toBeVisible()
  await shot(page, '11-mobile-pages-sheet')
})
