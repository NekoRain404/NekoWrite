<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Activity, Bell, Bot, Cable, Cat, ChevronDown, Download, FileCog, FolderGit2, Info,
  Globe, Heart, MessageCircle, Palette, PawPrint, Puzzle, Server, Settings2,
  ShieldCheck, SlidersHorizontal, Sparkles, Type, UserRound, Wand2,
} from 'lucide-vue-next'
import { t } from '../../../i18n'
import {
  PET_SETTINGS_PAGES, PET_SETTINGS_SECTION, type PetSettingsPage,
} from '../../../platform/gateways/pet-contracts'
import type { AgentPageId, SettingsSectionId } from '../types'

const activeSection = defineModel<SettingsSectionId>('activeSection', { required: true })
const agentPage = defineModel<AgentPageId>('agentPage', { required: true })
const petPage = defineModel<PetSettingsPage>('petPage', { required: true })
defineProps<{ petPagesEnabled?: boolean }>()

const SECTIONS = computed<Array<{ id: SettingsSectionId; label: string; icon: typeof Type }>>(() => [
  { id: 'general', label: t('settings.section.general'), icon: SlidersHorizontal },
  { id: 'appearance', label: t('settings.section.appearance'), icon: Palette },
  { id: 'editor', label: t('settings.section.editor'), icon: Type },
  { id: 'export', label: t('settings.section.export'), icon: Download },
  { id: 'ai', label: t('settings.section.ai'), icon: Sparkles },
  { id: 'plugins', label: t('settings.section.plugins'), icon: Puzzle },
  { id: 'about', label: t('settings.section.about'), icon: Info },
  { id: 'agents', label: t('settings.section.agents'), icon: Bot },
  { id: PET_SETTINGS_SECTION, label: t('settings.section.desktopPet'), icon: PawPrint },
])

const AGENT_PAGES: ReadonlyArray<{ id: AgentPageId; label: string; icon: typeof Type }> = [
  { id: 'runtime', label: t('agent.settings.runtime.section.title'), icon: Activity },
  { id: 'provider', label: t('agent.settings.provider.section.title'), icon: Cable },
  { id: 'configuration', label: t('agent.settings.config.section.title'), icon: FileCog },
  { id: 'skills', label: t('agent.settings.skills.section.title'), icon: Wand2 },
  { id: 'permission', label: t('agent.settings.permission.section.title'), icon: ShieldCheck },
  { id: 'registry', label: t('agent.registry.section.title'), icon: Server },
  { id: 'catalogue', label: t('agent.catalogue.section.title'), icon: Globe },
]

const PET_ICONS: Record<PetSettingsPage, typeof Type> = {
  general: Settings2,
  character: Cat,
  bubble: MessageCircle,
  notification: Bell,
  care: Heart,
  project: FolderGit2,
  advanced: UserRound,
}
const PET_PAGES = computed(() => PET_SETTINGS_PAGES.map((id) => ({
  id, label: t(`settings.pet.page.${id}`), icon: PET_ICONS[id],
})))

function isExpandable(id: SettingsSectionId): boolean {
  return id === 'agents' || id === PET_SETTINGS_SECTION
}

// Disclosure state is independent per group: selecting agents must not fold
// the desktop-pet pages, and selecting a page must not change the other group.
const expanded = ref<Record<'agents' | typeof PET_SETTINGS_SECTION, boolean>>({
  agents: activeSection.value === 'agents',
  [PET_SETTINGS_SECTION]: activeSection.value === PET_SETTINGS_SECTION,
})

function isExpanded(id: SettingsSectionId): boolean {
  if (id === 'agents') return expanded.value.agents
  if (id === PET_SETTINGS_SECTION) return expanded.value[PET_SETTINGS_SECTION]
  return false
}

function openSection(id: SettingsSectionId): void {
  if (!isExpandable(id)) {
    activeSection.value = id
    return
  }
  const wasActive = activeSection.value === id
  activeSection.value = id
  if (id === 'agents') expanded.value.agents = wasActive ? !expanded.value.agents : true
  else expanded.value[PET_SETTINGS_SECTION] = wasActive
    ? !expanded.value[PET_SETTINGS_SECTION]
    : true
}

function openAgentPage(page: AgentPageId): void {
  activeSection.value = 'agents'
  expanded.value.agents = true
  agentPage.value = page
}

function openPetPage(page: PetSettingsPage): void {
  activeSection.value = PET_SETTINGS_SECTION
  expanded.value[PET_SETTINGS_SECTION] = true
  petPage.value = page
}

// A setting-location request can arrive from another window while this dialog
// is already open. Keep both trees independent, but reveal the requested tree
// so its selected child page is reachable and announced.
watch(activeSection, (section) => {
  if (section === 'agents') expanded.value.agents = true
  if (section === PET_SETTINGS_SECTION) expanded.value[PET_SETTINGS_SECTION] = true
})

</script>

