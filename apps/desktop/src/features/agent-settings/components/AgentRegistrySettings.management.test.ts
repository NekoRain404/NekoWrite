import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import AgentRegistrySettings from './AgentRegistrySettings.vue'
import type { AgentDiscoveryCandidate, AgentRegistryClient, AgentRegistryEntry } from '../services/agent-registry-policy'

const entry: AgentRegistryEntry = {
  agentId: 'custom', displayName: 'Custom', source: 'external', program: '/usr/bin/custom',
  args: ['acp'], env: 'user-environment', envExtra: [], enabled: true,
  adapterId: 'generic-acp', reportedVersion: null, programState: 'launchable',
}
const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()))
const bundledAgent: AgentRegistryEntry = {
  ...entry, agentId: 'opencode', displayName: 'OpenCode', source: 'bundled',
  program: '/usr/bin/opencode', args: ['acp'], adapterId: 'opencode',
}
const discoveredOpenCode: AgentDiscoveryCandidate = {
  agentId: 'opencode', displayName: 'OpenCode', command: 'opencode', program: '/usr/bin/opencode',
  args: ['acp'], available: true, adapterId: 'opencode',
}
async function mount(
  running = false,
  defaultAgentId = 'opencode',
  initialEntries: AgentRegistryEntry[] = [entry],
  candidates: AgentDiscoveryCandidate[] = [],
) {
  let entries = initialEntries
  const deleteAgent = vi.fn(async () => { entries = []; return null })
  const update = vi.fn(async (_agentId: string, draft: { displayName: string; program: string }) => {
    entries = [{ ...entry, displayName: draft.displayName, program: draft.program }]; return null
  })
  const client: AgentRegistryClient = {
    read: async () => ({ defaultAgentId, entries, adapterIds: ['generic-acp'],
      runningAgentIds: running ? ['custom'] : [], profileOwners: { default: 'opencode' } }),
    discover: vi.fn(async () => candidates), add: vi.fn(async () => null), update,
    setEnabled: vi.fn(async () => null), delete: deleteAgent,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(AgentRegistrySettings, { client, profileId: 'default' })
  app.mount(host)
  cleanups.push(() => { app.unmount(); host.remove() })
  await nextTick(); await nextTick()
  return { host, client, deleteAgent, update }
}
async function click(host: HTMLElement, selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector)
  expect(button).not.toBeNull()
  button!.click()
  await nextTick(); await nextTick(); await nextTick()
}
describe('Agent registration management', () => {
  it('suggests a free ID when discovering an executable for a bundled registration', async () => {
    const { host } = await mount(false, 'opencode', [entry, bundledAgent], [discoveredOpenCode])
    await click(host, '[data-test="registry-discover"]')
    const use = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('填入表单'))
    expect(use).toBeDefined()
    use!.click()
    await nextTick(); await nextTick()

    expect(host.querySelector<HTMLInputElement>('[data-test="registry-field-agentId"]')?.value).toBe('opencode-2')
    expect(host.querySelector<HTMLInputElement>('[data-test="registry-field-program"]')?.value).toBe('/usr/bin/opencode')
    expect(host.querySelector('[data-test="registry-problem-agentId"]')).toBeNull()
  })
  it('opens the registered agent in an update form and refreshes after save', async () => {
    const { host, update } = await mount()
    await click(host, '[data-test="registry-edit-custom"]')
    expect(host.querySelector<HTMLInputElement>('[data-test="registry-field-agentId"]')?.value).toBe('custom')
    expect(host.querySelector<HTMLInputElement>('[data-test="registry-field-agentId"]')?.disabled).toBe(true)
    const name = host.querySelector<HTMLInputElement>('[data-test="registry-field-displayName"]')!
    name.value = 'Qwen Code'; name.dispatchEvent(new Event('input', { bubbles: true }))
    await click(host, '[data-test="registry-update"]')
    expect(update).toHaveBeenCalledWith('custom', expect.objectContaining({ agentId: 'custom', displayName: 'Qwen Code' }))
    expect(host.querySelector('[data-test="registry-row-custom"]')?.textContent).toContain('Qwen Code')
  })
  it('cancels editing and refuses edits of a running agent', async () => {
    const { host, update } = await mount()
    await click(host, '[data-test="registry-edit-custom"]')
    await click(host, '[data-test="registry-cancel-edit"]')
    expect(update).not.toHaveBeenCalled()
    const running = await mount(true)
    expect(running.host.querySelector<HTMLButtonElement>('[data-test="registry-edit-custom"]')?.disabled).toBe(true)
  })
  it('allows deleting the external default while keeping its disable toggle locked', async () => {
    const { host, deleteAgent } = await mount(false, 'custom')
    expect(host.querySelector<HTMLInputElement>('[data-test="registry-toggle-custom"]')?.disabled).toBe(true)
    await click(host, '[data-test="registry-delete-custom"]')
    await click(host, '[data-test="registry-confirm-delete"]')
    expect(deleteAgent).toHaveBeenCalledWith('custom')
  })
  it('retains the registration and allows retry after deletion fails', async () => {
    const { host, deleteAgent } = await mount()
    deleteAgent.mockRejectedValueOnce(new Error('disk full'))
    await click(host, '[data-test="registry-delete-custom"]')
    await click(host, '[data-test="registry-confirm-delete"]')
    expect(host.querySelector('[data-test="registry-row-custom"]')).not.toBeNull()
    expect(host.querySelector('[data-test="registry-action-failed"]')).not.toBeNull()
    await click(host, '[data-test="registry-confirm-delete"]')
    expect(deleteAgent).toHaveBeenCalledTimes(2)
  })
  it('suggests an unused ID without replacing a manually edited ID', async () => {
    const { host } = await mount()
    const set = async (field: string, value: string) => {
      const input = host.querySelector<HTMLInputElement>(`[data-test="registry-field-${field}"]`)!
      input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
    }
    await set('displayName', 'Custom')
    expect(host.querySelector<HTMLInputElement>('[data-test="registry-field-agentId"]')!.value).toBe('custom-2')
    await set('agentId', 'my-agent')
    await set('displayName', 'Different Name')
    expect(host.querySelector<HTMLInputElement>('[data-test="registry-field-agentId"]')!.value).toBe('my-agent')
  })
  it('requires confirmation and refreshes after persistent deletion', async () => {
    const { host, deleteAgent } = await mount()
    await click(host, '[data-test="registry-delete-custom"]')
    expect(deleteAgent).not.toHaveBeenCalled()
    await click(host, '[data-test="registry-confirm-delete"]')
    expect(deleteAgent).toHaveBeenCalledWith('custom')
    expect(host.querySelector('[data-test="registry-row-custom"]')).toBeNull()
  })
  it('cancels deletion without calling the backend', async () => {
    const { host, deleteAgent } = await mount()
    await click(host, '[data-test="registry-delete-custom"]')
    await click(host, '[data-test="registry-cancel-delete"]')
    expect(deleteAgent).not.toHaveBeenCalled()
    expect(host.querySelector('[data-test="registry-confirm-delete"]')).toBeNull()
  })
  it('disables deletion while the engine is running', async () => {
    const { host } = await mount(true)
    expect(host.querySelector<HTMLButtonElement>('[data-test="registry-delete-custom"]')?.disabled).toBe(true)
  })
  it('selects the generic ACP adapter for a new registration', async () => {
    const { host } = await mount()
    expect(host.querySelector('[data-test="registry-field-adapter"]')?.textContent).toContain('generic-acp')
  })
})
