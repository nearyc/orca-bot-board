import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { binaryPath } from '../src/worker/cli'
import { retry } from '../src/worker/polling'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'board-cli-'))
  vi.stubEnv('PATH', '')
  vi.stubEnv('LOCALAPPDATA', root)
  vi.stubEnv('ProgramFiles', root)
  vi.stubEnv('XDG_CONFIG_HOME', root)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

async function executable(dir: string, name: string) {
  await mkdir(dir, { recursive: true })
  const file = join(dir, name)
  await writeFile(file, '')
  await chmod(file, 0o700)
  return file
}

it.skipIf(process.platform !== 'win32')('finds Windows native CLIs even when the desktop PATH lacks them', async () => {
  const orca = await executable(join(root, 'Programs', 'orca', 'resources', 'bin'), 'orca.exe')
  const gh = await executable(join(root, 'GitHub CLI'), 'gh.exe')
  expect(await binaryPath('orca', '')).toBe(orca)
  expect(await binaryPath('gh', '')).toBe(gh)
})

it.skipIf(process.platform !== 'win32')('ignores drive-relative paths, directories and .cmd shims', async () => {
  const ambiguous = join(root, 'ambiguous')
  await executable(ambiguous, 'orca.exe')
  const first = join(root, 'shim')
  await executable(first, 'orca.cmd')
  await mkdir(join(first, 'orca.exe'))
  const second = join(root, 'native bin')
  const native = await executable(second, 'orca.exe')
  vi.stubEnv('PATH', `${ambiguous.slice(2)}${delimiter}${first}${delimiter}"${second}"`)
  expect(await binaryPath('orca', '')).toBe(native)
})

it('uses an explicitly configured executable ahead of PATH', async () => {
  const name = process.platform === 'win32' ? 'orca.exe' : 'orca'
  const first = join(root, 'bin')
  const custom = await executable(join(root, 'custom bin'), name)
  await executable(first, name)
  vi.stubEnv('PATH', first)
  expect(await binaryPath('orca', custom)).toBe(custom)
  await expect(binaryPath('orca', join(root, name))).rejects.toThrow('找不到')
})

it('uses the structured missing-CLI failure kind when rendering the retry banner', () => {
  const failure = {
    ok: false as const,
    kind: 'missing-executable' as const,
    command: 'gh api',
    message: '找不到 gh',
    next: '',
  }
  expect(retry(failure, 1, 0)).toEqual({ at: 90000, limited: false, message: '找不到 gh。90 秒后重试。' })
})
