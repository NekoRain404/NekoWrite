<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { NekoEditor } from '@nekowite/editor-core'
import { useFocusTrap } from '../composables/use-focus-trap'
import { useImagePanelAnchor, useImagePanelForm } from '../features/editor'
import { t } from '../i18n'
import { isComposingKey } from '../services/key-guard'
import SelectMenu from '../components/SelectMenu.vue'

const props = defineProps<{ editor: NekoEditor | null }>()

// The form is the feature's (its selection subscription, the one-transaction
// writes, the lock); this component is its wiring and its markup.
const form = useImagePanelForm({ getEditor: () => props.editor })
const { alt, title, link, width, height, align, locked, lockAvailable, natural, shownSize, visible, refreshImage } =
  form

/** The three alignments the editor's schema understands (see the `patch` call
 *  the form's `align` watcher makes, which is what rejects anything else). */
const alignOptions = computed(() => [
  { value: 'left', label: t('imagePanel.alignLeft') },
  { value: 'center', label: t('imagePanel.alignCenter') },
  { value: 'right', label: t('imagePanel.alignRight') },
])

// Where the panel goes: next to the image it edits, inside its own pane,
// recomputed as coordinates only (§ the anchor composable). It used to be
// `absolute; top: 0` in the column's stylesheet — the top of the DOCUMENT,
// which on any note longer than a screen is nowhere near the selected image.
const anchor = useImagePanelAnchor({
  getEditor: () => props.editor,
  pos: computed(() => form.selected.value?.pos ?? null),
})
const panelStyle = computed(() => ({
  top: `${anchor.top.value}px`,
  left: `${anchor.left.value}px`,
}))

/** `auto` is the panel's word for "no number is stored" — the half the browser
 *  works out for itself. A dash is the word for "not known at all". */
const half = (n: number | null): string => (n === null ? t('imagePanel.auto') : String(n))
const currentSizeText = computed(() => {
  const size = shownSize.value
  return size ? `${half(size.width)}×${half(size.height)}` : '—'
})
const originalSizeText = computed(() =>
  natural.value ? `${natural.value.width}×${natural.value.height}` : '—',
)

const panelEl = ref<HTMLElement | null>(null)

// Non-modal property panel focus management (reuses the app's focus-trap
// pattern, same as the ConflictDialog): on open, focus moves to the first
// focusable field (the Alt input); Tab / Shift+Tab cycle inside; on close
// (Escape or a deselection), focus returns to whatever had it before — typically
// the editor. It stays non-modal (`aria-modal="false"`) but is focus-contained
// only while it is open so a keyboard user can edit an image without a mouse.
useFocusTrap(panelEl, visible)

// The panel is placed from its own measured box, and that box only exists once
// it has been painted: `measure` reads it and re-places synchronously.
watch(panelEl, (el) => anchor.measure(el))

// A different editor on the same selection (a tab switch) re-reads the node.
watch(
  () => props.editor,
  () => {
    if (form.selected.value) form.syncFromNode()
  },
)

function onKeydown(e: KeyboardEvent): void {
  // Escape dismisses the IME candidate list first; the panel has inputs.
  if (isComposingKey(e)) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    form.dismiss()
  }
}
</script>

