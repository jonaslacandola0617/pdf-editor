import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { OcrActivity } from './components/OcrActivity'
import './acrobat-polish.css'
import './ocr.css'

const RESUME_KEY = 'pdf-forge-resume-editor'

function installEditorResume() {
  const markOpen = () => localStorage.setItem(RESUME_KEY, '1')
  const markClosed = () => localStorage.setItem(RESUME_KEY, '0')

  window.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    if (!target) return

    if (target.closest('[title="Close document"]')) {
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
    <OcrActivity />
  </StrictMode>,
)

installEditorResume()
