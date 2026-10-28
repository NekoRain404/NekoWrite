<script setup lang="ts">
/**
 * The settings dialog: the shell, the navigation rail and one section at a time.
 *
 * Orchestration only (§13.3). Each section renders itself and reads its own
 * state through `composables/*`, so this file holds no store reads at all
 * (§10.2) — what is left is the modal chrome and which section is visible.
 *
 * **This dialog is not teleported, and that is a decision rather than an
 * omission.** It used to be (`<Teleport to="body">`, carried over from the
 * 1508-line panel this file was split out of), and the cost was the whole
 * dialog, not a corner of it: `.shell` is the element that carries the user's
 * appearance — `data-theme`, `data-color-scheme`, `data-accent`,
 * `data-contrast`, `data-locale` and the seven inline `--app-*` properties
 * `AppShell.vue` writes — and a child of `body` is outside all of it. Measured
 * in Chromium with the dark `forest` scheme and a serif UI font chosen through
 * these very controls, the dialog drew `#fffefb` on `#292a27` in `system-ui`
 * with `--app-body-size: 15px`, while the shell beside it drew `#243020` on
 * `#e8f3e2` in the chosen serif at `17px`. A user picked a theme, a scheme and
 * a font by looking at a dialog that could show none of them.
 *
 * Nothing needs the teleport. The overlay is `position: fixed` — out of the
 * layout's flow wherever it is rendered — so what it needed was to be inside the
 * scope, and `AppDialogs.vue` already renders this component inside `.shell`,
 * beside the four dialogs that were never teleported and have always drawn the
 * user's palette. Anything that moves this element out of `.shell` again gives
 * every control in it a token instead of the setting it is there to show;
 * `e2e/settings-dialog-scope.spec.ts` measures the pair.
 *
 * The export section used to be the exception: the panel held its writable
 * computeds and forwarded its two events, because §10.3-C sends the export
 * *commands* out of the section. They still are — `useExportSettings` owns
 * them — but the section now reads that composable itself, the way the AI
 * prompt shelf does. Forwarding six models and five handlers through a shell
 * that owns none of them was the panel doing the section's job.
 */
import { ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { t } from '../../../i18n'
import AgentSettingsSection from './AgentSettingsSection.vue'
import AiSettings from './AiSettings.vue'
import AboutSettings from './AboutSettings.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import EditorSettings from './EditorSettings.vue'
import ExportSettings from './ExportSettings.vue'
import GeneralSettings from './GeneralSettings.vue'
import PluginSettings from './PluginSettings.vue'
import SettingsNavigation from './SettingsNavigation.vue'
import { DesktopPetSettingsSection } from '../../desktop-pet-settings'
import { createDesktopPetConnection } from '../../../app/desktop-pet-composition'
import { createAgentSettingsClients } from '../../../app/agent-settings-composition'
import { PET_SETTINGS_SECTION, type PetSettingsPage } from '../../../platform/gateways/pet-contracts'
import { useSettingsDialog } from '../composables/use-settings-dialog'
import { DIALOG_WIDTH_MIN, useDialogSize } from '../composables/use-dialog-size'
import { resetContentScroll } from '../composables/content-scroll'
import { markArrived, markLeaving } from '../../../composables/surface-leave'
import type { AgentPageId, SettingsOpenTarget, SettingsSectionId } from '../types'

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', path: string): void }>()

/**
 * Where the dialog was asked to open.
 *
 * `null` — the ordinary case — means "wherever it always opened", which is `general`. The one
 * caller that passes something is the pet window's 设置 (§5.1's 设置定位): it raises the main
 * window and names a section and a page, and the dialog lands there instead.
 *
 * A prop rather than internal state read once, because the request can also arrive while the
 * dialog is already open on another section — the right-click is answered by the panel it is
 * already showing, and a value only read in `setup` would leave that click doing nothing. The
 * watcher below is what makes the two cases one.
 */
const props = withDefaults(
  defineProps<{ target?: SettingsOpenTarget | null }>(),
  { target: null },
)

const activeSection = ref<SettingsSectionId>(props.target?.section ?? 'general')
const agentPage = ref<AgentPageId>(props.target?.agentPage ?? 'runtime')

/**
 * §5.1's sub-page the caller named.
 *
 * Held here rather than inside the pet's section because the *panel* is what outlives a request:
 * the section is remounted whenever the rail moves away and back, and a page the pet named would
 * otherwise be forgotten by the first click on another row.
 */
const petPage = ref<PetSettingsPage>(props.target?.page ?? 'general')

/**
 * The pet's host connection, or `null` where this window has none.
 *
 * The composition (§10.1) is the one place that decides, and it caches: the section is handed
 * this as a prop and never makes a connection of its own, so a remount cannot build a second one.
 * `null` is a state the section renders as a sentence — in a browser build, and in a test.
 */
const petConnection = createDesktopPetConnection()

/**
 * The agent settings tree's clients, from the composition site that owns that choice.
 *
 * Built here for the same reason the pet's connection is: the section takes its clients as a prop
 * and never constructs one, so §6.1's "the adapter is chosen at the composition site" holds for
 * these pages too. Unlike the pet's, this is never `null`: there is no double for the registry or
 * the profile (nothing a double could honestly stand in for), so a build without a backend is the
 * pages' own unreadable state rather than a section that says nothing.
 */
const agentClients = createAgentSettingsClients()

const dialogRef = ref<HTMLElement | null>(null)
const overlayRef = ref<HTMLElement | null>(null)

/**
 * The scroll container, and the reason this file holds it: it is the box the *rail* replaces the
 * contents of. Handed to {@link resetContentScroll} rather than to a rule of its own, because the
 * agents section's own rail swaps pages inside this same box and one rule with two callers is what
 * keeps the two swaps from landing in different places — see `content-scroll.ts` for the
 * measurement and for why the second caller finds the box instead of being handed it.
 */
const contentRef = ref<HTMLElement | null>(null)

const { appVersion, onOverlayPointerDown, focusDialog } = useSettingsDialog({
  dialogRef,
  onClose: () => emit('close'),
})

/**
 * The dialog's size, from the corner grip the user can drag.
 *
 * The overlay is handed over because the *room* a drag has is the overlay's content box — the same
 * box the stylesheet's `max-width: 100%` resolves against — and not the dialog's own, which is the
 * thing being decided. See `use-dialog-size.ts` for why the stylesheet declares no size at all.
 */
const {
  rendered: dialogSize,
  bounds: sizeBounds,
  dragging: resizing,
  onHandlePointerDown,
  onHandleKeydown,
  onHandleDoubleClick,
} = useDialogSize({ overlayRef })

// The keyboard follows the eye: changing section moves focus back to the panel
// container, so Tab starts from the top of the new section.
//
// The eye follows the same rule, and it is the half that was missing: focus went to the top of the
// new section while the *scroll* stayed where the old one had left it, so a reader who had scrolled
// to the bottom of the AI page arrived at the bottom of whichever page they opened next. Measured
// in Chromium at 1280x800: `1194/1230` before the press, `186/186` after it — the last row of a
// page they had not seen the top of. The reset is instant and in this same watcher, because it is
// the same act: the reader chose a different page, and both the keyboard and the viewport move to
// where that page begins.
watch(activeSection, () => {
  focusDialog()
  resetContentScroll(contentRef.value)
})

// The request arriving while the dialog is already open — §5.1's 设置定位 has to answer the
// second right-click as well as the first. The two writes are in the order the user asked for
// them: the section, then the page inside it.
watch(
  () => props.target,
  (target) => {
    if (!target) return
    activeSection.value = target.section
    if (target.page) petPage.value = target.page
    if (target.agentPage) agentPage.value = target.agentPage
  },
)
</script>

<template>
  <div
    ref="overlayRef"
    class="settings-overlay"
    role="presentation"
    @pointerdown="onOverlayPointerDown"
  >
    <!-- The size is inline state and nothing else: the stylesheet declares no width or height for
         this element, because a size that is both a drag and a constant is two answers to one
         question. `max-width`/`max-height: 100%` stay in the stylesheet — that is the *bound*, the
         overlay's content box, which is the same box `use-dialog-size`'s clamp measures. -->
    <div
      ref="dialogRef"
      class="settings-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('settings.dialogTitle')"
      :style="{ width: `${dialogSize.width}px`, height: `${dialogSize.height}px` }"
      tabindex="-1"
    >
      <div class="dialog-header">
        <span class="dialog-title">{{ t('settings.dialogTitle') }}</span>
        <span class="dialog-spacer" />
        <button
          class="settings-close"
          :title="t('common.close')"
          @click="emit('close')"
        >
          <X
            :size="15"
            :stroke-width="1.8"
          />
        </button>
      </div>
      <div class="dialog-body">
        <SettingsNavigation
          v-model:active-section="activeSection"
          v-model:agent-page="agentPage"
          v-model:pet-page="petPage"
          :pet-pages-enabled="petConnection !== null"
        />
        <div
          ref="contentRef"
          class="dialog-content"
        >
          <!-- One page at a time, and the swap is a *cross-fade*: the page
               leaving is still arriving's equal, not a thing to be waited on.
               Vue's `<Transition>` default mode runs the two together, which
               is what the earlier "switch categories quickly and it must go
               straight to the latest state, not queue" asks for — `out-in`
               would blank the destination for the whole exit. The leaving
               page is taken out of flow so the scroll container never briefly
               holds both (see the stylesheet), which is the same reason its
               number is the same as the panels': the box has to stay put even
               while the thing inside it changes.
               Every section's root is a single element, so the transition
               classes land on it and nothing about the markup or the focus
               watch changes.
               The two hooks are the other half of taking the leaver out of
               flow: an out-of-flow page that is still in the tab order is
               still a place the user can be, and measured it stayed *findable*
               too — 60ms after a switch the previous section still matched 15
               controls that now sit under the new one. See surface-leave.ts,
               and `.page-leave-active` below for the pointer. -->
          <Transition
            name="page"
            @leave="markLeaving"
            @enter="markArrived"
          >
            <GeneralSettings
              v-if="activeSection === 'general'"
              :app-version="appVersion"
              @saved="(p: string) => emit('saved', p)"
            />
            <AppearanceSettings
              v-else-if="activeSection === 'appearance'"
            />
            <EditorSettings
              v-else-if="activeSection === 'editor'"
            />
            <ExportSettings
              v-else-if="activeSection === 'export'"
            />
            <PluginSettings
              v-else-if="activeSection === 'plugins'"
            />
            <AboutSettings
              v-else-if="activeSection === 'about'"
              :app-version="appVersion"
            />
            <AiSettings
              v-else-if="activeSection === 'ai'"
            />
            <!-- The agents tree's own door (T16). It is one section here and
                 seven pages inside it, which is why this is a section of its
                 own rather than seven rows: the dialog's rail switches
                 sections, and those seven are a tree one level down. What it
                 carries today is stated on the page itself — the switch that
                 reaches this shell, and the parts of the tree whose host half
                 does not exist yet. -->
            <AgentSettingsSection
              v-else-if="activeSection === 'agents'"
              v-model:page="agentPage"
              :clients="agentClients"
              :show-navigation="false"
            />
            <!-- The pet's settings tree (§5.1), and the one section that is not this
                 feature's: the id is D1's constant (a literal here would be a second spelling
                 of one decision) and the body is one component from
                 `features/desktop-pet-settings`, which fills the container's five slot pages
                 itself. This file is therefore where the pet becomes *reachable* — the pages
                 behind it were built and tested with nowhere to mount — and the connection it
                 is handed comes from the composition, so nothing here decides what the pet
                 talks to. A build with no host connection is a state the section states in
                 words rather than a control that fails when it is used. -->
            <DesktopPetSettingsSection
              v-else-if="activeSection === PET_SETTINGS_SECTION"
              v-model:page="petPage"
              :gateway="petConnection"
              :show-navigation="false"
            />
          </Transition>
        </div>
      </div>

      <!-- The corner grip. A real control and not a decoration: `role="separator"` with its value
           semantics, `tabindex="0"`, arrows for each axis, Home for the floor and End for the
           window, and a double-click back to the size it opens at — the same vocabulary
           `ui/LayoutResizeHandle.vue` uses for the three columns, so the app has one resize control
           rather than two.
           ARIA's `separator` is one-dimensional and this grip moves two, which is a limit of the
           role rather than a choice made here: `aria-orientation` describes the width axis the
           handle is named for and `aria-valuenow` reports, and `aria-valuetext` carries both
           numbers so a screen reader announces the state rather than half of it. -->
      <div
        class="settings-resize"
        :class="{ 'is-active': resizing }"
        role="separator"
        aria-orientation="vertical"
        :aria-label="t('settings.resize.label')"
        :title="t('settings.resize.hint')"
        :aria-valuemin="DIALOG_WIDTH_MIN"
        :aria-valuemax="Math.round(sizeBounds.width)"
        :aria-valuenow="dialogSize.width"
        :aria-valuetext="
          t('settings.resize.value', { width: dialogSize.width, height: dialogSize.height })
        "
        tabindex="0"
        @pointerdown="onHandlePointerDown"
        @keydown="onHandleKeydown"
        @dblclick="onHandleDoubleClick"
      />
    </div>
  </div>
</template>

<style scoped src="./settings-panel.css"></style>

<style>
/* The pointer keeps the corner cursor for the whole drag, wherever it has travelled to — the same
   rule and the same shape the rail handle uses for `is-layout-resizing`. Scoped styles cannot
   reach `body`, which is why this is a second block. */
body.is-dialog-resizing,
body.is-dialog-resizing * {
  cursor: nwse-resize !important;
  user-select: none !important;
}
</style>
