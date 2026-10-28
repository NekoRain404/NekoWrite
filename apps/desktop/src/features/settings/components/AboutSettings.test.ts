import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import AboutSettings from './AboutSettings.vue'

const goodRelease = {
  tag_name: 'v1.0.0',
  html_url: 'https://github.com/NekoRain404/NekoWrite/releases/tag/v1.0.0',
}

let app: ReturnType<typeof createApp> | undefined
let fetchMock: ReturnType<typeof vi.fn>

function mount(): void {
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp(AboutSettings, { appVersion: '0.99.0-beta.1' })
  app.mount(host)
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(goodRelease), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  document.body.innerHTML = ''
})

afterEach(() => {
  app?.unmount()
  app = undefined
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('AboutSettings', () => {
  it('shows current version and performs a user-triggered update check', async () => {
    mount()
    expect(document.querySelector('[data-test="about-version"]')?.textContent).toContain('0.99.0-beta.1')
    expect(fetchMock).not.toHaveBeenCalled()

    document.querySelector<HTMLButtonElement>('[data-test="check-updates"]')?.click()
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-test="update-result"]')?.textContent).toContain('1.0.0')
    expect(document.querySelector('[data-test="update-result"] a')?.getAttribute('href')).toBe(goodRelease.html_url)
  })

  it('shows a readable failure and allows retrying', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    mount()
    document.querySelector<HTMLButtonElement>('[data-test="check-updates"]')?.click()
    await flush()

    expect(document.querySelector('[data-test="update-error"]')?.textContent).toContain('offline')
    document.querySelector<HTMLButtonElement>('[data-test="check-updates"]')?.click()
    await flush()
    expect(document.querySelector('[data-test="update-result"]')).not.toBeNull()
  })

  it('aborts an in-flight check when the page is removed', async () => {
    let signal: AbortSignal | undefined
    fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
    })
    mount()
    document.querySelector<HTMLButtonElement>('[data-test="check-updates"]')?.click()
    await flush()
    app?.unmount()
    app = undefined
    expect(signal?.aborted).toBe(true)
  })
})
