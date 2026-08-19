export type Tool = 'select' | 'text' | 'highlight' | 'rectangle' | 'ink' | 'signature'

export type Point = { x: number; y: number }

export type Annotation = {
  id: string
  page: number
  type: Exclude<Tool, 'select'>
  x: number
  y: number
  width?: number
  height?: number
  text?: string
  color: string
  fontSize?: number
  strokeWidth?: number
  points?: Point[]
}

export type LibraryDocument = {
  id: string
  name: string
  bytes: ArrayBuffer
  pageCount: number
  size: number
  updatedAt: number
  annotations?: Annotation[]
  rotations?: number[]
  metadata?: PdfMetadata
}

export type PdfMetadata = {
  title: string
  author: string
  subject: string
  keywords: string
}

export type FormFieldState = {
  name: string
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'option' | 'unknown'
  value: string | boolean
  options?: string[]
}

export type PageOperation = {
  sourceIndex: number
  rotation: number
}
