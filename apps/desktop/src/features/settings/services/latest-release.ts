export const RELEASES_URL = 'https://api.github.com/repos/NekoRain404/NekoWrite/releases/latest'
export const RELEASE_PAGE = 'https://github.com/NekoRain404/NekoWrite/releases/tag/'

export interface LatestRelease {
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  updateAvailable: boolean
}

type Release = { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown }
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

function versionParts(version: string): { numbers: number[]; suffix: string } | null {
  const normalized = version.trim().replace(/^v/i, '')
  const match = normalized.match(/^(\d+(?:\.\d+){0,3})(?:[-+](.+))?$/)
  if (!match) return null
  return { numbers: match[1].split('.').map(Number), suffix: match[2] ?? '' }
}

function isNewer(candidate: string, current: string): boolean {
  const a = versionParts(candidate)
  const b = versionParts(current)
  if (!a || !b) throw new Error('Invalid application version')
  const width = Math.max(a.numbers.length, b.numbers.length)
  for (let i = 0; i < width; i += 1) {
    const difference = (a.numbers[i] ?? 0) - (b.numbers[i] ?? 0)
    if (difference) return difference > 0
  }
  if (!a.suffix) return Boolean(b.suffix)
  if (!b.suffix) return false
  return a.suffix.localeCompare(b.suffix, undefined, { numeric: true }) > 0
}

export async function checkLatestRelease(
  currentVersion: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<LatestRelease> {
  const response = await fetcher(RELEASES_URL, {
    headers: { Accept: 'application/vnd.github+json' },
    signal,
  })
  if (!response.ok) throw new Error(`GitHub release check failed (${response.status})`)
  const release: unknown = await response.json()
  if (typeof release !== 'object' || release === null) throw new Error('GitHub returned an invalid release')
  const latest = release as Release
  if (latest.draft === true || latest.prerelease === true || typeof latest.tag_name !== 'string' || typeof latest.html_url !== 'string') {
    throw new Error('No stable NekoWrite release was found')
  }
  if (!latest.html_url.startsWith(RELEASE_PAGE)) throw new Error('GitHub returned an invalid release URL')

  const latestVersion = latest.tag_name.replace(/^v/i, '')
  return {
    currentVersion,
    latestVersion,
    releaseUrl: latest.html_url,
    updateAvailable: isNewer(latestVersion, currentVersion),
  }
}
