import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { NekoEditor } from '@nekowite/editor-core'
import {
  basicPlugins,
  clearImageSelection,
  configureHeadingAnchorUrl,
  configureImageNodeMessages,
  configureImageResolver,
  configureWikilinkHandler,
  createEditor,
  invalidateImageResolution,
} from '@nekowite/editor-core'
import { setCalloutView } from '../../../plugins/callout'
import { editorSessionManager } from '../session-manager'
import { useTabsStore } from '../../../stores/tabs'
import { createDocumentSession, type DocumentSession } from '../model/document-session'
import { createEditorController } from './editor-controller'

vi.mock('@nekowite/editor-core', () => {
  const makeEditor = () => ({
    getView: () => null,
    save: vi.fn().mockResolvedValue('# x'),
    onContentChange: vi.fn(() => () => {}),
    destroy: vi.fn(),
    open: vi.fn(),
    insertMarkdownAtCursor: vi.fn(),
  })
  return {
    createEditor: vi.fn(() => makeEditor()),
    basicPlugins: [],
    configureImageResolver: vi.fn(),
    invalidateImageResolution: vi.fn(),
    configureImageNodeMessages: vi.fn(),
    configureHeadingAnchorUrl: vi.fn(),
    configureWikilinkHandler: vi.fn(),
    clearImageSelection: vi.fn(),
  }
})

vi.mock('../../attachments', () => ({
  createImageSrcResolver: vi.fn(() => vi.fn()),
  isImagePath: (path: string) => /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(path),
}))
vi.mock('../../../plugins/callout', () => ({ setCalloutView: vi.fn() }))

describe('editorController', () => {
  let session: DocumentSession

  beforeEach(() => {
    const pinia = createPinia()
    setActivePinia(pinia)
    session = createDocumentSession()
    // Tear down any session a prior case left behind (module singleton).
    editorSessionManager.destroyAll()
    vi.mocked(createEditor).mockClear()
    vi.mocked(configureImageResolver).mockClear()
    vi.mocked(configureImageNodeMessages).mockClear()
    vi.mocked(configureHeadingAnchorUrl).mockClear()
    vi.mocked(configureWikilinkHandler).mockClear()
    vi.mocked(clearImageSelection).mockClear()
    vi.mocked(setCalloutView).mockClear()
    // The pane only mounts when a tab is open; give the controller an active
    // tab so its session is registered and promoted.
    useTabsStore().setActive('tab-1')
  })

  it('mount() creates the editor and registers a session for the active tab', () => {
    const host = document.createElement('div')
    const controller = createEditorController({ session, getEditorEl: () => host })
    controller.mount()
    expect(createEditor).toHaveBeenCalledWith(host, { plugins: basicPlugins })
    expect(session.editor).toBeTruthy()
    expect(editorSessionManager.getSession('tab-1')).toBe(session.editor)
    expect(editorSessionManager.getActiveEditor()).toBe(session.editor)
    expect(configureImageResolver).toHaveBeenCalled()
    // The image node view's failure copy is installed here, so the toolbar and
    // the editor speak the same language.
    expect(configureImageNodeMessages).toHaveBeenCalled()
    expect(configureHeadingAnchorUrl).toHaveBeenCalled()
    expect(configureWikilinkHandler).toHaveBeenCalled()
  })

  it('destroy() tears down the view, session and decorators', () => {
    const host = document.createElement('div')
    const controller = createEditorController({ session, getEditorEl: () => host })
    controller.mount()
    const editor = session.editor as NekoEditor
    controller.destroy()
    expect(setCalloutView).toHaveBeenCalledWith(null)
    expect(clearImageSelection).toHaveBeenCalled()
    expect(configureImageResolver).toHaveBeenLastCalledWith(null)
    expect(configureImageNodeMessages).toHaveBeenLastCalledWith(null)
    expect(configureHeadingAnchorUrl).toHaveBeenLastCalledWith(null)
    expect(configureWikilinkHandler).toHaveBeenLastCalledWith(null)
    expect(session.editor).toBeNull()
    expect(editorSessionManager.getSession('tab-1')).toBeNull()
    expect(editorSessionManager.getActiveEditor()).toBeNull()
    expect(editor.destroy).toHaveBeenCalled()
    // The session manager is the single owner of the editor's destroy — the
    // controller never destroys the same instance a second time.
    expect(editor.destroy).toHaveBeenCalledTimes(1)
  })

  it('keys the image-resolution memo on the vault and the active note', () => {
    const tabs = useTabsStore()
    tabs.setVault('/vault')
    const tab = (id: string, path: string) => ({
      id,
      path,
      content: '',
      savedContent: '',
      dirty: false,
      pendingAssetPaths: [],
    })
    tabs.tabs.push(tab('tab-1', '/vault/a/note.md'))
    tabs.setActive('tab-1')

    const host = document.createElement('div')
    const controller = createEditorController({ session, getEditorEl: () => host })
    controller.mount()

    // The resolver reads the CURRENT note, so the memo has to be scoped to it:
    // keyed on the src alone, the same relative `pic.png` kept resolving to the
    // previous note's file after a tab switch.
    const options = vi.mocked(configureImageResolver).mock.calls[0]?.[1] as
      | { scope?: () => string }
      | undefined
    expect(typeof options?.scope).toBe('function')

    const scopeA = options!.scope!()
    tabs.tabs.push(tab('tab-2', '/vault/b/note.md'))
    tabs.setActive('tab-2')
    const scopeB = options!.scope!()
    expect(scopeA).not.toBe(scopeB)

    // Within one note the token is stable, so the memo still hits.
    expect(options!.scope!()).toBe(scopeB)
  })

  it('automatically refreshes image URLs when a vault image changes', async () => {
    useTabsStore().setVault('/vault')
    let onChange: ((event: { path: string; kind: 'created' | 'modified' | 'removed' | 'resync' }) => void) | undefined
    const onFsChange = vi.fn(async (listener: typeof onChange) => {
      onChange = listener
      return () => { onChange = undefined }
    })
    const host = document.createElement('div')
    const controller = createEditorController({ session, getEditorEl: () => host, onFsChange })
    controller.mount()
    await Promise.resolve()
    await Promise.resolve()
    vi.mocked(invalidateImageResolution).mockClear()

    onChange?.({ path: '/vault/attachments/diagram.svg', kind: 'modified' })
    expect(invalidateImageResolution).toHaveBeenCalledTimes(1)
    onChange?.({ path: '/vault/notes/note.md', kind: 'modified' })
    expect(invalidateImageResolution).toHaveBeenCalledTimes(1)

    controller.destroy()
    expect(onChange).toBeUndefined()
  })

  it('ignores a late filesystem callback after the editor was destroyed', async () => {
    useTabsStore().setVault('/vault')
    let onChange: ((event: { path: string; kind: 'created' | 'modified' | 'removed' | 'resync' }) => void) | undefined
    let resolveSubscription: ((off: () => void) => void) | undefined
    const off = vi.fn()
    const onFsChange = vi.fn((listener: typeof onChange) => {
      onChange = listener
      return new Promise<() => void>((resolve) => { resolveSubscription = resolve })
    })
    const controller = createEditorController({ session, getEditorEl: () => document.createElement('div'), onFsChange })
    controller.mount()
    controller.destroy()
    resolveSubscription?.(off)
    await Promise.resolve()
    vi.mocked(invalidateImageResolution).mockClear()

    onChange?.({ path: '/vault/image.png', kind: 'modified' })

    expect(off).toHaveBeenCalledOnce()
    expect(invalidateImageResolution).not.toHaveBeenCalled()
  })
})
