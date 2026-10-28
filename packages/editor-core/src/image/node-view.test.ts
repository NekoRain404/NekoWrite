import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Node as ProseNode } from '@milkdown/prose/model'

import { configureImageResolver, invalidateImageResolution } from './resolver'
import { makeImageNodeView } from './node-view'
import { configureImageNodeMessages } from './messages'
import { imageSelectionPlugin } from './selection'
import { createEditor, basicPlugins } from '../editor'

/** Flush every pending microtask (resolver chain) before asserting. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

// Real ProseMirror nodes share one type object per schema; mirror that so
// the nodeView's `newNode.type !== node.type` identity check behaves the same.
const IMAGE_TYPE = { name: 'image' }

function fakeNode(attrs: Record<string, string>): ProseNode {
  return {
    attrs,
    type: IMAGE_TYPE,
  } as unknown as ProseNode
}

function makeView(node: ProseNode): {
  dom: HTMLElement
  img: HTMLImageElement
  selectNode: () => void
  deselectNode: () => void
  update: (n: ProseNode) => boolean
} {
  // The factory only reads `node`; the view/getPos args stay unused there.
  const spec = (makeImageNodeView as (n: ProseNode) => unknown)(node) as {
    dom: HTMLElement
    update: (n: ProseNode) => boolean
    selectNode?: () => void
    deselectNode?: () => void
    destroy?: () => void
  }
  mountedViews.push(spec)
  return {
    dom: spec.dom,
    img: spec.dom.querySelector('img') as HTMLImageElement,
    selectNode: spec.selectNode ?? (() => undefined),
    deselectNode: spec.deselectNode ?? (() => undefined),
    update: spec.update,
  }
}

// Node views subscribe to resolution invalidation, so a test that does not
// tear its view down leaves a listener behind that later invalidations wake —
// which made counts bleed across cases.
const mountedViews: Array<{ destroy?: () => void }> = []

afterEach(() => {
  for (const view of mountedViews.splice(0)) view.destroy?.()
  configureImageResolver(null)
})

describe('image node view', () => {
  it('renders an img with the raw document src when no resolver is set', () => {
    const { dom, img } = makeView(fakeNode({ src: 'attachments/a.png', alt: 'A', title: '' }))
    expect(dom.tagName).toBe('FIGURE')
    expect(img.tagName).toBe('IMG')
    expect(img.getAttribute('src')).toBe('attachments/a.png')
    expect(img.getAttribute('alt')).toBe('A')
    expect(img.hasAttribute('title')).toBe(false)
  })

  it('swaps in the resolved display URL asynchronously, keeping attrs intact', async () => {
    configureImageResolver(async () => 'data:image/png;base64,XYZ')
    const { img } = makeView(fakeNode({ src: 'attachments/a.png', alt: 'A', title: 'T' }))
    // A vault-relative src is not loadable on its own, so the element must not
    // be pointed at it: doing so fires an `error` the resolver's later success
    // does not clear (the "images fail on open" report).
    expect(img.hasAttribute('src')).toBe(false)
    await flush()
    expect(img.getAttribute('src')).toBe('data:image/png;base64,XYZ')
    expect(img.getAttribute('alt')).toBe('A')
    expect(img.getAttribute('title')).toBe('T')
  })

  it('paints a self-displayable src immediately, without waiting for the resolver', () => {
    configureImageResolver(async () => 'data:image/png;base64,XYZ')
    const { img } = makeView(fakeNode({ src: 'https://example.test/a.png', alt: '', title: '' }))
    // Already loadable, so showing it at once avoids a blank frame.
    expect(img.getAttribute('src')).toBe('https://example.test/a.png')
  })

  it('clears a failure state once the resolved image actually loads', async () => {
    // The reported bug: opening a note showed the error overlay over an image
    // that had in fact loaded, and only Retry cleared it. A `load` event now
    // clears the latch, so the overlay cannot outlive the failure.
    configureImageResolver(async () => 'data:image/png;base64,XYZ')
    const { img, dom } = makeView(fakeNode({ src: 'attachments/a.png', alt: '', title: '' }))
    await flush()
    // Fail first (e.g. a transient error), then succeed.
    img.dispatchEvent(new Event('error'))
    expect(dom.getAttribute('data-failed')).toBe('true')
    img.dispatchEvent(new Event('load'))
    expect(dom.getAttribute('data-failed')).toBe('false')
  })

  it('retry re-resolves instead of replaying a memoized failure', async () => {
    // The first resolution can run before the vault is authorized; memoizing
    // that failure made Retry a no-op forever.
    let attempt = 0
    configureImageResolver(async (src) => {
      attempt += 1
      return attempt === 1 ? src : `data:image/png;base64,OK`
    })
    const { img, dom } = makeView(fakeNode({ src: 'attachments/a.png', alt: '', title: '' }))
    await flush()
    expect(img.getAttribute('src')).toBe('attachments/a.png')
    img.dispatchEvent(new Event('error'))
    expect(dom.getAttribute('data-failed')).toBe('true')

    const retry = dom.querySelector('.neko-image-error-retry') as HTMLButtonElement
    retry.click()
    await flush()
    expect(img.getAttribute('src')).toBe('data:image/png;base64,OK')
    expect(dom.getAttribute('data-failed')).toBe('false')
  })

  it('retry busts the browser cache when resolution has nothing better to offer', async () => {
    // No resolver improvement to make: the src is already the display URL, so
    // the retry has to force a fresh request.
    configureImageResolver(async (src) => src)
    const { img, dom } = makeView(fakeNode({ src: 'attachments/a.png', alt: '', title: '' }))
    await flush()
    img.dispatchEvent(new Event('error'))

    const retry = dom.querySelector('.neko-image-error-retry') as HTMLButtonElement
    retry.click()
    await flush()
    expect(img.getAttribute('src')).toMatch(/^attachments\/a\.png\?retry=\d+$/)
  })

  it('reloads a successfully loaded display URL after image resolution is invalidated', async () => {
    configureImageResolver(async () => 'asset:///vault/attachments/a.png')
    const { img } = makeView(fakeNode({ src: 'attachments/a.png', alt: '', title: '' }))
    await flush()
    expect(img.getAttribute('src')).toBe('asset:///vault/attachments/a.png')

    invalidateImageResolution()
    await flush()

    expect(img.getAttribute('src')).toMatch(/^asset:\/\/\/vault\/attachments\/a\.png\?refresh=\d+$/)
  })

  it('applies a newer update and ignores the stale resolution result', async () => {
    configureImageResolver(async (src) => `resolved:${src}`)
    const node = fakeNode({ src: 'a.png', alt: '', title: '' })
    const { img, update } = makeView(node)
    // Re-render with a different src before the first promise settles.
    const second = fakeNode({ src: 'b.png', alt: '', title: '' })
    expect(update(second)).toBe(true)
    await flush()
    expect(img.getAttribute('src')).toBe('resolved:b.png')
  })

  it('rejects updates of a different node type', () => {
    const node = fakeNode({ src: 'a.png', alt: '', title: '' })
    const { update } = makeView(node)
    const other = { attrs: {}, type: { name: 'paragraph' } } as unknown as ProseNode
    expect(update(other)).toBe(false)  })

  it('renders an empty img for an empty src', () => {
    const { img, dom } = makeView(fakeNode({ src: '', alt: '', title: '' }))
    expect(img.hasAttribute('src')).toBe(false)
    expect(dom.getAttribute('data-failed')).toBe('true')
  })

  it('never lets the async swap mutate the document model', async () => {
    const resolve = vi.fn(async () => 'data:image/png;base64,XYZ')
    configureImageResolver(resolve)
    const node = fakeNode({ src: 'attachments/a.png', alt: '', title: '' })
    makeView(node)
    await flush()
    // The node's attrs are untouched — serialization fidelity is preserved.
    expect(node.attrs.src).toBe('attachments/a.png')
  })

  it('toggles the selected state via selectNode/deselectNode', () => {
    const { dom, selectNode, deselectNode } = makeView(
      fakeNode({ src: 'a.png', alt: '', title: '' }),
    )
    expect(dom.getAttribute('data-selected')).toBe('false')
    selectNode()
    expect(dom.getAttribute('data-selected')).toBe('true')
    deselectNode()
    expect(dom.getAttribute('data-selected')).toBe('false')
  })

  it('exposes a visible resize handle and aria-label from alt', () => {
    const { dom, img } = makeView(fakeNode({ src: 'a.png', alt: 'Cat photo', title: '' }))
    expect(dom.querySelector('[data-testid="neko-image-handle"]')).toBeTruthy()
    expect(dom.getAttribute('role')).toBe('img')
    expect(dom.getAttribute('aria-label')).toBe('Cat photo')
    expect(img.getAttribute('alt')).toBe('Cat photo')
  })

  it('marks the wrapper failed and exposes the recoverable overlay', () => {
    const { dom } = makeView(fakeNode({ src: 'a.png', alt: '', title: '' }))
    const img = dom.querySelector('img') as HTMLImageElement
    img.dispatchEvent(new Event('error'))
    expect(dom.getAttribute('data-failed')).toBe('true')
    const overlay = dom.querySelector('.neko-image-error') as HTMLElement
    expect(overlay).toBeTruthy()
    expect(overlay.hasAttribute('hidden')).toBe(false)
    const retry = dom.querySelector('.neko-image-error-retry') as HTMLButtonElement
    expect(retry).toBeTruthy()
    retry.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(dom.getAttribute('data-failed')).toBe('false')
  })

  it('clicking the figure selects the image (handleClick -> NodeSelection)', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const editor = createEditor(el, { plugins: basicPlugins })
    await editor.open('# t\n\n![](attachments/a.png)\n')
    const view = editor.getView()
    const fig = el.querySelector('.neko-image') as HTMLElement
    expect(fig).toBeTruthy()
    // A mouse click on a real editor goes through PM's click pipeline which
    // invokes this handler; the jsdom synthetic click does not, so invoke the
    // handler directly here (the E2E covers the pipeline end-to-end).
    const props = imageSelectionPlugin.spec.props as {
      handleClick: (v: unknown, pos: number, e: { target: EventTarget | null }) => boolean
    }
    const handled = props.handleClick(view, 0, { target: fig })
    expect(handled).toBe(true)
    const { NodeSelection } = await import('@milkdown/prose/state')
    expect(view.state.selection instanceof NodeSelection).toBe(true)
    const imageSel = view.state.selection as unknown as { node: { type: { name: string } } }
    expect(imageSel.node.type.name).toBe('image')
    editor.destroy()
  })
})

describe('image node view failure recovery', () => {
  it('re-resolves when resolution is invalidated after a failure', async () => {
    // The reported scenario: the panel renders before the vault is authorized,
    // so the first resolution fails and the image shows its error overlay. When
    // the vault becomes ready the app invalidates resolution, and the node view
    // must pick the real URL up without a manual Retry.
    let ready = false
    configureImageResolver(async (src) => {
      if (!ready) throw new Error('vault not ready')
      return `data:image/png;base64,OK:${src}`
    })
    const { img, dom } = makeView(fakeNode({ src: 'welcome_assets/a.png', alt: '', title: '' }))
    await flush()
    img.dispatchEvent(new Event('error'))
    expect(dom.getAttribute('data-failed')).toBe('true')

    // The vault arrives.
    ready = true
    invalidateImageResolution()
    await flush()

    expect(img.getAttribute('src')).toBe('data:image/png;base64,OK:welcome_assets/a.png')
  })

  it('stops listening once destroyed', async () => {
    let attempts = 0
    configureImageResolver(async () => {
      attempts += 1
      throw new Error('nope')
    })
    const spec = (makeImageNodeView as (n: ProseNode) => unknown)(
      fakeNode({ src: 'welcome_assets/a.png', alt: '', title: '' }),
    ) as { dom: HTMLElement; destroy?: () => void }
    mountedViews.push(spec)
    await flush()
    const img = spec.dom.querySelector('img') as HTMLImageElement
    img.dispatchEvent(new Event('error'))
    const before = attempts

    spec.destroy?.()
    invalidateImageResolution()
    await flush()
    // A torn-down node view must not keep re-resolving (or touch a dead DOM).
    expect(attempts).toBe(before)
  })

  it('ignores a load event from a superseded src', async () => {
    configureImageResolver(async () => 'data:image/png;base64,OK')
    const node = fakeNode({ src: 'a.png', alt: '', title: '' })
    const { img, dom, update } = makeView(node)
    await flush()
    // The node is re-rendered with a new src before the old one reports load.
    update(fakeNode({ src: 'b.png', alt: '', title: '' }))
    await flush()
    img.dispatchEvent(new Event('error'))
    expect(dom.getAttribute('data-failed')).toBe('true')

    // A late `load` carrying the old src must not clear the current failure.
    Object.defineProperty(img, 'getAttribute', {
      value: (name: string) => (name === 'src' ? 'a.png' : null),
      configurable: true,
    })
    img.dispatchEvent(new Event('load'))
    expect(dom.getAttribute('data-failed')).toBe('true')
  })

  it('clears the failure state when the current src loads', async () => {
    configureImageResolver(async () => 'data:image/png;base64,OK')
    const { img, dom } = makeView(fakeNode({ src: 'a.png', alt: '', title: '' }))
    await flush()
    img.dispatchEvent(new Event('error'))
    expect(dom.getAttribute('data-failed')).toBe('true')
    img.dispatchEvent(new Event('load'))
    expect(dom.getAttribute('data-failed')).toBe('false')
  })
})

describe('remote image failures', () => {
  it('explains the security policy instead of offering a useless Retry', () => {
    // The packaged app's CSP refuses `img-src https:`, so a remote picture can
    // never load. "Image failed to load" + Retry was misleading: Retry cannot
    // succeed, and the user gets no way forward.
    const { img, dom } = makeView(fakeNode({ src: 'https://example.test/a.png', alt: '', title: '' }))
    img.dispatchEvent(new Event('error'))

    const box = dom.querySelector('.neko-image-error') as HTMLElement
    expect(box.hasAttribute('hidden')).toBe(false)
    const msg = dom.querySelector('.neko-image-error-msg') as HTMLElement
    expect(msg.textContent).toMatch(/security policy/i)

    const retry = dom.querySelector('.neko-image-error-retry') as HTMLButtonElement
    const open = dom.querySelector('.neko-image-error-open') as HTMLButtonElement
    expect(retry.hasAttribute('hidden')).toBe(true)
    expect(open.hasAttribute('hidden')).toBe(false)
  })

  it('keeps Retry for a local image that failed', () => {
    const { img, dom } = makeView(fakeNode({ src: 'attachments/a.png', alt: '', title: '' }))
    img.dispatchEvent(new Event('error'))

    const msg = dom.querySelector('.neko-image-error-msg') as HTMLElement
    expect(msg.textContent).toMatch(/failed to load/i)
    expect((dom.querySelector('.neko-image-error-retry') as HTMLElement).hasAttribute('hidden')).toBe(false)
    expect((dom.querySelector('.neko-image-error-open') as HTMLElement).hasAttribute('hidden')).toBe(true)
  })

  it('honours host-installed strings', () => {
    configureImageNodeMessages({ loadFailed: '本地化失败文案', retry: '重试' })
    try {
      const { img, dom } = makeView(fakeNode({ src: 'attachments/a.png', alt: '', title: '' }))
      img.dispatchEvent(new Event('error'))
      expect((dom.querySelector('.neko-image-error-msg') as HTMLElement).textContent).toBe('本地化失败文案')
      expect((dom.querySelector('.neko-image-error-retry') as HTMLElement).textContent).toBe('重试')
    } finally {
      configureImageNodeMessages(null)
    }
  })
})
