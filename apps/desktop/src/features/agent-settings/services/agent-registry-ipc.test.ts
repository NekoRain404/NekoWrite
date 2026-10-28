/**
 * V13 — the registry client: what it does with each answer the backend can give.
 *
 * The wire literals below are the *shape* `R/src/commands/agent_registry.rs` serializes, written out
 * by hand rather than derived from the Rust types, because the coupling this file guards is between
 * two processes: a renamed JSON field keeps every Rust assertion green and would leave the page with
 * a blank row. The litmus is `the_wire_shape_the_backend_sends` — if the Rust side changes a key,
 * that case must change with it, and review is what catches the pair drifting.
 *
 * Three properties, one per group:
 *
 *  - **A refusal is data, and a rejection is not.** `null` is an accepted change; a refusal comes
 *    back as itself, arm for arm, with the facts the page's sentences have slots for; and anything
 *    this file cannot read is a *rejection*, which is the page's "the backend could not be reached"
 *    answer with a retry — never a silent empty list.
 *  - **Nothing is cast.** Every field the section reads is narrowed, so a value that is not what its
 *    name says (a number where a string belongs, an arm this build does not know) never reaches the
 *    page as a blank line.
 *  - **A message never quotes a value.** The malformed-answer errors name the field, not what was in
 *    it: the value is unknown by construction — that is why the check failed — and one of these
 *    fields is where a credential would be if the backend ever stopped masking.
 */

import { describe, expect, it, vi } from 'vitest'

import { createAgentRegistryClient, type AgentRegistryWire } from './agent-registry-ipc'
import type { AgentDraft } from './agent-registry-policy'

/**
 * One entry, spelled the way the Rust side serializes it: `RegistryEntry` in
 * `commands/agent_registry.rs`.
 *
 * A function rather than a constant, so a case that changes one field gets the rest of the shape
 * as the backend's own — and so the cases below can reach a field that is *inside* the entry
 * without an indexed read of an `unknown`. Reaching it through the readout's own JSON is what
 * those cases used to do, and what made them spread a value the checker can only call `unknown`.
 */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agentId: 'opencode',
    displayName: 'OpenCode',
    source: 'bundled',
    program: '/usr/bin/opencode',
    args: ['acp'],
    env: 'profile-isolated',
    envExtra: [{ name: 'ANTHROPIC_API_KEY', value: '<redacted>' }],
    enabled: true,
    adapterId: 'opencode',
    reportedVersion: '1.18.29',
    programState: 'launchable',
    ...overrides,
  }
}

/** One readout, spelled the way the Rust side serializes it. */
function readout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    defaultAgentId: 'opencode',
    entries: [entry()],
    adapterIds: ['opencode', 'generic-acp'],
    runningAgentIds: [],
    profileOwners: { default: 'opencode' },
    ...overrides,
  }
}

function wire(answers: {
  read?: unknown
  discover?: unknown
  add?: unknown
  setEnabled?: unknown
}): {
  port: AgentRegistryWire
  add: ReturnType<typeof vi.fn>
  setEnabled: ReturnType<typeof vi.fn>
} {
  const add = vi.fn(async () => answers.add ?? null)
  const setEnabled = vi.fn(async () => answers.setEnabled ?? null)
  return {
    port: {
      read: async () => answers.read ?? readout(),
      discover: async () => answers.discover ?? [],
      add,
      update: async () => null,
      setEnabled,
      delete: async () => null,
    },
    add,
    setEnabled,
  }
}

const draft: AgentDraft = {
  agentId: 'acme',
  displayName: 'Acme',
  program: '/opt/acme/acme-acp',
  args: ['--acp'],
  adapterId: 'generic-acp',
}

