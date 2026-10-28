import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import { NodeSelection, TextSelection } from '@milkdown/prose/state'
import {
  clearImageSelection,
  deleteImageNode,
  getImageAttrs,
  invalidateImageResolution,
  onImageSelectionChange,
  restoreImageSize,
  updateImageAttrs,
} from '@nekowite/editor-core'
import type { ImagePatch, ImageSelectionState, NekoEditor } from '@nekowite/editor-core'
import {
  displaySize,
  intrinsicSize,
  lockRatio,
  pairForHeight,
  pairForWidth,
} from '../model/image-panel-metrics'
import type { PanelSize, PanelSizePair } from '../model/image-panel-metrics'

/**
 * The image property panel's form: which image it is editing, what that image
 * says, and the writes back to it.
 *
 * The component that renders the panel is wiring and markup; this is the half
 * that has to be right, and it is the half that cannot be reasoned about by
 * looking at a mounted component:
 *
 * - **Every write is ONE transaction** (§ the attrs module in editor-core), so a
 *   field edit and a locked resize are each a single undo step.
 * - **A write is not allowed to close the panel it came from.** `setNodeMarkup`
 *   on a leaf is a same-size replace AT the NodeSelection anchor, and
 *   ProseMirror maps the anchor boundary of such a replace as "deleted" — the
 *   selection is remapped to a text caret, the image-selection plugin emits
 *   null, and the panel would shut itself after the first character typed. The
 *   repair is `reselectImage` after every write.
 * - **Populating the form never writes.** `syncing` is the guard the watchers
 *   honour; without it the initial population would re-patch the node with the
 *   values it just read and burn an undo step opening the panel.
 */
export interface ImagePanelFormOptions {
  /** The live editor, or null before the rendered pane has one. */
  getEditor: () => NekoEditor | null
}

export interface ImagePanelForm {
  /** The selected image, or null: the panel's subject and its visibility. */
  selected: Ref<ImageSelectionState | null>
  visible: ComputedRef<boolean>
  alt: Ref<string>
  title: Ref<string>
  link: Ref<string>
  width: Ref<string>
  height: Ref<string>
  align: Ref<string>
  /** The resize lock: while it is on, an edit to either half of the size writes
   *  the other half in the SAME patch, so the image keeps its shape and the
   *  edit stays one undo step. */
  locked: Ref<boolean>
  /** True when there is a ratio for the lock to hold — false disables the
   *  control rather than letting it promise something it cannot do. */
  lockAvailable: ComputedRef<boolean>
  /** The file's own pixels, or null while they are not known (see `syncNatural`). */
  natural: Ref<PanelSize | null>
  /** The size the image is actually drawn at, or null when that is not known. */
  shownSize: ComputedRef<PanelSizePair | null>
  restore: () => void
  replace: () => void
  remove: () => void
  /** Force the selected image's resolved display URL to load again. */
  refreshImage: () => void
  /** Re-read the node (and the image's own pixels) into the form. */
  syncFromNode: () => void
  dismiss: () => void
}

