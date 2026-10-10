/**
 * The external-change conflict, driven for real.
 *
 * `docs/USER-GUIDE.md` promises a dialog — 「文件已在外部被修改」 with 「以磁盘为准（放弃本地）」/「保留本地」/
 * 「稍后再说」 — and `docs/RECOVERY.md` §3 is the contract behind it. Every test of that path uses a fixture:
 * the vitest suites hand the conflict logic a fake status, and nothing has ever changed a file **underneath the
 * running application** and read what it did about it. That is the difference between "the decision table is
 * right" and "the watcher noticed, the dialog appeared, and the choice did what it says".
 *
 * Two arms, because the two promises are different ones:
 *
 *   A. take the disk — the editor must show the file's new text and the dialog must go away;
 *   B. keep the local — the editor must keep what the user has, and the next save must write **that** to disk,
 *      which is the half that could silently lose work if it were wired the other way round.
 *
 * Split out of `drive-app.mjs`, which owns the session and supplies the driver calls and the keyboard.
 */
import fs from 'node:fs'
import { until } from './webdriver.mjs'

/** How long the watcher is given to notice a file that changed underneath the app. */
const NOTICE_TIMEOUT_MS = 20_000

/** The dialog's own text, its path line, and the three buttons the guide names. */
const DIALOG_SCRIPT = `
const dialog = document.querySelector('.conflict-dialog')
if (!dialog) return null
return {
  title: (dialog.querySelector('.conflict-title') || {}).textContent || null,
  path: (dialog.querySelector('.conflict-path') || {}).textContent || null,
  buttons: Array.from(dialog.querySelectorAll('.dialog-actions button')).map((b) => (b.textContent || '').trim()),
}
`

/**
 * Run both arms. `helpers.typeText` and `helpers.pressCtrlS` come from the probe that owns the session, so the
 * keys here are the same real key events every other stage uses.
 */
export async function driveConflict({ run, script, findElement, typeText, pressCtrlS, readings, notePath, token }) {
  const readFile = () => fs.readFileSync(notePath, 'utf8')
  const editorText = () =>
    run('POST', '/execute/sync', script('return document.querySelector(".ProseMirror")?.innerText ?? ""')).catch(() => '')
  const dialogNow = () => run('POST', '/execute/sync', script(DIALOG_SCRIPT)).catch(() => null)
  const clickDialogButton = async (selector) => {
    const button = await findElement('css selector', `.conflict-dialog ${selector}`)
    if (!button) return false
    await run('POST', `/element/${button}/click`, {})
    return true
  }

  readings.conflict = {}

  // ---- Arm A: the file changes underneath a clean tab, and the user takes the disk's version -------------
  readings.conflict.beforeArmA = readFile()
  fs.writeFileSync(notePath, `# ${'drive-probe-note'}\n\n![probe](probe-asset.svg)\n\n${token}-from-disk\n`)
  readings.conflict.dialogA = await until(async () => (await dialogNow()) ?? null, {
    timeout: NOTICE_TIMEOUT_MS,
    what: 'the external-change dialog to appear',
  }).catch(() => null)
  if (readings.conflict.dialogA) {
    readings.conflict.localBeforeTakingDisk = String(await editorText()).replace(/\s+/g, ' ').slice(0, 120)
    readings.conflict.tookDisk = await clickDialogButton('.btn-danger')
    readings.conflict.afterTakingDisk = await until(
      async () => {
        const text = String(await editorText())
        return text.includes(`${token}-from-disk`) ? text.replace(/\s+/g, ' ').slice(0, 120) : null
      },
      { timeout: 10_000, what: "the editor to show the disk's text" },
    ).catch(() => null)
    // Polled, not read once: the dialog is inside `<Transition name="dialog">` with `v-if`, so the element
    // stays in the tree for the length of its leave animation. Reading immediately after the click reports a
    // dialog that is on its way out as one that stayed — which is what the first version of this arm did.
    readings.conflict.dialogClosedAfterA = await until(
      async () => ((await dialogNow()) === null ? true : null),
      { timeout: 5_000, what: 'the conflict dialog to leave the tree' },
    ).catch(() => false)
  }

  // ---- Arm B: keep the local version, and the next save must write it -----------------------------------
  // Typed with real key events, so this is the user's own edit rather than a model mutation.
  await typeText(`${token}-local`)
  readings.conflict.localTyped = await until(
    async () => {
      const text = String(await editorText())
      return text.includes(`${token}-local`) ? true : null
    },
    { timeout: 10_000, what: 'the typed edit to reach the editor' },
  ).catch(() => false)
  // A clean start for the second arm, so the dialog it reads can only be the one this write caused.
  readings.conflict.dialogGoneBeforeB = await until(
    async () => ((await dialogNow()) === null ? true : null),
    { timeout: 5_000, what: 'no conflict dialog before the second write' },
  ).catch(() => false)
  fs.writeFileSync(notePath, `# ${'drive-probe-note'}\n\n![probe](probe-asset.svg)\n\n${token}-from-disk-again\n`)
  readings.conflict.dialogB = await until(async () => (await dialogNow()) ?? null, {
    timeout: NOTICE_TIMEOUT_MS,
    what: 'the second external-change dialog to appear',
  }).catch(() => null)
  if (readings.conflict.dialogB) {
    readings.conflict.keptLocal = await clickDialogButton('.btn-primary')
    readings.conflict.editorAfterKeepLocal = String(await editorText()).replace(/\s+/g, ' ').slice(0, 140)
    await pressCtrlS()
    readings.conflict.diskAfterKeepLocalSave = await until(
      async () => {
        const text = readFile()
        return text.includes(`${token}-local`) ? text.replace(/\s+/g, ' ').slice(0, 160) : null
      },
      { timeout: 15_000, what: 'the local text to reach the file after saving' },
    ).catch(() => null)
    readings.conflict.diskFileAfter = readFile().replace(/\s+/g, ' ').slice(0, 160)
  }
}
