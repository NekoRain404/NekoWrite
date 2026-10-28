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
import type { NekoEditor } from '@nekowite/editor-core'
import { setActiveEditor } from '@nekowite/plugin-host'
import { guardEditorForPlugins } from '../../../services/plugin-editor-guard'
import { watch } from 'vue'
import { editorSessionManager } from '../session-manager'
import { setCalloutView } from '../../../plugins/callout'
import { createImageSrcResolver, isImagePath } from '../../attachments'
import { dirRelativeToVault, notePathRelativeToVault } from '../../notes'
import { getSharedGateways } from '../../../platform/runtime/gateway-runtime'
import type { FsChangeEvent } from '../../../platform/gateways/contracts'
import { useTabsStore } from '../../../stores/tabs'
import { useDocumentListStore } from '../../../stores/document-list'
import { useVaultSessionStore } from '../../../stores/vault-session'
import { resolveLinkPath as queryResolveLinkPath } from '../../vault/services/library-queries'
import { t } from '../../../i18n'
import type { DocumentSession } from '../model/document-session'

type EditorView = NonNullable<ReturnType<NekoEditor['getView']>>

export interface EditorControllerDeps {
  session: DocumentSession
  /** The editor mount element (inside the rendered pane). */
  getEditorEl: () => HTMLElement | null
  /** Test seam for the vault filesystem event stream used by image refresh. */
  onFsChange?: (cb: (event: FsChangeEvent) => void) => Promise<() => void>
}

export interface EditorController {
  /** Create the Milkdown editor, register it with the bridge and configure the
   *  image resolver / heading-anchor URL / wikilink handlers. No-op if the
   *  mount element is missing. */
  mount(): void
  /** Tear down decorators, the bridge and the ProseMirror view. Idempotent. */
  destroy(): void
  getEditor(): NekoEditor | null
  getView(): EditorView | null
}

/**
 * Owns the editor instance lifecycle and the platform wiring that depends on
 * the live tab (image resolution, heading deep-link, wikilink open). Exposes
 * the editor through commands only — callers never reach the ProseMirror
 * `${EditorView}` directly, which keeps the bridge the single access point.
 */