describe('what the backend answers with', () => {
  it('the wire shape the backend sends', async () => {
    const { port } = wire({})
    const client = createAgentRegistryClient(port)

    const answer = await client.read()

    // Field for field the readout the Rust test pins, including the two that are a *different*
    // spelling there: `programState` per entry, and `program` inside a refusal named `path`.
    expect(answer.defaultAgentId).toBe('opencode')
    expect(answer.entries[0]).toEqual({
      agentId: 'opencode',
      displayName: 'OpenCode',
      source: 'bundled',
      program: '/usr/bin/opencode',
      args: ['acp'],
      env: 'profile-isolated',
      envExtra: [{ name: 'ANTHROPIC_API_KEY', value: '<redacted>' }],
      enabled: true,
      adapterId: 'opencode',
      reportedVersion: '1.18.29',
      programState: 'launchable',
    })
    expect(answer.adapterIds).toEqual(['opencode', 'generic-acp'])
    expect(answer.runningAgentIds).toEqual([])
    expect(answer.profileOwners).toEqual({ default: 'opencode' })
  })

  it('a reported version the backend does not know is null and stays null', async () => {
    const { port } = wire({ read: readout({ entries: [entry({ reportedVersion: null })] }) })
    const answer = await createAgentRegistryClient(port).read()
    expect(answer.entries[0]?.reportedVersion).toBeNull()
  })
})

describe('ACP preset discovery', () => {
  it('keeps unavailable presets visible and only trusts a boolean availability field', async () => {
    const { port } = wire({
      discover: [{
        agentId: 'codex-acp',
        displayName: 'Codex ACP',
        command: 'npx',
        program: '/usr/bin/npx',
        args: ['--yes', '@agentclientprotocol/codex-acp'],
        available: false,
        adapterId: 'generic-acp',
      }],
    })

    await expect(createAgentRegistryClient(port).discover?.()).resolves.toEqual([{
      agentId: 'codex-acp',
      displayName: 'Codex ACP',
      command: 'npx',
      program: '/usr/bin/npx',
      args: ['--yes', '@agentclientprotocol/codex-acp'],
      available: false,
      adapterId: 'generic-acp',
    }])
  })

  it('rejects an ACP preset whose availability is not a boolean', async () => {
    const { port } = wire({
      discover: [{
        agentId: 'codex-acp',
        displayName: 'Codex ACP',
        command: 'npx',
        program: '/usr/bin/npx',
        args: ['--yes', '@agentclientprotocol/codex-acp'],
        available: 'yes',
        adapterId: 'generic-acp',
      }],
    })

    await expect(createAgentRegistryClient(port).discover?.()).rejects.toThrow(/available/)
  })
})

describe('a change that was refused', () => {
  it('an accepted change is null, and the draft goes over as the page built it', async () => {
    const { port, add } = wire({ add: null })
    const client = createAgentRegistryClient(port)

    expect(await client.add(draft)).toBeNull()
    // No source, no environment policy, no `enabled`: three decisions the backend makes, and a
    // draft that named them would be a form claiming a state the plan does not describe.
    expect(add).toHaveBeenCalledWith(draft)
    expect(await client.setEnabled('acme', false)).toBeNull()
  })

  it('each refusal comes back as itself, with the facts its sentence has slots for', async () => {
    const refusals: Array<Record<string, unknown>> = [
      { kind: 'id', field: 'agent_id', value: '../acme' },
      { kind: 'program', path: '/opt/acme/acme-acp', state: 'not-executable' },
      { kind: 'argument', index: 1 },
      { kind: 'environment', name: 'A=B' },
      { kind: 'unknown-adapter', adapterId: 'opencode-next' },
      { kind: 'duplicate-agent', agentId: 'acme' },
      { kind: 'unknown-agent', agentId: 'acme' },
      { kind: 'profile-unbound', profileId: 'acme-profile', agentId: 'acme', owner: 'opencode' },
      { kind: 'disabled', agentId: 'acme' },
      { kind: 'already-running', agentId: 'acme' },
      { kind: 'instance-running', agentId: 'acme' },
      { kind: 'is-default', agentId: 'opencode' },
      {
        kind: 'launch-failed',
        agentId: 'acme',
        code: 'process-exited',
        message: 'the engine connection closed: the engine closed the pipe',
      },
    ]

    for (const refusal of refusals) {
      const { port } = wire({ add: refusal })
      const answer = await createAgentRegistryClient(port).add(draft)
      // `kind` is the union's discriminant and the copy tree's key, so this is the assertion that
      // says the page's sentence exists for every arm the backend can send.
      expect(answer).toEqual(refusal)
    }
  })

  it('a profile-unbound refusal with no owner is null, not a missing slot', async () => {
    const { port } = wire({
      add: { kind: 'profile-unbound', profileId: 'acme-profile', agentId: 'acme', owner: null },
    })
    const answer = await createAgentRegistryClient(port).add(draft)
    expect(answer).toEqual({
      kind: 'profile-unbound',
      profileId: 'acme-profile',
      agentId: 'acme',
      owner: null,
    })
  })
})

