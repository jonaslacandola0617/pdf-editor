import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AllTools } from './components/AllTools'
import { NavigationExtras } from './components/NavigationExtras'
import { OcrActivity } from './components/OcrActivity'
import './acrobat-polish.css'
import './all-tools.css'
import './ocr.css'
import './completion.css'
import './navigation-extras.css'
import './ux-audit.css'

const RESUME_KEY = 'pdf-forge-resume-editor'
const WORKSPACE_KEY = 'pdf-forge-workspace'

type WorkspaceState = {
  name: string
  page: number
  zoom: number
  panel: string
  pageScrollTop: number
  pageScrollLeft: number
  leftScrollTop: number
  rightScrollTop: number
}

let restoringWorkspace = false

function zoomFromDom() {
  const zoomLabel = Array.from(document.querySelectorAll<HTMLElement>('.floating-nav > span'))
    .find((node) => /%/.test(node.textContent || ''))
  return Number((zoomLabel?.textContent || '').replace('%', '').trim()) || 105
}

function workspaceFromDom(): WorkspaceState | null {
  if (!document.querySelector('.app-shell')) return null
  const name = document.querySelector<HTMLInputElement>('.doc-title input')?.value
  const page = Number(document.querySelector<HTMLInputElement>('.floating-nav input')?.value)
  if (!name || !Number.isFinite(page)) return null
  return {
    name,
    page,
    zoom: zoomFromDom(),
    panel: document.querySelector<HTMLButtonElement>('.rail button.active')?.title || 'Pages',
    pageScrollTop: document.querySelector<HTMLElement>('.page-scroll')?.scrollTop || 0,
    pageScrollLeft: document.querySelector<HTMLElement>('.page-scroll')?.scrollLeft || 0,
    leftScrollTop: document.querySelector<HTMLElement>('.left-panel')?.scrollTop || 0,
    rightScrollTop: document.querySelector<HTMLElement>('.right-panel')?.scrollTop || 0,
  }
}

function saveWorkspace() {
  if (restoringWorkspace) return
  const state = workspaceFromDom()
  if (state) localStorage.setItem(WORKSPACE_KEY, JSON.stringify(state))
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function restoreWorkspace() {
  const raw = localStorage.getItem(WORKSPACE_KEY)
  if (!raw) return
  let saved: WorkspaceState
  try { saved = JSON.parse(raw) as WorkspaceState } catch { return }

  const currentName = document.querySelector<HTMLInputElement>('.doc-title input')?.value
  if (!currentName || saved.name !== currentName) return
  restoringWorkspace = true

  const panel = Array.from(document.querySelectorAll<HTMLButtonElement>('.rail button'))
    .find((button) => button.title === saved.panel)
  panel?.click()

  const pageInput = document.querySelector<HTMLInputElement>('.floating-nav input')
  if (pageInput && Number.isFinite(saved.page)) setReactInputValue(pageInput, String(saved.page))

  const restoreZoom = (attempt = 0) => {
    const current = zoomFromDom()
    if (Math.abs(current - saved.zoom) <= 1 || attempt >= 24) return
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.floating-nav > button'))
    if (buttons.length < 4) return
    const button = saved.zoom > current ? buttons[buttons.length - 1] : buttons[buttons.length - 2]
    button.click()
    window.setTimeout(() => restoreZoom(attempt + 1), 18)
  }
  restoreZoom()

  const restoreScroll = () => {
    const pageScroll = document.querySelector<HTMLElement>('.page-scroll')
    if (pageScroll) {
      pageScroll.scrollTop = saved.pageScrollTop || 0
      pageScroll.scrollLeft = saved.pageScrollLeft || 0
    }
    const left = document.querySelector<HTMLElement>('.left-panel')
    if (left) left.scrollTop = saved.leftScrollTop || 0
    const right = document.querySelector<HTMLElement>('.right-panel')
    if (right) right.scrollTop = saved.rightScrollTop || 0
  }

  window.setTimeout(restoreScroll, 220)
  window.setTimeout(restoreScroll, 650)
  window.setTimeout(() => { restoringWorkspace = false }, 800)
}

function installWorkspacePersistence() {
  let saveTimer = 0
  const scheduleSave = () => {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(saveWorkspace, 160)
  }

  window.addEventListener('click', scheduleSave, true)
  window.addEventListener('input', scheduleSave, true)
  window.addEventListener('change', scheduleSave, true)
  window.addEventListener('scroll', (event) => {
    const target = event.target as HTMLElement | null
    if (target?.matches?.('.page-scroll, .left-panel, .right-panel')) scheduleSave()
  }, true)

  let restored = false
  const tryRestore = () => {
    if (restored || !document.querySelector('.app-shell')) return false
    const name = document.querySelector<HTMLInputElement>('.doc-title input')?.value
    if (!name) return false
    restored = true
    window.setTimeout(restoreWorkspace, 60)
    return true
  }

  if (tryRestore()) return
  const observer = new MutationObserver(() => {
    if (tryRestore()) observer.disconnect()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  window.setTimeout(() => observer.disconnect(), 7000)
}

function installEditorResume() {
  const markOpen = () => localStorage.setItem(RESUME_KEY, '1')
  const markClosed = () => localStorage.setItem(RESUME_KEY, '0')

  window.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    if (!target) return

    if (target.closest('[title="Close document"]')) {
      saveWorkspace()
      markClosed()
      return
    }

    if (target.closest('.recent-row') || target.closest('.library-item > button:first-child')) {
      markOpen()
    }
  }, true)

  window.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement | null
    if (target?.type === 'file' && target.files?.length) markOpen()
  }, true)

  window.addEventListener('drop', (event) => {
    if (event.dataTransfer?.files?.length) markOpen()
  }, true)

  if (localStorage.getItem(RESUME_KEY) !== '1') return

  const tryResume = () => {
    if (document.querySelector('.app-shell')) return true
    const recent = document.querySelector<HTMLButtonElement>('.recent-row')
    if (!recent) return false
    recent.click()
    return true
  }

  if (tryResume()) return

  const observer = new MutationObserver(() => {
    if (tryResume()) observer.disconnect()
  })

  observer.observe(document.body, { childList: true, subtree: true })
  window.setTimeout(() => observer.disconnect(), 5000)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <AllTools />
    <NavigationExtras />
    <OcrActivity />
  </StrictMode>,
)

installEditorResume()
installWorkspacePersistence()