export function createEditorController(deps: EditorControllerDeps): EditorController {
  const tabs = useTabsStore()
  const documentList = useDocumentListStore()
  const vaultSession = useVaultSessionStore()
  let registeredTabId: string | null = null
  let stopImageWatch: (() => void) | null = null
  let imageWatchGeneration = 0

  // The pane can mount before the first tab opens (a later openTab fires the
  // activeId watch), so the editor is registered under a placeholder tab id and
  // re-keyed as tabs activate. getActiveEditor() falls back to the sole live
  // session when the active tab has not claimed its own yet.
  const PLACEHOLDER_TAB = '__editor-controller-session__'

  // Re-key the active session whenever the user switches tabs so a panel that
  // resolves the "active editor" follows the tab that is actually shown. The
  // pane reuses a single editor instance, so activating a tab without its own
  // session falls back to that live editor (see sessionManager).
  const stopActivationWatch = watch(
    () => tabs.activeId,
    (id) => {
      if (id) editorSessionManager.activateSession(id)
    },
  )

  function mount(): void {
    const el = deps.getEditorEl()
    if (!el) return
    const editor = createEditor(el, { plugins: basicPlugins })
    deps.session.editor = editor
    // Register the editor — for the active tab, or a placeholder when the pane
    // mounted before any tab was opened — and mark it active.
    const tabId = tabs.activeId ?? PLACEHOLDER_TAB
    registeredTabId = tabId
    editorSessionManager.createSession(tabId, () => editor)
    // Plugins get the guarded handle, never the raw editor: a plugin that
    // declares nothing must not be able to rewrite the document behind the
    // write policy the user chose (see services/pluginEditorGuard).
    // The handle is shared by every plugin, so the prompt cannot name which one
    // is writing - it says "a plugin" rather than inventing a name.
    setActiveEditor(guardEditorForPlugins(editor, { pluginName: t('plugin.genericName') }))
    configureImageResolver(
      createImageSrcResolver(getSharedGateways().fs, {
        getVault: () => tabs.vault,
        getNotePath: () => tabs.activeTab?.path ?? null,
      }),
      // The resolver above turns a relative src into a display URL using the
      // CURRENT note, so `pic.png` means a different file in every directory.
      // Keying the resolution memo on the src alone served the previous note's
      // picture after a tab switch; the scope token makes the memo follow the
      // vault + note it was produced for.
      { scope: () => JSON.stringify([tabs.vault, tabs.activeTab?.path ?? null]) },
    )
    const watchGeneration = ++imageWatchGeneration
    const onFsChange = deps.onFsChange ?? ((cb) => getSharedGateways().fs.onFsChange(cb))
    void onFsChange((event) => {
      if (watchGeneration !== imageWatchGeneration) return
      const vault = tabs.vault?.replace(/[\\/]+$/, '')
      if (!vault) return
      const changedPath = event.path.replace(/\\/g, '/')
      const root = vault.replace(/\\/g, '/')
      if (changedPath !== root && !changedPath.startsWith(`${root}/`)) return
      if (event.kind === 'resync' || isImagePath(changedPath)) {
        invalidateImageResolution()
      }
    }).then((off) => {
      if (watchGeneration !== imageWatchGeneration) off()
      else stopImageWatch = off
    }).catch(() => {
      // The vault index owns the user-facing watcher health state. Image refresh
      // is best-effort and must not prevent the editor itself from mounting.
    })
    // editor-core is i18n-free, so its image failure copy defaults to English.
    // Install the app's strings (including the honest "blocked by the security
    // policy" wording for a remote image the CSP refuses) at mount time.
    configureImageNodeMessages({
      retry: t('imageNode.retry'),
      missingSource: t('imageNode.missingSource'),
      loadFailed: t('imageNode.loadFailed'),
      remoteBlocked: t('imageNode.remoteBlocked'),
      openInBrowser: t('imageNode.openInBrowser'),
    })
    // Heading anchors copy a deep-link fragment. Prefer the note's vault-relative
    // path so the link is resolvable from anywhere; fall back to a bare fragment
    // for unsaved docs. Reads live tab state at click time.
    configureHeadingAnchorUrl((slug) => {
      const path = tabs.activeTab?.path
      const vault = tabs.vault
      if (!path || !vault) return `#${slug}`
      // Normalise first: `path` may already include the vault prefix, and
      // joining it as-is duplicated the vault in every copied link.
      return `${vault.replace(/\/+$/, '')}/${notePathRelativeToVault(path, vault)}#${slug}`
    })
    // Ctrl/Cmd+click on a [[wikilink]] chip opens the target note. Resolve the
    // wiki target against the current note's vault-relative directory using the
    // library index (same resolution as the backlinks/links panels).
    configureWikilinkHandler((target) => {
      const path = tabs.activeTab?.path
      const vault = tabs.vault
      if (!path || !vault) return
      const relDir = dirRelativeToVault(path, vault)
      const resolved = queryResolveLinkPath(documentList.notes, vaultSession.vault, relDir, target)
      if (resolved) void tabs.openTab(resolved)
    })
  }

  function destroy(): void {
    imageWatchGeneration += 1
    stopImageWatch?.()
    stopImageWatch = null
    deps.session.editor = null
    // Order matters: detach the decorators/resolvers and the plugin-view callback
    // before destroying the ProseMirror view so a destroyed view is never re-wired.
    setCalloutView(null)
    clearImageSelection()
    configureImageResolver(null)
    configureImageNodeMessages(null)
    configureHeadingAnchorUrl(null)
    configureWikilinkHandler(null)
    // Tear down this controller's session — `destroySession` is the single owner
    // of the editor instance's `destroy()`, so the controller never calls
    // `editor?.destroy()` itself (that would destroy the same instance twice). If
    // a later controller has since claimed the tab (e.g. a re-mount after the
    // pane re-opens), destroySession only removes its own entry — it never clobbers
    // another registration.
    if (registeredTabId) editorSessionManager.destroySession(registeredTabId)
    registeredTabId = null
    stopActivationWatch()
    setActiveEditor(null)
  }

  function getView(): EditorView | null {
    const editor = deps.session.editor
    if (!editor) return null
    try {
      return editor.getView()
    } catch {
      return null
    }
  }

  return { mount, destroy, getEditor: () => deps.session.editor, getView }
}
