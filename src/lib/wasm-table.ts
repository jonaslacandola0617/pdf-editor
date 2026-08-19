type Leb = { value: number; next: number }

function readU32Leb(bytes: Uint8Array, offset: number): Leb {
  let value = 0
  let shift = 0
  let cursor = offset
  while (cursor < bytes.length && shift <= 28) {
    const byte = bytes[cursor++]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: cursor }
    shift += 7
  }
  throw new Error('Invalid WebAssembly LEB128 integer.')
}

function encodeU32Leb(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error('Invalid WebAssembly u32 value.')
  }
  const output: number[] = []
  let remaining = value >>> 0
  do {
    let byte = remaining & 0x7f
    remaining >>>= 7
    if (remaining) byte |= 0x80
    output.push(byte)
  } while (remaining)
  return new Uint8Array(output)
}

function concat(...parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function replaceRange(bytes: Uint8Array, start: number, end: number, replacement: Uint8Array) {
  return concat(bytes.slice(0, start), replacement, bytes.slice(end))
}

/**
 * Increase the maximum of the first funcref table in a WebAssembly module.
 *
 * Emscripten uses this table for C function pointers. The PDFium build we use
 * declares a fixed maximum equal to its initial table length, which prevents a
 * browser-side FPDF_FILEWRITE callback from being installed. We increase only
 * that declared maximum; the table is still instantiated at the original size.
 */
export function expandWasmFunctionTable(binary: ArrayBuffer, extraSlots = 8) {
  const bytes = new Uint8Array(binary)
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d ||
    bytes[4] !== 0x01 || bytes[5] !== 0x00 || bytes[6] !== 0x00 || bytes[7] !== 0x00
  ) {
    throw new Error('PDFium asset is not a supported WebAssembly module.')
  }

  let sectionOffset = 8
  while (sectionOffset < bytes.length) {
    const sectionId = bytes[sectionOffset]
    const sizeInfo = readU32Leb(bytes, sectionOffset + 1)
    const payloadStart = sizeInfo.next
    const payloadEnd = payloadStart + sizeInfo.value
    if (payloadEnd > bytes.length) throw new Error('Invalid WebAssembly section length.')

    if (sectionId !== 4) {
      sectionOffset = payloadEnd
      continue
    }

    const countInfo = readU32Leb(bytes, payloadStart)
    let cursor = countInfo.next
    for (let tableIndex = 0; tableIndex < countInfo.value; tableIndex++) {
      if (cursor >= payloadEnd) throw new Error('Invalid WebAssembly table section.')
      const refType = bytes[cursor++]
      const flagsInfo = readU32Leb(bytes, cursor)
      const flagsStart = cursor
      cursor = flagsInfo.next
      const minInfo = readU32Leb(bytes, cursor)
      cursor = minInfo.next

      // Current PDFium is a funcref table. Ignore unrelated future table kinds.
      const isFunctionTable = refType === 0x70
      const hasMaximum = (flagsInfo.value & 0x01) !== 0
      if (!hasMaximum) {
        if (isFunctionTable) return binary.slice(0)
        continue
      }

      const maxStart = cursor
      const maxInfo = readU32Leb(bytes, cursor)
      cursor = maxInfo.next
      if (!isFunctionTable) continue

      const desiredMax = Math.max(maxInfo.value, minInfo.value) + Math.max(1, extraSlots)
      const newMax = encodeU32Leb(desiredMax)
      const newPayload = replaceRange(bytes.slice(payloadStart, payloadEnd), maxStart - payloadStart, maxInfo.next - payloadStart, newMax)
      const newSectionSize = encodeU32Leb(newPayload.length)
      const rebuilt = concat(
        bytes.slice(0, sectionOffset + 1),
        newSectionSize,
        newPayload,
        bytes.slice(payloadEnd),
      )
      return rebuilt.buffer
    }

    throw new Error('PDFium WebAssembly module has no function table to expand.')
  }

  throw new Error('PDFium WebAssembly module has no table section.')
}
