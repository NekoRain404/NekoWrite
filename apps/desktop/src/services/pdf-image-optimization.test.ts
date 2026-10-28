import { describe, expect, it } from 'vitest'
import {
  optimizePdfImages,
  type PdfImage,
  type PdfImageAdapter,
  type PdfImageDocument,
} from './pdf-image-optimization'

function imageDocument(options: {
  source: string
  mime: string
  naturalWidth: number
  naturalHeight: number
  cssWidth: number
  cssHeight: number
  hasAlpha: boolean
}): PdfImageDocument {
  const image = {
    ...options,
    source: options.source,
    setSource(source: string) { image.source = source },
  }
  return {
    images: [image],
    serialize: () => `<img src="${image.source}">`,
  }
}

function adapterFor(
  document: PdfImageDocument,
  encode: PdfImageAdapter['encode'],
): PdfImageAdapter {
  return {
    parse: () => document,
    inspect: async (image) => {
      const candidate = image as PdfImage & {
        mime: string
        naturalWidth: number
        naturalHeight: number
        cssWidth: number
        cssHeight: number
        hasAlpha: boolean
      }
      return candidate
    },
    encode,
  }
}

describe('optimizePdfImages', () => {
  it('re-encodes an opaque raster and bounds oversized source pixels for print CSS size', async () => {
    const document = imageDocument({
      source: `data:image/png;base64,${'A'.repeat(9000)}`,
      mime: 'image/png',
      naturalWidth: 6000,
      naturalHeight: 4000,
      cssWidth: 500,
      cssHeight: 333,
      hasAlpha: false,
    })
    let encoded: Parameters<PdfImageAdapter['encode']>[1] | undefined
    const adapter = adapterFor(document, async (_image, options) => {
      encoded = options
      return 'data:image/jpeg;base64,small'
    })

    const result = await optimizePdfImages('<html><img></html>', adapter)

    expect(encoded).toEqual({ width: 999, height: 666, mime: 'image/jpeg', quality: 0.82 })
    expect(result).toContain('data:image/jpeg;base64,small')
    expect(result.length).toBeLessThan(100)
  })

  it('keeps SVG and transparent PNG sources unchanged', async () => {
    const svg = imageDocument({
      source: 'data:image/svg+xml;base64,vector',
      mime: 'image/svg+xml', naturalWidth: 3000, naturalHeight: 2000,
      cssWidth: 500, cssHeight: 333, hasAlpha: true,
    })
    const transparent = imageDocument({
      source: 'data:image/png;base64,transparent',
      mime: 'image/png', naturalWidth: 3000, naturalHeight: 2000,
      cssWidth: 500, cssHeight: 333, hasAlpha: true,
    })
    let encodes = 0
    const adapter = adapterFor({
      images: [...svg.images, ...transparent.images],
      serialize: () => `${svg.serialize()}${transparent.serialize()}`,
    }, async () => {
      encodes += 1
      return 'data:image/jpeg;base64,flattened'
    })

    const result = await optimizePdfImages('<html></html>', adapter)

    expect(encodes).toBe(0)
    expect(result).toContain('data:image/svg+xml;base64,vector')
    expect(result).toContain('data:image/png;base64,transparent')
  })

  it('retains the original image when decoding or re-encoding fails', async () => {
    const document = imageDocument({
      source: 'data:image/jpeg;base64,source',
      mime: 'image/jpeg', naturalWidth: 5000, naturalHeight: 3000,
      cssWidth: 400, cssHeight: 240, hasAlpha: false,
    })
    const adapter = adapterFor(document, async () => { throw new Error('canvas unavailable') })

    const result = await optimizePdfImages('<html><img></html>', adapter)

    expect(result).toContain('data:image/jpeg;base64,source')
  })
})
