<script lang="ts">
export type { AgentRegistryLabels } from './agent-registry-labels'
</script>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useAgentRegistryReadout } from './use-agent-registry-readout'
import AgentRegistrationRow from './AgentRegistrationRow.vue'
import AgentRegistrationForm from './AgentRegistrationForm.vue'
import AgentRegistryDiscovery from './AgentRegistryDiscovery.vue'
import AgentRegistryEngine from './AgentRegistryEngine.vue'
import { suggestRegistrationId } from '../services/agent-registration-id'
import {
  disableStanding, fillTemplate, refusedField, validateAgentDraft,
  type AgentDraft, type AgentDiscoveryCandidate, type AgentRegistryClient, type AgentRegistryEntry, type AgentRegistryReadout,
  type DraftField, type RegistryRefusal,
} from '../services/agent-registry-policy'
import { registryLabels, type AgentRegistryLabels } from './agent-registry-labels'

const props = withDefaults(
  defineProps<{
    client: AgentRegistryClient
    profileId: string
    sessionAgentId?: string | null
    canStartSession?: boolean
    prefill?: { agentId: string; displayName: string; program: string; args: readonly string[] } | null
    labels?: AgentRegistryLabels
  }>(),
  { sessionAgentId: null, canStartSession: true, prefill: null, labels: () => registryLabels() },
)

const emit = defineEmits<{ 'new-session': [agentId: string]; 'readout-changed': [readout: AgentRegistryReadout | null] }>()
const labels = computed<AgentRegistryLabels>(() => props.labels ?? registryLabels())
const { readout, loadState, load } = useAgentRegistryReadout(() => props.client)
watch([readout, loadState], () => {
  if (loadState.value !== 'loading' || readout.value === null) emit('readout-changed', loadState.value === 'ready' ? readout.value : null)
}, { immediate: true })
const entries = computed(() => readout.value?.entries ?? [])
const rowRefusals = reactive<Record<string, RegistryRefusal | null>>({})
const busy = ref<string | null>(null)
const actionFailed = ref(false)
const deleting = ref<AgentRegistryEntry | null>(null)
const editing = ref<string | null>(null)
const form = reactive({ agentId: '', displayName: '', program: '', args: '', adapterId: 'generic-acp' })
const edited = reactive<Record<DraftField, boolean>>({ agentId: false, displayName: false, program: false, args: false, adapterId: false })
const submitted = ref(false)
watch(() => [form.displayName, form.program], () => {
  if (editing.value === null && !edited.agentId) form.agentId = suggestRegistrationId(form.displayName, form.program, entries.value)
})
const addRefusal = ref<RegistryRefusal | null>(null)
const addedAgentId = ref<string | null>(null)
let appliedPrefill: typeof props.prefill = null

const draft = computed<AgentDraft>(() => ({
  agentId: form.agentId.trim(),
  displayName: form.displayName.trim(),
  program: form.program.trim(),
  args: form.args.split('\n').map((line) => line.replace(/\r$/, '')).filter((line) => line !== ''),
  adapterId: form.adapterId,
}))

const problems = computed<RegistryRefusal[]>(() => {
  if (loadState.value !== 'ready' || readout.value === null) return []
  return validateAgentDraft(draft.value, {
    adapterIds: readout.value.adapterIds,
    entries: readout.value.entries.filter((entry) => entry.agentId !== editing.value),
  })
})

function problem(field: DraftField): RegistryRefusal | null {
  if (!submitted.value && !edited[field]) return null
  return problems.value.find((refusal) => refusedField(refusal) === field) ?? null
}

function updateField(field: DraftField, value: string): void {
  form[field] = value
  edited[field] = true
}

function resetForm(): void {
  editing.value = null
  Object.assign(form, { agentId: '', displayName: '', program: '', args: '', adapterId: 'generic-acp' })
  for (const field of Object.keys(edited) as DraftField[]) edited[field] = false
  submitted.value = false
  addRefusal.value = null
}

function editRegistration(entry: AgentRegistryEntry): void {
  if (entry.source !== 'external' || readout.value?.runningAgentIds.includes(entry.agentId)) return
  editing.value = entry.agentId
  Object.assign(form, { agentId: entry.agentId, displayName: entry.displayName, program: entry.program,
    args: entry.args.join('\n'), adapterId: entry.adapterId })
  for (const field of Object.keys(edited) as DraftField[]) edited[field] = false
  submitted.value = false
  addRefusal.value = null
  addedAgentId.value = null
}

