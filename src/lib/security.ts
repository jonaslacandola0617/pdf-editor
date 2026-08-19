import { createQpdfRunner } from 'qpdf-run'
import qpdfWorkerUrl from 'qpdf-run/worker?url'
import qpdfJsUrl from 'qpdf-run/qpdf.js?url'
import qpdfWasmUrl from 'qpdf-run/qpdf.wasm?url'

let runnerPromise: ReturnType<typeof createQpdfRunner> | null = null

async function getRunner() {
  if (!runnerPromise) {
    runnerPromise = createQpdfRunner({
      workerUrl: qpdfWorkerUrl,
      qpdfJsUrl,
      wasmUrl: qpdfWasmUrl,
      timeoutMs: 60000,
    })
  }
  return runnerPromise
}

async function runOne(bytes: ArrayBuffer, args: string[]) {
  const runner = await getRunner()
  const output = await runner.runOne({
    input: new Uint8Array(bytes.slice(0)),
    inputName: 'input.pdf',
    outputName: 'output.pdf',
    args,
  })
  return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer
}

export async function optimizePdf(bytes: ArrayBuffer) {
  return runOne(bytes, [
    '--object-streams=generate',
    '--stream-data=compress',
    '--recompress-flate',
    '--compression-level=9',
    '--linearize',
    '--',
    'input.pdf',
    'output.pdf',
  ])
}

export async function encryptPdf(bytes: ArrayBuffer, userPassword: string, ownerPassword?: string) {
  if (!userPassword) throw new Error('Enter a password first.')
  const owner = ownerPassword || `${userPassword}-owner`
  return runOne(bytes, [
    '--encrypt',
    userPassword,
    owner,
    '256',
    '--',
    'input.pdf',
    'output.pdf',
  ])
}

export async function decryptPdf(bytes: ArrayBuffer, password: string) {
  return runOne(bytes, [
    `--password=${password}`,
    '--decrypt',
    '--',
    'input.pdf',
    'output.pdf',
  ])
}
