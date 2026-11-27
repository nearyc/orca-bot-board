import { expect, it, vi } from 'vitest'
import { demoBoard } from '../src/demo'
import { runCli } from '../src/worker/cli'
import { readBoardPr } from '../src/worker/read-board-pr'
import sample from './fixtures/board.json'

vi.mock('../src/worker/cli', { spy: true })

const input = { repo: sample.pr.repository.nameWithOwner, number: sample.pr.number }

it('returns plain JSON for an unstacked open PR without a head OID', async () => {
  const pullRequest = { ...sample.pr, state: 'OPEN' }
  vi.mocked(runCli).mockResolvedValueOnce({ ok: true, value: { data: { repository: { pullRequest } } } })
  const data = demoBoard()
  data.prs = []
  const result = await readBoardPr('', input, data, false, async () => {}, vi.fn())
  expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result)
  expect(result).toMatchObject({
    ok: true,
    value: { merged: false, pr: { number: input.number }, facts: { ok: true } },
  })
})

it('returns a plain JSON failure for a missing PR', async () => {
  const result = await readBoardPr('', { ...input, number: 999 }, demoBoard(), true, async () => {}, vi.fn())
  expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result)
  expect(result).toMatchObject({ ok: false, command: 'PR read', message: '看板上找不到拉取请求 #999。' })
})

it('preserves a GitHub failure as plain JSON', async () => {
  const failure = { ok: false as const, command: 'gh api', status: 403, message: 'Forbidden', next: 'Refresh.' }
  vi.mocked(runCli).mockResolvedValueOnce(failure)
  const result = await readBoardPr('', input, demoBoard(), false, async () => {}, vi.fn())
  expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result)
  expect(result).toStrictEqual(failure)
})