async function submit(): Promise<void> {
  if (busy.value !== null || loadState.value !== 'ready') return
  submitted.value = true
  addRefusal.value = null
  addedAgentId.value = null
  actionFailed.value = false
  if (problems.value.length > 0) return
  busy.value = editing.value ?? 'add'
  const submittedDraft = draft.value
  try {
    const refusal = editing.value === null
      ? await props.client.add(submittedDraft)
      : await props.client.update(editing.value, submittedDraft)
    if (refusal !== null) {
      addRefusal.value = refusal
      return
    }
    addedAgentId.value = editing.value === null ? submittedDraft.agentId : null
    resetForm()
    await load()
  } catch {
    actionFailed.value = true
  } finally {
    busy.value = null
  }
}


function useCandidate(candidate: AgentDiscoveryCandidate): void {
  const existing = entries.value.find((entry) => entry.agentId === candidate.agentId)
  if (existing?.source === 'external') editRegistration(existing)
  else {
    editing.value = null
    // A system install may share the preset ID of a bundled engine; register it as a distinct
    // external engine instead of pre-filling a form that duplicate-ID validation will reject.
    form.agentId = existing === undefined
      ? candidate.agentId
      : suggestRegistrationId(candidate.displayName, candidate.program, entries.value)
  }
  form.displayName = candidate.displayName
  form.program = candidate.program
  form.args = candidate.args.join('\n')
  form.adapterId = candidate.adapterId
  for (const field of Object.keys(edited) as DraftField[]) edited[field] = true
  submitted.value = false
  addRefusal.value = null
}

async function toggle(entry: AgentRegistryEntry, event: Event): Promise<void> {
  if (busy.value !== null) return
  // A refusal leaves Vue's old value unchanged; restore the browser's optimistic checkbox.
  const input = event.target as HTMLInputElement
  const next = input.checked
  rowRefusals[entry.agentId] = null
  actionFailed.value = false
  busy.value = entry.agentId
  try {
    const refusal = await props.client.setEnabled(entry.agentId, next)
    if (refusal !== null) {
      input.checked = entry.enabled
      rowRefusals[entry.agentId] = refusal
      return
    }
    await load()
  } catch {
    input.checked = entry.enabled
    actionFailed.value = true
    return
  } finally {
    busy.value = null
  }
}

async function deleteRegistration(): Promise<void> {
  const entry = deleting.value
  if (entry === null || busy.value !== null || deletionBlocked(entry) !== null) return
  busy.value = entry.agentId
  actionFailed.value = false
  rowRefusals[entry.agentId] = null
  try {
    const refusal = await props.client.delete(entry.agentId)
    if (refusal !== null) {
      rowRefusals[entry.agentId] = refusal
      deleting.value = null
      return
    }
    deleting.value = null
    await load()
  } catch {
    actionFailed.value = true
  } finally {
    busy.value = null
  }
}

function blocked(entry: AgentRegistryEntry): RegistryRefusal | null {
  if (readout.value === null) return null
  const standing = disableStanding(entry, readout.value)
  return standing.allowed ? null : standing.refusal
}

function deletionBlocked(entry: AgentRegistryEntry): RegistryRefusal | null {
  if (readout.value?.runningAgentIds.includes(entry.agentId)) return { kind: 'instance-running', agentId: entry.agentId }
  if (entry.source === 'external') return null
  return blocked(entry)
}

watch(
  [() => props.prefill, entries],
  ([prefill]) => {
    if (prefill === null) { appliedPrefill = null; return }
    if (readout.value === null || appliedPrefill === prefill) return
    appliedPrefill = prefill
    const existing = entries.value.find((entry) => entry.agentId === prefill.agentId)
    if (existing?.source === 'external') editRegistration(existing)
    else editing.value = null
    form.agentId = prefill.agentId
    form.displayName = prefill.displayName
    form.program = prefill.program
    form.args = prefill.args.join('\n')
    edited.agentId = true
    edited.displayName = true
    edited.program = true
    edited.args = true
    // A prefill is a fresh start: the previous submission's answers do not belong to this draft.
    addRefusal.value = null
    addedAgentId.value = null
  },
  { immediate: true },
)