describe('an answer this window cannot read', () => {
  it('is a rejection, because a call that answered this way did not complete', async () => {
    // The page's answer to a rejection is its unreadable state with a retry. Rendering this as an
    // empty list would say "no engines are registered", which is a claim about the backend.
    const { port } = wire({ read: { defaultAgentId: 'opencode' } })
    await expect(createAgentRegistryClient(port).read()).rejects.toThrow(/entries/)
  })

  it('names the field and never the value', async () => {
    const secret = 'sk-nkw-not-a-real-credential-0001'
    const { port } = wire({
      read: readout({
        entries: [
          entry({ envExtra: [{ name: 'ANTHROPIC_API_KEY', value: secret }], enabled: 'yes' }),
        ],
      }),
    })

    // The rejection itself, or a failure that says the read resolved instead — which is a claim
    // about what a refused read does, and the one thing this case depends on. `read()` answers
    // with a readout on success, so the union is narrowed rather than asserted away.
    const failure = await createAgentRegistryClient(port)
      .read()
      .catch((error: unknown) => error)
    if (!(failure instanceof Error)) throw new Error('the unreadable answer did not reject')
    expect(failure.message).toContain('entries[0].enabled')
    // The value that failed the check is `enabled`'s, and even that is not printed — the rule is
    // about every field, because which field holds the unknown is what the check just disproved.
    expect(failure.message).not.toContain('yes')
    expect(failure.message).not.toContain(secret)
  })

  it('refuses an arm, a state or a source this build does not know', async () => {
    const unknownKind = wire({ add: { kind: 'new-arm-from-a-newer-backend', agentId: 'acme' } })
    await expect(createAgentRegistryClient(unknownKind.port).add(draft)).rejects.toThrow(/kind/)

    const unknownState = wire({ read: readout({ entries: [entry({ programState: 'maybe' })] }) })
    await expect(createAgentRegistryClient(unknownState.port).read()).rejects.toThrow(
      /programState/,
    )

    const unknownSource = wire({ read: readout({ entries: [entry({ source: 'vendored' })] }) })
    await expect(createAgentRegistryClient(unknownSource.port).read()).rejects.toThrow(/source/)
  })

  it('carries a rejection from the IPC through as a rejection', async () => {
    // The distinction the port exists for: Tauri's own "command not found", a busy registry, or a
    // backend that could not build one — none of them is a refusal, and none may be swallowed.
    const ipcFailure = 'no agent session is running: start one first'
    const port: AgentRegistryWire = {
      read: async () => {
        throw ipcFailure
      },
      add: async () => {
        throw ipcFailure
      },
      update: async () => {
        throw ipcFailure
      },
      delete: async () => null,
      setEnabled: async () => {
        throw ipcFailure
      },
    }
    const client = createAgentRegistryClient(port)
    await expect(client.read()).rejects.toBe(ipcFailure)
    await expect(client.add(draft)).rejects.toBe(ipcFailure)
    await expect(client.setEnabled('acme', false)).rejects.toBe(ipcFailure)
  })
})
