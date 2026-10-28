/**
 * Types shared inside the settings feature (§13.9).
 *
 * `SettingsSectionId` is the contract between the navigation rail and the panel
 * that switches sections: the rail owns the table of sections it renders, and
 * the panel owns the `v-if` that shows one, so the union is the one place the
 * two are checked against each other.
 */
import { PET_SETTINGS_SECTION, type PetSettingsPage } from '../../platform/gateways/pet-contracts'

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'editor'
  | 'export'
  | 'ai'
  | 'plugins'
  | 'about'
  // The agent surface (ACP plan §8's 「运行时、供应商/模型、Skills、命令/Agents、MCP、权限、诊断」).
  // One member for the whole tree rather than one per page: the tree has seven pages of its own
  // and a navigation rail that grew by seven rows would be a different control. `agents` is
  // last, which is where a section with no control that changes the document belongs.
  | 'agents'
  // The desktop pet (pet plan §10.1: 「增加 `desktop-pet` section，子页独立类型」). The id is D1's
  // constant rather than the literal: the pet names its own section once, in
  // `pet-contracts/config.ts`, and a literal here would be a second spelling of one decision that
  // only fails where nobody looks — a right-click whose settings row is not the row it opened.
  // The sub-pages are *not* union members: they are §5.1's second level, behind
  // `DesktopPetSettingsSection`, so a rail row for each of the seven would be a different control.
  | typeof PET_SETTINGS_SECTION

/**
 * Where a caller asked the dialog to open.
 *
 * The settings dialog has always opened on `general`, and this is the one thing that changes
 * that: the pet window's 设置 (§5.1's 设置定位) raises the main window and names a section and a
 * page, and the panel lands there instead. `page` is optional because only the pet's section has a
 * second level — every other section is one page — and the pet's own container is what falls back
 * to a page this build can actually render (`DesktopPetSettings.vue`). A caller that names no page
 * is asking for the section, not for a page called `undefined`.
 */
export interface SettingsOpenTarget {
  section: SettingsSectionId
  page?: PetSettingsPage
  agentPage?: AgentPageId
}

/**
 * The agents tree's own second level, and the same contract one level down.
 *
 * `AgentSettingsNavigation.vue` renders a row per member and `AgentSettingsSection.vue` renders the
 * page per member, so the union is what keeps the two from offering a row that leads nowhere or a
 * page nobody can reach — the same job `SettingsSectionId` does between the dialog's rail and the
 * dialog. It is *not* a re-export of `AGENT_SETTINGS_SECTIONS`: that list is the tree as the
 * feature declares it, nine sections including the two this build has no client for, and this is
 * the seven a rail may draw.
 */
export type AgentPageId =
  | 'runtime'
  | 'provider'
  | 'configuration'
  | 'skills'
  | 'permission'
  | 'registry'
  | 'catalogue'
