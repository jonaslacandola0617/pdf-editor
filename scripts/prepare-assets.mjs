import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const source = resolve('node_modules/pdfjs-dist/standard_fonts')
const destination = resolve('public/pdfjs-standard-fonts')

if (!existsSync(source)) {
  throw new Error('PDF.js standard font assets are missing. Run npm install first.')
}

rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })
cpSync(source, destination, { recursive: true })
