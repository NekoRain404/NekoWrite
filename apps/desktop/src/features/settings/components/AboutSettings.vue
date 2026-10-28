<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { ExternalLink, RefreshCw } from 'lucide-vue-next'
import { t } from '../../../i18n'
import { checkLatestRelease, RELEASE_PAGE, type LatestRelease } from '../services/latest-release'

const props = defineProps<{ appVersion: string | null }>()
const result = ref<LatestRelease | null>(null)
const checking = ref(false)
const error = ref<string | null>(null)
let request: AbortController | null = null

async function checkForUpdates(): Promise<void> {
  if (!props.appVersion || checking.value) return
  request?.abort()
  request = new AbortController()
  checking.value = true
  error.value = null
  result.value = null
  try {
    const latest = await checkLatestRelease(props.appVersion, fetch, request.signal)
    if (request.signal.aborted) return
    result.value = latest
  } catch (cause) {
    if (!request.signal.aborted && !(cause instanceof DOMException && cause.name === 'AbortError')) {
      error.value = cause instanceof Error ? cause.message : t('settings.about.updateFailed')
    }
  } finally {
    checking.value = false
  }
}

onBeforeUnmount(() => request?.abort())
</script>

<template>
  <section class="settings-section about-settings">
    <h2>{{ t('settings.about.title') }}</h2>
    <div
      class="settings-field about-version"
      data-test="about-version"
    >
      <span>{{ t('settings.general.version') }}</span>
      <strong>{{ appVersion || t('settings.about.versionUnavailable') }}</strong>
    </div>

    <div class="settings-field">
      <span>{{ t('settings.about.updates') }}</span>
      <p class="settings-note">
        {{ t('settings.about.updateHint') }}
      </p>
      <button
        type="button"
        class="btn btn-secondary btn-sm about-check"
        :disabled="checking || !appVersion"
        data-test="check-updates"
        @click="checkForUpdates"
      >
        <RefreshCw
          :size="14"
          :class="{ spinning: checking }"
        />
        {{ checking ? t('settings.about.checking') : t('settings.about.check') }}
      </button>
      <span
        v-if="checking"
        class="settings-note"
        role="status"
      >{{ t('settings.about.checking') }}</span>
      <span
        v-else-if="error"
        class="settings-note about-error"
        role="alert"
        data-test="update-error"
      >
        {{ t('settings.about.updateFailed') }}: {{ error }}
      </span>
      <div
        v-else-if="result"
        class="settings-note about-result"
        role="status"
        data-test="update-result"
      >
        <span v-if="result.updateAvailable">{{ t('settings.about.updateAvailable', { version: result.latestVersion }) }}</span>
        <span v-else>{{ t('settings.about.upToDate', { version: result.currentVersion }) }}</span>
        <a
          :href="result.releaseUrl.startsWith(RELEASE_PAGE) ? result.releaseUrl : RELEASE_PAGE"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ t('settings.about.releasePage') }} <ExternalLink :size="12" />
        </a>
      </div>
    </div>

    <div class="settings-field">
      <span>{{ t('settings.about.project') }}</span>
      <a
        href="https://github.com/NekoRain404/NekoWrite"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ t('settings.about.sourceCode') }} <ExternalLink :size="12" />
      </a>
    </div>
    <p class="settings-note">
      {{ t('settings.about.description') }}
    </p>
    <p class="settings-note">
      {{ t('settings.about.license') }}
    </p>
  </section>
</template>

<style scoped>
.settings-section { display: flex; flex-direction: column; gap: 14px; }
h2 { margin: 0; color: var(--app-text); font-size: 16px; font-weight: 650; }
.settings-field { display: flex; flex-direction: column; gap: 6px; color: var(--app-text); font-size: 12px; }
.settings-field > span { color: var(--app-muted); font-size: 11px; }
.settings-note { margin: 0; color: var(--app-muted); font-size: 11px; line-height: 1.55; }
.about-version { flex-direction: row; justify-content: space-between; align-items: center; }
.about-version strong { font-size: 12px; font-weight: 600; }
.about-check { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; }
.about-result { display: grid; gap: 6px; }
a { display: inline-flex; align-items: center; gap: 5px; width: fit-content; color: var(--app-accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.about-error { color: var(--app-danger); }
.spinning { animation: spin 900ms linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