<template>
  <aside
    class="dialog-nav"
    role="tablist"
    :aria-label="t('settings.dialogTitle')"
  >
    <div
      v-for="s in SECTIONS"
      :key="s.id"
      class="nav-group"
    >
      <button
        type="button"
        class="nav-row"
        role="tab"
        :class="{ active: activeSection === s.id, 'nav-row-major': s.id === 'agents' }"
        :aria-current="activeSection === s.id ? 'page' : undefined"
        :aria-selected="activeSection === s.id"
        :aria-expanded="isExpandable(s.id) ? isExpanded(s.id) : undefined"
        @click="openSection(s.id)"
      >
        <component
          :is="s.icon"
          class="nav-row-icon"
          :size="16"
          :stroke-width="1.8"
        />
        <span>{{ s.label }}</span>
        <ChevronDown
          v-if="isExpandable(s.id)"
          class="nav-chevron"
          :class="{ open: isExpanded(s.id) }"
          :size="14"
        />
      </button>

      <Transition name="subnav">
        <div
          v-if="s.id === 'agents' && isExpanded(s.id)"
          class="settings-subnav agents-rail"
          role="tablist"
          :aria-label="t('agent.settings.agents.pages')"
        >
          <button
            v-for="page in AGENT_PAGES"
            :key="page.id"
            type="button"
            role="tab"
            class="settings-subnav-row agents-tab"
            :class="{ active: activeSection === 'agents' && agentPage === page.id }"
            :aria-selected="activeSection === 'agents' && agentPage === page.id"
            :data-page="page.id"
            @click="openAgentPage(page.id)"
          >
            <component
              :is="page.icon"
              :size="13"
              :stroke-width="1.8"
            />
            <span>{{ page.label }}</span>
          </button>
        </div>
        <div
          v-else-if="s.id === PET_SETTINGS_SECTION && isExpanded(s.id) && petPagesEnabled"
          class="settings-subnav pet-settings__rail"
          role="tablist"
          :aria-label="t('settings.section.desktopPet')"
        >
          <button
            v-for="page in PET_PAGES"
            :key="page.id"
            type="button"
            role="tab"
            class="settings-subnav-row pet-settings__tab"
            :class="{ active: activeSection === PET_SETTINGS_SECTION && petPage === page.id }"
            :aria-selected="activeSection === PET_SETTINGS_SECTION && petPage === page.id"
            :data-page="page.id"
            @click="openPetPage(page.id)"
          >
            <component
              :is="page.icon"
              :size="13"
              :stroke-width="1.8"
            />
            <span>{{ page.label }}</span>
          </button>
        </div>
      </Transition>
    </div>
  </aside>
</template>

<style scoped>
.dialog-nav {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 1px;
  width: 218px;
  padding: 14px 10px 18px;
  overflow-y: auto;
  border-right: 1px solid color-mix(in srgb, var(--app-border) 60%, transparent);
  background: color-mix(in srgb, var(--app-panel) 42%, transparent);
  user-select: none;
}
.nav-group { display: grid; gap: 2px; }
.nav-row {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--app-radius-md);
  background: transparent;
  color: color-mix(in srgb, var(--app-text) 72%, var(--app-muted));
  font: 500 12px var(--app-font);
  letter-spacing: -.01em;
  text-align: left;
  cursor: pointer;
  transition: background var(--app-motion-fast) var(--app-ease), color var(--app-motion-fast) var(--app-ease);
}
.nav-row:hover { color: var(--app-text); background: color-mix(in srgb, var(--app-panel) 62%, transparent); }
.nav-row-major { margin-top: 10px; }
.nav-row:focus-visible, .settings-subnav-row:focus-visible { outline: 2px solid var(--app-accent); outline-offset: 1px; }
.nav-row.active {
  padding-left: 8px;
  border-left: 2px solid var(--app-accent);
  background: color-mix(in srgb, var(--app-accent-soft) 58%, transparent);
  color: var(--app-text);
  font-weight: 600;
}
.nav-row-icon { color: color-mix(in srgb, var(--app-accent) 82%, var(--app-text)); }
.nav-chevron { opacity: .58; transition: transform var(--app-motion-fast) var(--app-ease); }
.nav-chevron.open { transform: rotate(180deg); }
.settings-subnav {
  display: grid;
  gap: 2px;
  margin: 2px 4px 8px 18px;
  padding: 3px 0 3px 10px;
  border-left: 1px solid color-mix(in srgb, var(--app-accent) 35%, var(--app-border));
}
.settings-subnav-row {
  display: grid;
  grid-template-columns: 13px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  min-height: 29px;
  padding: 0 8px;
  overflow: hidden;
  border: 0;
  border-radius: var(--app-radius-sm);
  background: transparent;
  color: var(--app-muted);
  font: 500 11px var(--app-font);
  text-align: left;
  cursor: pointer;
}
.settings-subnav-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-subnav-row:hover { color: var(--app-text); background: color-mix(in srgb, var(--app-elevated) 54%, transparent); }
.settings-subnav-row.active { color: var(--app-text); background: color-mix(in srgb, var(--app-accent-soft) 72%, transparent); font-weight: 650; }
.subnav-enter-active, .subnav-leave-active { transition: opacity var(--app-motion-fast) var(--app-ease), transform var(--app-motion-fast) var(--app-ease); }
.subnav-enter-from, .subnav-leave-to { opacity: 0; transform: translateY(-4px); }
@media (max-width: 760px) {
  .dialog-nav { width: 184px; padding: 10px 8px; }
}
</style>