<template>
  <div
    v-if="visible"
    ref="panelEl"
    class="neko-image-panel"
    :style="panelStyle"
    role="dialog"
    aria-modal="false"
    :aria-label="t('imagePanel.aria')"
    @pointerdown.stop
    @click.stop
    @keydown="onKeydown"
  >
    <div class="neko-image-panel-title">
      {{ t('imagePanel.title') }}
    </div>

    <label
      class="neko-image-field"
      for="neko-image-alt"
    >
      <span class="neko-image-field-label">{{ t('imagePanel.alt') }}</span>
      <input
        id="neko-image-alt"
        v-model="alt"
        type="text"
        class="neko-image-input"
      >
    </label>

    <label
      class="neko-image-field"
      for="neko-image-title"
    >
      <span class="neko-image-field-label">{{ t('imagePanel.titleField') }}</span>
      <input
        id="neko-image-title"
        v-model="title"
        type="text"
        class="neko-image-input"
      >
    </label>

    <label
      class="neko-image-field"
      for="neko-image-link"
    >
      <span class="neko-image-field-label">{{ t('imagePanel.link') }}</span>
      <input
        id="neko-image-link"
        v-model="link"
        type="text"
        class="neko-image-input"
      >
    </label>

    <div class="neko-image-row">
      <label
        class="neko-image-field neko-image-width"
        for="neko-image-width"
      >
        <span class="neko-image-field-label">{{ t('imagePanel.width') }}</span>
        <input
          id="neko-image-width"
          v-model="width"
          type="number"
          min="1"
          class="neko-image-input"
        >
      </label>
      <label
        class="neko-image-field neko-image-width"
        for="neko-image-height"
      >
        <span class="neko-image-field-label">{{ t('imagePanel.height') }}</span>
        <input
          id="neko-image-height"
          v-model="height"
          type="number"
          min="1"
          class="neko-image-input"
        >
      </label>
    </div>

    <div class="neko-image-row">
      <label
        class="neko-image-field neko-image-align"
        for="neko-image-align"
      >
        <span class="neko-image-field-label">{{ t('imagePanel.align') }}</span>
        <SelectMenu
          id="neko-image-align"
          v-model="align"
          class="neko-image-input"
          :options="alignOptions"
        />
      </label>
    </div>

    <!-- The lock holds the width/height pair together. It is disabled rather
         than hidden when there is no ratio to hold (neither attribute set and
         the file's own size not known yet), because a control that silently
         does nothing reads as broken. -->
    <label
      class="neko-image-lock"
      for="neko-image-lock"
      :title="lockAvailable ? undefined : t('imagePanel.lockUnavailable')"
    >
      <input
        id="neko-image-lock"
        v-model="locked"
        type="checkbox"
        :disabled="!lockAvailable"
      >
      <span>{{ t('imagePanel.lockRatio') }}</span>
    </label>

    <div class="neko-image-size">
      <div class="neko-image-size-line">
        <span class="neko-image-field-label">{{ t('imagePanel.currentSize') }}</span>
        <span class="neko-image-size-value">
          {{ currentSizeText }}
        </span>
      </div>
      <div class="neko-image-size-line">
        <span class="neko-image-field-label">{{ t('imagePanel.originalSize') }}</span>
        <span
          class="neko-image-size-value"
          :title="natural ? undefined : t('imagePanel.originalUnknown')"
        >
          {{ originalSizeText }}
        </span>
      </div>
    </div>

    <div class="neko-image-actions">
      <button
        type="button"
        class="neko-image-btn"
        data-test="refresh-image"
        @click="refreshImage"
      >
        {{ t('imagePanel.refresh') }}
      </button>
      <button
        type="button"
        class="neko-image-btn"
        @click="form.restore"
      >
        {{ t('imagePanel.restoreSize') }}
      </button>
      <button
        type="button"
        class="neko-image-btn"
        @click="form.replace"
      >
        {{ t('imagePanel.replace') }}
      </button>
      <button
        type="button"
        class="neko-image-btn neko-image-btn-danger"
        @click="form.remove"
      >
        {{ t('imagePanel.delete') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.neko-image-panel {
  /* Fixed, because the placement is in viewport coordinates and the pane it is
     clamped to scrolls underneath it — the same contract the table toolbar
     holds. Never `absolute` at the column's top: that is where this panel used
     to open, a screen away from the image being edited. No transition sits on
     the follow: a panel that eases across the pane reads as lag on the thing
     the pointer is holding. */
  position: fixed;
  z-index: 40;
  width: min(360px, calc(100vw - 16px));
  max-width: calc(100vw - 16px);
  box-sizing: border-box;
  padding: 10px 12px;
  background: var(--app-elevated);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-md);
  box-shadow: 0 8px 28px color-mix(in srgb, var(--app-text) 16%, transparent);
  font-family: var(--app-font);
  font-size: 12px;
}
.neko-image-panel-title {
  margin-bottom: 8px;
  font-weight: 650;
  color: var(--app-text);
}
.neko-image-field {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.neko-image-field-label {
  flex: none;
  width: 64px;
  color: var(--app-muted);
  font-size: 11px;
}
.neko-image-input {
  flex: 1;
  width: 0;
  min-width: 0;
  box-sizing: border-box;
  padding: 4px 6px;
  border: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
  border-radius: var(--app-radius-sm);
  background: var(--app-canvas);
  color: var(--app-text);
  font-family: var(--app-font);
  font-size: 12px;
}
.neko-image-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
}
.neko-image-width {
  min-width: 0;
}
.neko-image-align {
  min-width: 0;
}
.neko-image-row .neko-image-field-label {
  width: 44px;
}
.neko-image-lock {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  color: var(--app-muted);
  font-size: 11px;
  cursor: pointer;
}
.neko-image-lock input:disabled {
  cursor: default;
}
/* The disabled control and its label dim together: a box that stayed at full
   strength while its label greyed out reads as two different states. */
.neko-image-lock:has(input:disabled) {
  opacity: 0.6;
  cursor: default;
}
.neko-image-size {
  margin: 8px 0;
  padding: 6px 0;
  border-top: 1px solid color-mix(in srgb, var(--app-border) 60%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--app-border) 60%, transparent);
}
.neko-image-size-line {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}
.neko-image-size-value {
  color: var(--app-text);
  font-variant-numeric: tabular-nums;
}
.neko-image-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  min-width: 0;
}
.neko-image-btn {
  flex: 1;
  min-width: 0;
  padding: 5px 4px;
  border: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
  border-radius: var(--app-radius-sm);
  background: var(--app-panel);
  color: var(--app-text);
  font-family: var(--app-font);
  font-size: 11px;
  cursor: pointer;
  /* The shared hover rung, which every other control in the app already runs
     on: this row — the plain buttons and the danger one that carries this class
     beside its own — was one the unification pass never reached, so a hover
     snapped here while it eased everywhere else. */
  transition: border-color var(--app-motion-fast) var(--app-ease),
              color var(--app-motion-fast) var(--app-ease);
}

@media (max-width: 520px) {
  .neko-image-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .neko-image-field-label,
  .neko-image-row .neko-image-field-label {
    width: 52px;
  }
  .neko-image-actions {
    flex-wrap: wrap;
  }
  .neko-image-btn {
    flex: 1 1 92px;
  }
}

:global(.image-panel-enter-active),
:global(.image-panel-leave-active) {
  transition: opacity var(--app-motion-fast) var(--app-ease),
    transform var(--app-motion-fast) var(--app-ease);
  transform-origin: top right;
}
:global(.image-panel-enter-from),
:global(.image-panel-leave-to) {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
.neko-image-btn:hover {
  border-color: var(--app-accent);
  color: var(--app-accent);
}
.neko-image-btn-danger:hover {
  border-color: var(--app-danger);
  color: var(--app-danger);
}
</style>
