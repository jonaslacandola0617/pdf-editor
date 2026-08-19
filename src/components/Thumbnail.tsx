import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from '../lib/pdfjs'

export function Thumbnail({
  pdf, pageIndex, rotation, active, onClick,
}: {
  pdf: PDFDocumentProxy
  pageIndex: number
  rotation: number
  active: boolean
  onClick: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const page = await pdf.getPage(pageIndex + 1)
      if (cancelled) return
      const base = page.getViewport({ scale: 1, rotation })
      const scale = Math.min(132 / base.width, 160 / base.height)
      const viewport = page.getViewport({ scale, rotation })
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = Math.max(1, Math.floor(viewport.width))
      canvas.height = Math.max(1, Math.floor(viewport.height))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      await page.render({ canvasContext: ctx, viewport }).promise
    }
    run()
    return () => { cancelled = true }
  }, [pdf, pageIndex, rotation])

  return (
    <button className={`thumbnail ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="thumb-sheet"><canvas ref={canvasRef} /></span>
      <span className="thumb-label">{pageIndex + 1}</span>
    </button>
  )
}
