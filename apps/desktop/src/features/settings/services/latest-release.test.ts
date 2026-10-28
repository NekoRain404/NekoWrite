import { describe, expect, it, vi } from 'vitest'
import { checkLatestRelease } from './latest-release'

const RELEASES_URL = 'https://api.github.com/repos/NekoRain404/NekoWrite/releases/latest'

describe('checkLatestRelease', () => {
  it('compares the published version and returns a validated release URL', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      tag_name: 'v1.0.0-beta.2',
      html_url: 'https://github.com/NekoRain404/NekoWrite/releases/tag/v1.0.0-beta.2',
    }), { status: 200 }))

    await expect(checkLatestRelease('1.0.0-beta.1', fetcher)).resolves.toEqual({
      currentVersion: '1.0.0-beta.1',
      latestVersion: '1.0.0-beta.2',
      releaseUrl: 'https://github.com/NekoRain404/NekoWrite/releases/tag/v1.0.0-beta.2',
      updateAvailable: true,
    })
    expect(fetcher).toHaveBeenCalledWith(RELEASES_URL, expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'application/vnd.github+json' }),
    }))
  })

  it('treats a current or newer build as up to date', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      tag_name: 'v1.0.0',
      html_url: 'https://github.com/NekoRain404/NekoWrite/releases/tag/v1.0.0',
    }), { status: 200 }))

    await expect(checkLatestRelease('1.0.0', fetcher)).resolves.toMatchObject({ updateAvailable: false })
    await expect(checkLatestRelease('1.0.1', fetcher)).resolves.toMatchObject({ updateAvailable: false })
  })

  it('rejects bad network responses, malformed data and non-canonical release URLs', async () => {
    await expect(checkLatestRelease('1.0.0', vi.fn(async () => new Response('', { status: 503 }))))
      .rejects.toThrow('503')
    await expect(checkLatestRelease('1.0.0', vi.fn(async () => new Response('[]', { status: 200 }))))
      .rejects.toThrow('release')
    await expect(checkLatestRelease('1.0.0', vi.fn(async () => new Response(JSON.stringify({
      tag_name: 'v1.0.1', html_url: 'https://example.org/fake-release',
    }), { status: 200 }))))
      .rejects.toThrow('release URL')
  })

  it('does not apply an old response after cancellation', async () => {
    const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const controller = new AbortController()
    const pending = checkLatestRelease('1.0.0', fetcher, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
