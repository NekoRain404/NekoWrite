import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App as VueApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import SettingsPanel from './SettingsPanel.vue'
import { useAppearanceStore } from '../../../stores/appearance'
import { COLOR_SCHEMES } from '../../../stores/appearance-palette'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

/** The packaged version is what Settings must show; the build-time value is
 *  only the fallback used outside Tauri (the browser demo). */
const getVersionMock = vi.hoisted(() => vi.fn(async () => '9.9.9'))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: getVersionMock }))

const matchMediaMock = vi.fn(() => ({
  matches: false,
  media: '(prefers-color-scheme: dark)',
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}))

let mounted: VueApp[] = []

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockResolvedValue(undefined)
  localStorage.clear()
  setActivePinia(createPinia())
  globalThis.matchMedia = matchMediaMock as never
  document.body.innerHTML = ''
  mounted = []
})

afterEach(() => {
  mounted.forEach((app) => app.unmount())
  mounted = []
  document.body.innerHTML = ''
})

function mountPanel(): void {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(SettingsPanel, { onClose: vi.fn(), onSaved: vi.fn() } as never)
  app.mount(host)
  mounted.push(app)
}

async function openAppearanceTab(): Promise<void> {
  mountPanel()
  const nav = Array.from(document.querySelectorAll<HTMLElement>('.nav-row'))
  const appearance = nav.find((n) => n.textContent?.includes('外观'))
  if (!appearance) throw new Error('appearance nav missing')
  appearance.click()
  await nextTick()
}

describe('SettingsPanel color scheme picker', () => {
  it('renders one labelled, selectable preview card per scheme', async () => {
    await openAppearanceTab()
    const cards = document.querySelectorAll<HTMLButtonElement>('.color-scheme-card')

    expect(cards.length).toBe(COLOR_SCHEMES.length)
    for (const card of cards) {
      expect(card.getAttribute('role')).toBe('radio')
      expect(card.getAttribute('aria-checked')).toBeTruthy()
      expect(card.querySelector('.color-scheme-preview')).toBeTruthy()
      expect(card.querySelectorAll('.color-scheme-swatch').length).toBe(1)
      expect(card.querySelector('.color-scheme-name')?.textContent?.trim().length).toBeGreaterThan(0)
    }
  })

  it('selects the clicked theme and marks it as the active radio', async () => {
    await openAppearanceTab()
    const appearance = useAppearanceStore()
    const ocean = document.querySelector<HTMLButtonElement>('[data-scheme="ocean"]')
    expect(ocean).toBeTruthy()
    ocean?.click()
    await nextTick()

    expect(appearance.colorScheme).toBe('ocean')
    expect(ocean?.getAttribute('aria-checked')).toBe('true')
  })
})

describe('SettingsPanel version row', () => {
  it('shows the version of the build, so a bug report can name it', async () => {
    mountPanel()
    await nextTick()
    // The read is async; give its microtask a turn before looking.
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    const row = document.querySelector('[data-test="app-version"]')
    expect(row).toBeTruthy()
    expect(row!.textContent).toContain('9.9.9')
  })

  it('shows nothing rather than a wrong number when no version is available', async () => {
    // Outside Tauri there is no app to ask and no injected value in a unit
    // test, so the honest answer is an absent row, not a fabricated one.
    getVersionMock.mockRejectedValueOnce(new Error('no tauri'))
    mountPanel()
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    const text = document.querySelector('[data-test="app-version"]')?.textContent ?? ''
    expect(/undefined|NaN/.test(text)).toBe(false)
  })
})

describe('SettingsPanel About section', () => {
  it('opens About from settings navigation and shows release checking', async () => {
    mountPanel()
    const about = Array.from(document.querySelectorAll<HTMLElement>('.nav-row'))
      .find((row) => row.textContent?.includes('关于'))
    expect(about).toBeTruthy()
    about?.click()
    await nextTick()
    expect(document.querySelector('[data-test="about-version"]')).toBeTruthy()
    expect(document.querySelector('[data-test="check-updates"]')).toBeTruthy()
  })
})
