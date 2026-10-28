const MAX_PRINT_EDGE_PX = 2400
const PRINT_DPI_SCALE = 2
const JPEG_QUALITY = 0.82

export interface PdfImage {
  source: string
  setSource(source: string): void
}

export interface PdfImageDocument {
  images: PdfImage[]
  serialize(): string
}

export interface PdfImageInspection {
  mime: string
  naturalWidth: number
  naturalHeight: number
  cssWidth: number
  cssHeight: number
  hasAlpha: boolean
}

export interface PdfImageEncodeOptions {
  width: number
  height: number
  mime: 'image/jpeg'
  quality: number
}

export interface PdfImageAdapter {
  parse(html: string): PdfImageDocument
  inspect(image: PdfImage): Promise<PdfImageInspection>
  encode(image: PdfImage, options: PdfImageEncodeOptions): Promise<string>
}

/** Optimize only raster data that is larger than its actual print box. */
export async function optimizePdfImages(html: string, adapter: PdfImageAdapter): Promise<string> {
  const document = adapter.parse(html)
  await Promise.all(document.images.map(async (image) => {
    const source = image.source
    try {
      const inspected = await adapter.inspect(image)
      if (!isOptimizableRaster(inspected)) return
      const scale = Math.min(
        1,
        PRINT_DPI_SCALE * inspected.cssWidth / inspected.naturalWidth,
        PRINT_DPI_SCALE * inspected.cssHeight / inspected.naturalHeight,
        MAX_PRINT_EDGE_PX / inspected.naturalWidth,
        MAX_PRINT_EDGE_PX / inspected.naturalHeight,
      )
      const width = Math.max(1, Math.round(inspected.naturalWidth * scale))
      const height = Math.max(1, Math.round(inspected.naturalHeight * scale))
      if (width >= inspected.naturalWidth && height >= inspected.naturalHeight) return
      const optimized = await adapter.encode(image, { width, height, mime: 'image/jpeg', quality: JPEG_QUALITY })
      if (optimized.startsWith('data:image/jpeg;base64,')) image.setSource(optimized)
    } catch {
      // A broken decoder or canvas must never make an otherwise printable image disappear.
      image.setSource(source)
    }
  }))
  return document.serialize()
}

function isOptimizableRaster(image: PdfImageInspection): boolean {
  return image.mime !== 'image/svg+xml'
    && image.mime !== 'image/gif'
    && image.mime !== 'image/webp'
    && image.mime !== 'image/avif'
    && image.mime.startsWith('image/')
    && !image.hasAlpha
    && image.naturalWidth > 0
    && image.naturalHeight > 0
    && image.cssWidth > 0
    && image.cssHeight > 0
}

/** Browser-only adapter; it is called after the print iframe has laid out its real page CSS. */
export function createBrowserPdfImageAdapter(doc: Document): PdfImageAdapter {
  return {
    parse: () => {
      const images = Array.from(doc.images).map((element) => ({
        get source() { return element.currentSrc || element.src },
        setSource(source: string) { element.src = source },
        element,
      }))
      return {
        images,
        serialize: () => `<!DOCTYPE html>${doc.documentElement.outerHTML}`,
      }
    },
    inspect: async (image) => {
      const element = (image as PdfImage & { element: HTMLImageElement }).element
      await element.decode()
      const rect = element.getBoundingClientRect()
      const style = doc.defaultView?.getComputedStyle(element)
      const cssWidth = rect.width || parseCssPixels(style?.width)
      const cssHeight = rect.height || parseCssPixels(style?.height)
      return {
        mime: mimeFromSource(element.currentSrc || element.src),
        naturalWidth: element.naturalWidth,
        naturalHeight: element.naturalHeight,
        cssWidth,
        cssHeight,
        hasAlpha: await imageHasTransparency(element, doc),
      }
    },
    encode: async (image, options) => {
      const element = (image as PdfImage & { element: HTMLImageElement }).element
      const canvas = doc.createElement('canvas')
      canvas.width = options.width
      canvas.height = options.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas 2D context is unavailable')
      context.drawImage(element, 0, 0, options.width, options.height)
      return canvas.toDataURL(options.mime, options.quality)
    },
  }
}

function parseCssPixels(value: string | undefined): number {
  if (!value || value === 'auto') return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function mimeFromSource(source: string): string {
  const embedded = /^data:([^;,]+)/i.exec(source)?.[1]?.toLowerCase()
  if (embedded) return embedded
  const path = source.split(/[?#]/, 1)[0] ?? source
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'bmp') return 'image/bmp'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'avif') return 'image/avif'
  if (extension === 'svg') return 'image/svg+xml'
  return ''
}

async function imageHasTransparency(image: HTMLImageElement, doc: Document): Promise<boolean> {
  if (mimeFromSource(image.currentSrc || image.src) === 'image/jpeg') return false
  // Sample a small canvas to avoid allocating a full-size pixel buffer for large screenshots.
  const canvas = doc.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return true
  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 255) return true
    }
    return false
  } catch {
    // Tainted canvases and unsupported formats are preserved rather than flattened.
    return true
  }
}