function refusalText(refusal: RegistryRefusal | null): string {
  if (refusal === null) return ''
  const copy = labels.value
  // A program problem *is* one of the state sentences: the same five answers the row draws, so the
  // form and the list cannot come to disagree about what "missing" means.
  if (refusal.kind === 'program') {
    return fillTemplate(copy.programState[refusal.state], { path: refusal.path })
  }
  const facts: Record<string, string> = {}
  for (const [key, value] of Object.entries(refusal)) {
    if (typeof value === 'string' || typeof value === 'number') facts[key] = String(value)
    else if (key === 'owner') facts.owner = copy.ownerUnknown
  }
  return fillTemplate(copy.refusal[refusal.kind], facts)
}

function versionText(entry: AgentRegistryEntry): string {
  return entry.reportedVersion === null
    ? labels.value.list.versionUnknown
    : fillTemplate(labels.value.list.version, { version: entry.reportedVersion })
}

</script>

<template>
  <section class="settings-section registry">
    <span class="settings-label">{{ labels.section.title }}</span>
    <span class="settings-note">{{ labels.section.hint }}</span>

    <span
      v-if="loadState === 'loading'"
      class="settings-note"
      data-test="registry-loading"
    >{{ labels.list.loading }}</span>
    <template v-else-if="loadState === 'unreadable'">
      <span
        class="settings-note is-error"
        data-test="registry-unreadable"
      >{{ labels.list.unreadable }}</span>
      <button
        type="button"
        class="registry-button"
        data-test="registry-retry"
        @click="load"
      >
        {{ labels.list.retry }}
      </button>
    </template>

    <template v-else>
      <span
        v-if="entries.length === 0"
        class="settings-note"
        data-test="registry-empty"
      >{{ labels.list.empty }}</span>
      <ul class="registry-rows">
        <AgentRegistrationRow
          v-for="entry in entries"
          :key="entry.agentId"
          :entry="entry"
          :labels="labels"
          :busy="busy"
          :blocked="blocked(entry) ? refusalText(blocked(entry)) : null"
          :deletion-blocked="deletionBlocked(entry) !== null"
          :edit-blocked="readout?.runningAgentIds.includes(entry.agentId) ?? false"
          :refusal="refusalText(rowRefusals[entry.agentId] ?? null)"
          :version="versionText(entry)"
          @toggle="toggle(entry, $event)"
          @delete="deleting = entry"
          @edit="editRegistration(entry)"
        />
      </ul>

      <div
        v-if="deleting"
        class="registry-confirm"
        role="alertdialog"
        :aria-label="labels.deletion.title"
      >
        <strong>{{ deleting.displayName || deleting.agentId }}</strong>
        <span class="settings-note">{{ labels.deletion.hint }}</span>
        <div class="registry-actions">
          <button
            type="button"
            class="registry-button"
            data-test="registry-confirm-delete"
            :disabled="busy !== null"
            @click="deleteRegistration"
          >
            {{ labels.deletion.confirm }}
          </button>
          <button
            type="button"
            class="registry-button"
            data-test="registry-cancel-delete"
            :disabled="busy !== null"
            @click="deleting = null"
          >
            {{ labels.deletion.cancel }}
          </button>
        </div>
      </div>

      <AgentRegistrationForm
        :form="form"
        :labels="labels"
        :adapter-ids="readout?.adapterIds ?? []"
        :busy="busy"
        :editing="editing !== null"
        :added-agent-id="addedAgentId"
        :action-failed="actionFailed"
        :add-refusal="addRefusal"
        :problem="problem"
        :refusal-text="refusalText"
        @submit="submit"
        @cancel="resetForm"
        @update="updateField"
      />
      <AgentRegistryDiscovery
        :client="client"
        :labels="labels"
        @use="useCandidate"
      />
      <AgentRegistryEngine
        :readout="readout"
        :profile-id="profileId"
        :session-agent-id="sessionAgentId"
        :can-start-session="canStartSession"
        :labels="labels"
        :refusal-text="refusalText"
        @new-session="emit('new-session', $event)"
      />
    </template>
  </section>
</template>

<style scoped src="./agent-registry-settings.css"></style>
