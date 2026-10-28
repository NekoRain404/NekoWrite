import { $view } from '@milkdown/utils'
import type { NodeViewConstructor } from '@milkdown/prose/view'

import {
  hasImageResolver,
  isSelfDisplayableSrc,
  onImageResolutionInvalidated,
  resolveImageSrc,
} from './resolver'
import { imageNodeMessages, isRemoteHttpSrc } from './messages'
import { imageDimSchema } from './schema'
import { startResizeDrag } from './resize-drag-node'

/**
 * Node view for the commonmark `image` node.
 *
 * The schema's own toDOM already renders an <img> whose src attribute is the
 * raw document src (vault-relative path — kept faithful for serialization).
 * This node view wraps the element in a `<figure>` and:
 *  - renders the <img> (display URL resolved async without touching the model);
 *  - shows a selected state (outline + a visible resize handle) when the node
 *    is under a NodeSelection;
 *  - drags the bottom-right handle to resize width (or width+height
 *    proportionally with Shift held), coalescing the whole drag into ONE
 *    transaction (one undo step);
 *  - shows a recoverable error placeholder when the image fails to load.
 */
export const makeImageNodeView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('figure')
  dom.className = 'neko-image'
  dom.setAttribute('data-selected', 'false')

  const img = document.createElement('img')
  const handle = document.createElement('span')
  handle.className = 'neko-image-handle'
  handle.setAttribute('aria-hidden', 'true')
  handle.setAttribute('data-testid', 'neko-image-handle')

  const errorBox = document.createElement('div')
  errorBox.className = 'neko-image-error'
  const errorMsg = document.createElement('span')
  errorMsg.className = 'neko-image-error-msg'
  const retryBtn = document.createElement('button')
  retryBtn.className = 'neko-image-error-retry'
  retryBtn.type = 'button'
  retryBtn.textContent = imageNodeMessages().retry
  // A remote http(s) image is refused by the host's CSP, so Retry cannot ever
  // succeed; the honest affordance there is opening it in the system browser.
  const openBtn = document.createElement('button')
  openBtn.className = 'neko-image-error-open'
  openBtn.type = 'button'
  openBtn.textContent = imageNodeMessages().openInBrowser
  openBtn.setAttribute('hidden', '')
  errorBox.appendChild(errorMsg)
  errorBox.appendChild(retryBtn)
  errorBox.appendChild(openBtn)
  errorBox.setAttribute('hidden', '')

  dom.appendChild(img)
  dom.appendChild(handle)
  dom.appendChild(errorBox)

  // Bumped on every render and on destroy; only the latest render may apply
  // its async resolution result to the DOM.
  let version = 0
  let failedSrc: string | null = null
  // The src the element is currently meant to show, so a `load` for an earlier
  // src cannot clear the failure of a later one.
  let expectedSrc: string | null = null

  const applyDims = (): void => {
    const width = Number(node.attrs.width)
    if (Number.isFinite(width) && width > 0) img.style.width = `${width}px`
    else img.style.width = ''

    const height = Number(node.attrs.height)
    if (Number.isFinite(height) && height > 0) img.style.height = `${height}px`
    else img.style.height = ''

    const align = String(node.attrs.align ?? '')
    if (align === 'center') {
      img.style.display = 'block'
      img.style.marginLeft = 'auto'
      img.style.marginRight = 'auto'
      img.style.float = ''
    } else if (align === 'left') {
      img.style.float = 'left'
      img.style.display = ''
      img.style.marginLeft = ''
      img.style.marginRight = ''
    } else if (align === 'right') {
      img.style.float = 'right'
      img.style.display = ''
      img.style.marginLeft = ''
      img.style.marginRight = ''
    } else {
      img.style.float = ''
      img.style.display = ''
      img.style.marginLeft = ''
      img.style.marginRight = ''
    }
  }

  /** Show the failure overlay with the right message and action for `src`. */
  const showFailure = (src: string): void => {
    const text = imageNodeMessages()
    const remote = isRemoteHttpSrc(src)
    errorMsg.textContent = remote ? text.remoteBlocked : text.loadFailed
    retryBtn.textContent = text.retry
    openBtn.textContent = text.openInBrowser
    if (remote) {
      retryBtn.setAttribute('hidden', '')
      openBtn.removeAttribute('hidden')
    } else {
      retryBtn.removeAttribute('hidden')
      openBtn.setAttribute('hidden', '')
    }
  }

  const applyFailed = (failed: boolean): void => {
    if (failed) {
      dom.setAttribute('data-failed', 'true')
      errorBox.removeAttribute('hidden')
    } else {
      dom.setAttribute('data-failed', 'false')
      errorBox.setAttribute('hidden', '')
    }
  }

  const render = (): void => {
    const src = String(node.attrs.src ?? '')
    const alt = String(node.attrs.alt ?? '')
    if (alt) img.setAttribute('alt', alt)
    else img.removeAttribute('alt')
    if (node.attrs.title) img.setAttribute('title', String(node.attrs.title))
    else img.removeAttribute('title')
    applyDims()
    const mine = ++version
    // a11y: expose the image role + the alt/aria label on the wrapper so screen
    // readers announce it even when the layout wraps it in a figure.
    dom.setAttribute('role', 'img')
    if (alt) dom.setAttribute('aria-label', alt)
    else dom.removeAttribute('aria-label')
    if (!src) {
      img.removeAttribute('src')
      applyFailed(true)
      errorMsg.textContent = imageNodeMessages().missingSource
      return
    }
    applyFailed(false)
    failedSrc = src
    // Paint the document src directly only when it is already displayable
    // (`http:`, `data:`, an absolute path) or when nothing will resolve it.
    //
    // A vault-relative path is NOT loadable: painting it fires an `error`
    // before the async resolver swaps in the real URL, and that failure latch
    // used to stay on screen over an image that had in fact loaded — the
    // "images fail on open, Retry fixes it" report. Waiting one IPC round trip
    // instead means the element is never pointed at a URL that cannot load.
    if (isSelfDisplayableSrc(src) || !hasImageResolver()) {
      expectedSrc = src
      img.setAttribute('src', src)
    } else {
      expectedSrc = null
      img.removeAttribute('src')
    }
    void resolveImageSrc(src).then((display) => {
      if (version !== mine) return
      expectedSrc = display
      // A same-path replacement can resolve to the same display URL. Removing
      // it first forces the webview to request the newly written bytes instead
      // of treating the unchanged URL as an already-loaded image.
      if (img.getAttribute('src') === display) img.removeAttribute('src')
      img.setAttribute('src', display)
    })
  }
  render()

  img.addEventListener('error', () => {
    if (version === 0) return
    const shown = img.getAttribute('src')
    if (!shown) return
    // Mirror the `load` guard: an error from a superseded src must not latch a
    // failure onto the src this node is actually waiting for.
    if (expectedSrc !== null && shown !== expectedSrc && !shown.startsWith(expectedSrc)) return
    applyFailed(true)
    showFailure(failedSrc ?? shown)
  })

  // The counterpart to `error`: the display URL arrives asynchronously, so a
  // placeholder src (or a transient failure) can be followed by a real success.
  // Without this the failure state could only be cleared by clicking Retry.
  img.addEventListener('load', () => {
    if (version === 0) return
    const shown = img.getAttribute('src')
    if (!shown) return
    // Only a load of the src this node currently expects counts: a late event
    // from a superseded src must not clear the present one's failure state.
    if (expectedSrc !== null && shown !== expectedSrc && !shown.startsWith(expectedSrc)) return
    applyFailed(false)
  })

  retryBtn.addEventListener('pointerdown', (e) => e.stopPropagation())
  retryBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!failedSrc) return
    applyFailed(false)
    const mine = ++version
    // Resolve afresh: a memoized failure (the first attempt can run before the
    // vault is authorized) would otherwise be replayed on every Retry.
    void resolveImageSrc(failedSrc, { refresh: true }).then((display) => {
      if (version !== mine) return
      // When resolution has nothing better to offer the src is already the
      // display URL, so bust the browser cache to force a real re-request.
      const next = display === failedSrc ? `${display}?retry=${Date.now()}` : display
      // Adopt it as the expected src, or the `load` handler would treat the
      // successfully retried image as a superseded one and keep the overlay.
      expectedSrc = next
      img.setAttribute('src', next)
    })
  })

  openBtn.addEventListener('pointerdown', (e) => e.stopPropagation())
  openBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!failedSrc) return
    window.open(failedSrc, '_blank', 'noopener,noreferrer')
  })

  // The resize handle plus the bottom-right corner of the image both initiate
  // a drag. The handle is the clear affordance; the corner keeps the legacy
  // behavior (and the existing drag test) working.
  //
  // The gesture itself lives in ./resize-drag-node, where the ratio rule is
  // (a Shift lock with no ratio to hold previews nothing and commits nothing);
  // this hands it the DOM the node view owns, and `applyDims` puts the element
  // back when a gesture ends without a commit.
  const startDrag = (event: PointerEvent): void => {
    if (!view || typeof getPos !== 'function') return
    startResizeDrag(event, { view, getPos, attrs: () => node.attrs, img, restore: applyDims })
  }

  handle.addEventListener('pointerdown', startDrag)
  img.addEventListener('pointerdown', startDrag)
  // Clicking the wrapper selects the node via the editor's selection; the
  // handle/error button must never bubble into a drag or a selection reset.
  handle.addEventListener('click', (e) => e.stopPropagation())
  img.addEventListener('click', (e) => e.stopPropagation())

  // A resolution that failed because its inputs were not ready yet (the vault
  // not authorized, the file mid-write) must not stay failed: a pending
  // invalidation re-runs it.
  const stopInvalidationWatch = onImageResolutionInvalidated(() => {
    if (version === 0) return
    const src = String(node.attrs.src ?? '')
    if (!src) return
    const mine = ++version
    void resolveImageSrc(src, { refresh: true }).then((display) => {
      if (version !== mine) return
      const current = img.getAttribute('src')
      const next = display === current && !/^(data|blob):/i.test(display)
        ? `${display}${display.includes('?') ? '&' : '?'}refresh=${Date.now()}`
        : display
      expectedSrc = next
      img.setAttribute('src', next)
    })
  })

  return {
    dom,
    ignoreMutation: () => true,
    selectNode: () => dom.setAttribute('data-selected', 'true'),
    deselectNode: () => dom.setAttribute('data-selected', 'false'),
    update: (newNode) => {
      if (newNode.type !== node.type) return false
      node = newNode
      render()
      return true
    },
    destroy: () => {
      // Bumping the version invalidates any in-flight resolve, and the
      // invalidation watch is dropped so a torn-down node view is not woken.
      version += 1
      stopInvalidationWatch()
    },
  }
}

// `imageDimSchema` is the extended preset [$Ctx, $Node] tuple; `.node` is the
// $Node that $view expects (its runtime check routes by NodeType instance).
export const imageNodeView = $view(imageDimSchema.node, () => makeImageNodeView)