export function useImagePanelForm(options: ImagePanelFormOptions): ImagePanelForm {
  const selected = ref<ImageSelectionState | null>(null)
  const alt = ref('')
  const title = ref('')
  const link = ref('')
  const width = ref('')
  const height = ref('')
  const locked = ref(false)
  // `'left'`, not `''`: the control is a SelectMenu, which shows the option
  // matching its value and nothing when none does. An empty value is only ever
  // reachable before the first sync, and a blank control in that window reads as
  // a bug rather than as "unset".
  const align = ref('left')
  const natural = ref<PanelSize | null>(null)

  const visible = computed(() => selected.value !== null)
  const numeric = (value: string): number | null => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const widthNum = computed(() => numeric(width.value))
  const heightNum = computed(() => numeric(height.value))
  const ratio = computed(() => lockRatio(widthNum.value, heightNum.value, natural.value))
  const lockAvailable = computed(() => ratio.value !== null)
  const shownSize = computed(() => displaySize(widthNum.value, heightNum.value, natural.value))

  let unlisten: (() => void) | null = null
  let naturalRev = 0
  // True while populating the form from the node; the watchers skip during sync
  // so selecting an image never emits a spurious (no-change) transaction/undo
  // step.
  let syncing = false

  function currentAttrs(): ReturnType<typeof getImageAttrs> {
    const sel = selected.value
    const editor = options.getEditor()
    if (!sel || !editor) return null
    return getImageAttrs(editor.getView(), sel.pos)
  }

  /** The node view's own `<img>` for `pos` — the element that knows the file's
   *  pixels, because it is the one the resolver pointed at a loadable URL. */
  function imgFor(pos: number): HTMLImageElement | null {
    const editor = options.getEditor()
    if (!editor) return null
    try {
      const dom = editor.getView().nodeDOM(pos)
      return dom instanceof HTMLElement ? dom.querySelector('img') : null
    } catch {
      return null
    }
  }

  /**
   * The file's own pixels, read from the image the node view has already
   * resolved and loaded.
   *
   * The panel used to probe `attrs.src` with an `Image()` of its own, and that
   * is why 原始尺寸 read `—` for every real image: the document keeps the
   * vault-relative src (unloadable in the webview), while only the node view's
   * element carries the resolved display URL. The ratio a proportional resize
   * needs went with the dash. This waits on the node view's own request instead
   * of starting a second one, and reports "not known yet" rather than guessing.
   */
  function syncNatural(pos: number, waitForReload = false): void {
    const rev = ++naturalRev
    natural.value = null
    const img = imgFor(pos)
    if (!img) return
    const read = (): void => {
      if (rev !== naturalRev) return
      natural.value = intrinsicSize(img)
    }
    if (!waitForReload) read()
    // A forced refresh may replace bytes at the same path. Ignore the old
    // element dimensions until the cache-busted request finishes.
    if (waitForReload || natural.value === null) img.addEventListener('load', read, { once: true })
  }

  function syncFromNode(): void {
    const sel = selected.value
    const editor = options.getEditor()
    if (!sel || !editor) return
    const attrs = getImageAttrs(editor.getView(), sel.pos)
    if (!attrs) return
    syncing = true
    alt.value = attrs.alt ?? ''
    title.value = attrs.title ?? ''
    link.value = attrs.src ?? ''
    width.value = attrs.width != null ? String(attrs.width) : ''
    height.value = attrs.height != null ? String(attrs.height) : ''
    align.value = attrs.align ?? 'left'
    syncing = false
    syncNatural(sel.pos)
  }

  /**
   * `updateImageAttrs` writes the new attrs with a `setNodeMarkup` transaction.
   * On a leaf node that is a ReplaceStep at the selection anchor, and
   * ProseMirror's mapping treats the anchor boundary of such a replace as
   * "deleted" — so the NodeSelection is remapped to a text caret, the image
   * selection plugin emits null, and the panel would close itself after every
   * single field edit (typing one character in Alt would dismiss the panel;
   * a multi-field edit was impossible). Restoring the NodeSelection with a
   * selection-only transaction (no doc change, no undo step) keeps the panel
   * open across a series of edits. The same repair belongs in editor-core's
   * attribute writers — this panel-level repair is the contract the UI needs.
   */
  function reselectImage(view: ReturnType<NekoEditor['getView']>, pos: number): void {
    const node = view.state.doc.nodeAt(pos)
    if (!node || node.type.name !== 'image') return
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
  }

  /**
   * The shape below is `ImagePatch` — the attribute set `updateImageAttrs`
   * actually takes — and not `Record<string, unknown>`. The loose record is
   * what this call site used to be typed as, and it was a lie that cost a cast
   * (`p as never`) to keep: it erased the one contract worth checking here,
   * that every patch names an attribute the image schema has.
   */
  const patch = (p: ImagePatch): void => {
    const sel = selected.value
    const editor = options.getEditor()
    if (!sel || !editor || syncing) return
    const view = editor.getView()
    updateImageAttrs(view, sel.pos, p)
    reselectImage(view, sel.pos)
  }

  /**
   * The patch for one half of the size, with the lock applied.
   *
   * Locked, the other half is written in the same object — one `setNodeMarkup`,
   * one undo step — and clearing either field clears BOTH, because a locked
   * pair with one half missing is not the shape the reader asked to keep.
   */
  function sizePatch(side: 'width' | 'height', value: number | null): ImagePatch {
    const r = ratio.value
    if (!locked.value || r === null) return side === 'width' ? { width: value } : { height: value }
    if (value === null) return { width: null, height: null }
    return side === 'width' ? pairForWidth(r, value) : pairForHeight(r, value)
  }

  /**
   * Show a patch's own numbers in the fields without re-patching the node.
   *
   * The guard is saved and restored rather than cleared: this can run inside
   * `syncFromNode`'s own guarded region, and a nested write must not lift the
   * guard the outer population is holding — that would dispatch the no-change
   * transaction the guard exists to prevent.
   */
  function mirror(p: ImagePatch): void {
    const was = syncing
    syncing = true
    for (const [field, value] of [
      [width, p.width],
      [height, p.height],
    ] as Array<[Ref<string>, unknown]>) {
      if (value === undefined) continue
      field.value = value === null ? '' : String(value)
    }
    syncing = was
  }

  // `flush: 'sync'` is essential: without it Vue fires these watchers
  // asynchronously, AFTER `syncFromNode()` has already reset the `syncing`
  // guard, so the initial field population would re-patch the node with
  // identical values and dispatch a spurious no-change transaction — resetting
  // the NodeSelection and closing the panel the moment it opens. Synchronous
  // flush runs the watcher while `syncing` is still true, so the guard is
  // honored.
  watch(align, (v) => {
    if (!visible.value) return
    patch({ align: v === 'left' || v === 'center' || v === 'right' ? v : null })
  }, { flush: 'sync' })
  watch(width, (v) => {
    if (!visible.value) return
    const p = sizePatch('width', numeric(v))
    mirror(p)
    patch(p)
  }, { flush: 'sync' })
  watch(height, (v) => {
    if (!visible.value) return
    const p = sizePatch('height', numeric(v))
    mirror(p)
    patch(p)
  }, { flush: 'sync' })
  watch(alt, (v) => {
    if (!visible.value) return
    patch({ alt: v })
  }, { flush: 'sync' })
  watch(title, (v) => {
    if (!visible.value) return
    patch({ title: v })
  }, { flush: 'sync' })
  watch(link, (v) => {
    if (!visible.value) return
    const attrs = currentAttrs()
    if (attrs && v !== attrs.src) patch({ src: v })
  }, { flush: 'sync' })

  function onRestore(): void {
    const sel = selected.value
    const editor = options.getEditor()
    if (!sel || !editor) return
    const view = editor.getView()
    restoreImageSize(view, sel.pos)
    reselectImage(view, sel.pos)
    // The fields are cleared under the guard: a plain assignment would fire the
    // size watchers and write a SECOND transaction, making Restore undo in two
    // steps instead of one.
    const was = syncing
    syncing = true
    width.value = ''
    height.value = ''
    syncing = was
    syncFromNode()
  }

  function onReplace(): void {
    const sel = selected.value
    const editor = options.getEditor()
    if (!sel || !editor) return
    const view = editor.getView()
    const src = link.value.trim()
    if (src) {
      // Replacing a file at the same vault path must invalidate the display
      // URL memo; otherwise the node keeps showing the previous file bytes.
      invalidateImageResolution()
      updateImageAttrs(view, sel.pos, { src })
      reselectImage(view, sel.pos)
    }
  }

  function onDelete(): void {
    const sel = selected.value
    const editor = options.getEditor()
    if (!sel || !editor) return
    deleteImageNode(editor.getView(), sel.pos)
    selected.value = null
  }

  function onRefreshImage(): void {
    const pos = selected.value?.pos
    if (pos === undefined) return
    syncNatural(pos, true)
    invalidateImageResolution()
  }

  /**
   * Close the panel because the reader asked it to (Escape), rather than
   * because the selection went away on its own.
   *
   * `clearImageSelection` resets the tracker and leaves the editor holding a
   * live `NodeSelection` over the image, so the plugin re-emits it on its next
   * update and the panel comes straight back — the focus restore that follows
   * the unmount runs ProseMirror's `updateState`, and any later transaction
   * does it too. Moving the selection off the image first is what makes the
   * dismissal stick, and what the reader sees: the outline and the resize
   * handle go with the panel. `emit`'s identity guard cannot cover this — the
   * clear is exactly what bypasses it.
   */
  function dismiss(): void {
    const editor = options.getEditor()
    const view = editor?.getView()
    const sel = view?.state.selection
    if (view && sel instanceof NodeSelection) {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(sel.$from, -1)))
    }
    clearImageSelection()
  }

  const onSelection = (info: ImageSelectionState | null): void => {
    if (info && options.getEditor()) {
      selected.value = info
      syncFromNode()
    } else {
      selected.value = null
      natural.value = null
    }
  }

  // Subscribed once at setup; the module-level listener set dedups.
  unlisten = onImageSelectionChange(onSelection)

  // The watch on the editor prop lives in the component: it is the one thing
  // here that follows a prop rather than the editor's own state.
  onBeforeUnmount(() => {
    naturalRev += 1
    unlisten?.()
    unlisten = null
  })

  return {
    selected,
    visible,
    alt,
    title,
    link,
    width,
    height,
    align,
    locked,
    lockAvailable,
    natural,
    shownSize,
    restore: onRestore,
    replace: onReplace,
    remove: onDelete,
    refreshImage: onRefreshImage,
    syncFromNode,
    dismiss,
  }
}
