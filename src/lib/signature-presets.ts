import type { Annotation, Point } from '../types'

export type SignaturePreset = {
  id: string
  name: string
  points: Point[]
  aspect: number
  updatedAt: number
}

const KEY = 'pdf-forge-signatures'

export function loadSignaturePresets(): SignaturePreset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && Array.isArray(item.points) && typeof item.id === 'string').slice(0, 8)
  } catch {
    return []
  }
}

export function storeSignaturePresets(presets: SignaturePreset[]) {
  localStorage.setItem(KEY, JSON.stringify(presets.slice(0, 8)))
}

export function presetFromAnnotation(annotation: Annotation, name: string): SignaturePreset | null {
  if (annotation.type !== 'signature' || !annotation.points || annotation.points.length < 2) return null
  const xs = annotation.points.map((point) => point.x)
  const ys = annotation.points.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const width = Math.max(0.0001, maxX - minX)
  const height = Math.max(0.0001, maxY - minY)
  return {
    id: crypto.randomUUID(),
    name: name.trim() || 'Signature',
    aspect: height / width,
    points: annotation.points.map((point) => ({ x: (point.x - minX) / width, y: (point.y - minY) / height })),
    updatedAt: Date.now(),
  }
}

export function annotationFromPreset(preset: SignaturePreset, page: number, color = '#111111', strokeWidth = 2): Annotation {
  const width = 0.28
  const height = Math.max(0.035, Math.min(0.16, width * preset.aspect))
  const x = Math.max(0.02, 0.5 - width / 2)
  const y = Math.max(0.02, 0.72 - height / 2)
  return {
    id: crypto.randomUUID(),
    page,
    type: 'signature',
    x,
    y,
    color,
    strokeWidth: Math.max(2, strokeWidth),
    points: preset.points.map((point) => ({ x: x + point.x * width, y: y + point.y * height })),
  }
}
