import { useEffect, useRef, useState } from 'react'
import { ScanText } from 'lucide-react'
import { OCR_EVENT } from '../lib/ocr'

type Activity = {
  phase: 'loading' | 'recognizing' | 'done' | 'error' | 'cached'
  pageNumber?: number
  pageCount?: number
  progress?: number
  status?: string
}

export function OcrActivity() {
  const [activity, setActivity] = useState<Activity | null>(null)
  const clearTimer = useRef<number | null>(null)

  useEffect(() => {
    const onActivity = (event: Event) => {
      const detail = (event as CustomEvent<Activity>).detail
      if (clearTimer.current) window.clearTimeout(clearTimer.current)
      setActivity(detail)
      if (detail.phase === 'done' || detail.phase === 'cached' || detail.phase === 'error') {
        clearTimer.current = window.setTimeout(() => setActivity(null), detail.phase === 'error' ? 3200 : 1100)
      }
    }
    window.addEventListener(OCR_EVENT, onActivity)
    return () => {
      window.removeEventListener(OCR_EVENT, onActivity)
      if (clearTimer.current) window.clearTimeout(clearTimer.current)
    }
  }, [])

  if (!activity) return null

  const percent = Math.max(0, Math.min(100, Math.round((activity.progress || 0) * 100)))
  const pageLabel = activity.pageNumber && activity.pageCount
    ? `Page ${activity.pageNumber} of ${activity.pageCount}`
    : 'OCR engine'

  return (
    <aside className={`ocr-activity ${activity.phase}`} aria-live="polite">
      <span className="ocr-icon"><ScanText /></span>
      <div className="ocr-copy">
        <div><strong>On-device OCR</strong><span>{pageLabel}</span></div>
        <p>{activity.status || 'Recognizing text…'}</p>
        {(activity.phase === 'loading' || activity.phase === 'recognizing') && (
          <div className="ocr-progress"><span style={{ width: `${percent}%` }} /></div>
        )}
      </div>
      {(activity.phase === 'loading' || activity.phase === 'recognizing') && <b>{percent}%</b>}
    </aside>
  )
}
