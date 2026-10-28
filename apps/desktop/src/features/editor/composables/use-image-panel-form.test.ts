import { afterEach, describe, expect, it } from 'vitest'
import { createApp, type App as VueApp } from 'vue'
import { NodeSelection } from '@milkdown/prose/state'
import { basicPlugins, createEditor, getSelectedImage } from '@nekowite/editor-core'
import type { NekoEditor } from '@nekowite/editor-core'
import ImagePanel from '../../../ui/ImagePanel.vue'

/**
 * The panel's dismissal contract, driven through the real editor.
 *
 * `dismiss` has two halves to keep in agreement — this form's `selected` and
 * the editor's own selection — and clearing only the first is invisible until
 * something makes the editor update again. That is what these tests do, because
 * it is what the app does on its own: unmounting the panel restores focus to
 * the editor, and ProseMirror's focus handler runs `updateState`, which runs
 * every plugin view, including the image-selection plugin.
 */

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

let mounted: VueApp[] = []
let editors: NekoEditor[] = []

afterEach(() => {
  mounted.forEach((app) => app.unmount())
  mounted = []
  editors.forEach((ed) => ed.destroy())
  editors = []
  document.body.innerHTML = ''
})

/** A note whose only content is an image, opened in a real editor. */
async function makeImageEditor(): Promise<{ editor: NekoEditor; pos: number }> {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const editor = createEditor(el, { plugins: basicPlugins })
  await editor.open('![img](attachments/a.png)')
  editors.push(editor)
  const view = editor.getView()
  let pos: number | null = null
  view.state.doc.descendants((n, p) => {
    if (n.type.name === 'image') {
      pos = p
      return false
    }
    return true
  })
  if (pos === null) throw new Error('no image node')
  return { editor, pos }
}

/** Select the image and mount the panel that answers it. */
async function openPanel(editor: NekoEditor, pos: number): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(ImagePanel, { editor })
  app.mount(host)
  mounted.push(app)
  const view = editor.getView()
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
  await flush()
  const panel = document.querySelector<HTMLElement>('.neko-image-panel')
  if (!panel) throw new Error('the panel did not open')
  return panel
}

function pressEscape(panel: HTMLElement): void {
  panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

describe('image panel dismissal', () => {
  it('Escape moves the editor off the image, not just the panel off the screen', async () => {
    const { editor, pos } = await makeImageEditor()
    const panel = await openPanel(editor, pos)

    pressEscape(panel)
    await flush()

    expect(document.querySelector('.neko-image-panel')).toBeNull()
    // The image itself is deselected: the outline and the resize handle go with
    // the panel, so the dismissal is not a panel-only illusion.
    expect(editor.getView().state.selection).not.toBeInstanceOf(NodeSelection)
  })

  it('the next editor update cannot re-open the panel it just closed', async () => {
    const { editor, pos } = await makeImageEditor()
    const panel = await openPanel(editor, pos)

    pressEscape(panel)
    await flush()

    // Exactly what the focus restore after the unmount does: run the plugin
    // views over the state that is already there. A live NodeSelection over
    // the image is re-emitted here, and the panel comes back with it.
    editor.getView().updateState(editor.getView().state)
    await flush()

    expect(getSelectedImage()).toBeNull()
    expect(document.querySelector('.neko-image-panel')).toBeNull()
  })

  it('refreshes the selected image without changing the note or its undo history', async () => {
    const { editor, pos } = await makeImageEditor()
    const panel = await openPanel(editor, pos)
    const before = editor.getView().state

    const refresh = panel.querySelector<HTMLButtonElement>('[data-test="refresh-image"]')
    expect(refresh).toBeTruthy()
    refresh!.click()
    await flush()

    expect(editor.getView().state.doc).toBe(before.doc)
    expect(editor.getView().state.selection).toBeInstanceOf(NodeSelection)
    expect(document.querySelector('.neko-image-panel')).toBeTruthy()
  })
})
