import { describe, it, expect } from 'vitest'
import { applyIncremental, syncMode, FULL_SYNC_MS, type SyncRow } from '../src/core/pr-sync'
import sample from './fixtures/board.json'
import { botOwners, bots, unpairedComputers, items, pullRequest } from '../src/core/normalize'
import { githubRepo, mapPrs, owners } from '../src/core/map-prs'
import { allView, buildBoard, toggleBot } from '../src/core/board'
import { botKey, type Bot, type Computer, type Workspace } from '../src/core/model'
const bot: Bot = { ...sample.bot, computer: 'local', home: null }
const item = items({ items: [sample.item] }, bot, [])[0]!
const pr = pullRequest(sample.pr)
const workspace: Workspace = {
  computer: 'local',
  id: 'sample-workspace',
  bot: bot.name,
  name: 'Marker',
  repo: 'sample',
  path: null,
  remote: null,
  branch: 'marker',
  home: null,
}
it('reconciles overlapping PR changes until a full sync is due', () => {
  const now = new Date(2026, 0, 10, 12)
  const at = now.toISOString()
  const state = { syncedAt: at, fullSyncedAt: at, login: 'owner' }
  const options = { now, login: 'owner', manual: false }
  expect(syncMode(state, options)).toBe('incremental')
  for (const overrides of [{ manual: true }, { login: 'other' }, { now: new Date(+now + FULL_SYNC_MS) }])
    expect(syncMode(state, { ...options, ...overrides })).toBe('full')
  expect(syncMode({}, options)).toBe('full')
  const original = {
    prs: [pr, { ...pr, number: 3 }],
    merged: [{ ...pr, number: 5, mergedAt: new Date(+now - 86400000).toISOString() }],
    total: 240,
  }
  const added = { ...pr, number: 4, updated: at }
  const changed = { ...pr, number: 3, title: 'Updated' }
  const rows: SyncRow[] = [
    { pr, state: 'MERGED', mergedAt: at },
    { pr: added, state: 'OPEN' },
    { pr: changed, state: 'OPEN' },
    { pr: added, state: 'CLOSED' },
  ]
  const next = applyIncremental(original, rows, now)
  expect(next).toEqual({ prs: [changed], merged: [{ ...pr, mergedAt: at }], total: 239 })
  expect(applyIncremental(next, rows, now)).toEqual(next)
  expect(applyIncremental({ ...original, allOpenLoaded: true }, rows, now).total).toBe(1)
})

describe('normalize', () => {
  it('requires source fields', () => {
    expect(() => bots({ bots: [{}] }, 'local')).toThrow('id')
    expect(() => pullRequest({ ...sample.pr, changedFiles: null })).toThrow('changedFiles')
  })
  it('queries a federated bot only on the runtime that lists it as resident', () => {
    const clio = { id: 'clio-id', name: 'Clio' }
    const mac = bots({ bots: [{ ...clio, server: { name: 'Dell', id: 'dell' } }] }, 'local')
    const dell = bots({ bots: [clio] }, 'dell')
    expect(
      botOwners([
        { key: 'local', bots: bots({ bots: [clio] }, 'local') },
        { key: 'dell', bots: dell },
      ]).get(clio.id),
    ).toBe('dell')
    expect(mac[0]?.computer).toBe('federated:dell')
    expect(unpairedComputers(mac, [{ key: 'dell', name: 'Dell' }], new Map())).toEqual([])
    expect(dell.map((b) => b.computer)).toEqual(['dell'])
    const board = buildBoard(
      [
        {
          key: 'local',
          name: 'Mac',
          source: { ok: true, value: { bots: mac.filter((b) => b.computer === 'local'), items: [], workspaces: [] } },
        },
      ],
      [],
      allView,
    )
    expect(board.computers).toEqual([])
  })
  it('shows a federated bot once under its unpaired server with a named warning', () => {
    const bot = { id: 'clio', name: 'Clio', server: { name: 'Field station', on: 'field-id' } }
    const roster = bots({ bots: [bot, bot] }, 'local')
    const computers = unpairedComputers(roster, [], botOwners([{ key: 'local', bots: roster }]))
    const board = buildBoard(computers, [], allView)
    expect(board.bots.map((b) => [b.name, b.computer])).toEqual([['Clio', 'federated:field-id']])
    expect(board.computers[0]?.warning?.message).toContain('Field station')
  })
  it('preserves optional data and excludes closed rows', () => {
    expect(item.chat).toBeNull()
    expect(item.options).toEqual(['First'])
    expect(items({ items: [{ status: 'done' }] }, bot, [])).toEqual([])
  })
})
describe('mapping', () => {
  it.each([
    ['git@github.com:Owner/Repo.git', 'Owner/Repo'],
    ['ssh://git@github.com/Owner/Repo', 'Owner/Repo'],
    ['https://github.com/Owner/Repo.git/', 'Owner/Repo'],
    ['https://github.com/Owner/Repo', 'Owner/Repo'],
    ['https://user@github.com/Owner/Repo', 'Owner/Repo'],
    ['https://gitlab.com/Owner/Repo.git', null],
    ['invalid', null],
  ])('parses the GitHub repository from %s', (url: string | null, expected: string | null) => {
    expect(githubRepo(url!)).toBe(expected)
  })
  it.each(['guilatrova/bot-kanban-board', 'Guilatrova/Bot-Kanban-Board'])(
    'maps a renamed project by remote %s',
    (remote: string) => {
      const w = { ...workspace, repo: 'orca-bots-board', remote }
      expect(owners({ ...pr, repo: 'guilatrova/bot-kanban-board' }, [], [w])).toMatchObject({
        how: 'branch',
        workspaces: [w],
      })
    },
  )
  it('prefers direct references and keeps all matching Items', () => {
    const result = mapPrs([pr], [item, { ...item, number: 8 }, { ...item, text: 'sample#42' }], [workspace])[0]
    expect(result?.how).toBe('item')
    expect(result?.items.map((i) => i.number)).toEqual([7, 8])
    expect(result?.workspaces).toEqual([workspace])
  })
  it('respects number and owner boundaries and matches closing issues', () => {
    expect(
      mapPrs([pr], [{ ...item, text: 'sample#12 other/sample#1' }], [{ ...workspace, repo: 'other/sample' }])[0]?.how,
    ).toBeNull()
    expect(mapPrs([pr], [{ ...item, text: 'orchard/sample#42' }], [])[0]?.how).toBe('issue')
    expect(mapPrs([pr], [], [workspace])[0]?.how).toBe('branch')
  })
})
it('orders columns, counts bots across computers and applies filters', () => {
  const computers: Computer[] = ['local', 'remote'].map((key) => ({
    key,
    name: key,
    source: {
      ok: true,
      value: {
        bots: [{ ...bot, computer: key }],
        items: [
          { ...item, computer: key },
          { ...item, number: 9, updated: 1, computer: key },
        ],
        workspaces: [],
      },
    },
  }))
  const board = buildBoard(computers, [pr], { ...allView, bots: [botKey('remote', bot.name)] })
  expect(board.columns.map((c) => c.status)).toEqual(['waiting', 'needs_you', 'in_progress', 'closed'])
  expect(board.columns[1]?.items.map((i) => i.number)).toEqual([9, 7])
  expect(board.bots.map((b) => b.count)).toEqual([2, 2])
  expect(board.ready).toHaveLength(1)
})

it('solos, toggles, and restores all bots when the last is disabled', () => {
  const all = ['one', 'two']
  expect([...toggleBot(new Set(), all, 'one', false)]).toEqual(['two'])
  expect([...toggleBot(new Set(['one']), all, 'two', true)]).toEqual(['two'])
  expect([...toggleBot(new Set(['two']), all, 'two', false)]).toEqual([])
})
it('puts Planned in Waiting and Waiting in newest-change order', () => {
  const board = buildBoard(
    [
      {
        key: 'local',
        name: 'Local',
        source: {
          ok: true,
          value: {
            bots: [bot],
            workspaces: [],
            items: [
              { ...item, status: 'planned' },
              { ...item, status: 'waiting' },
              { ...item, status: 'waiting', number: 12, updated: 900 },
            ],
          },
        },
      },
    ],
    [],
    { ...allView, bots: [] },
  )
  expect(board.columns.map((c) => c.status)).toEqual(['waiting', 'needs_you', 'in_progress', 'closed'])
  expect(board.columns[0]?.items.map((i) => i.number)).toEqual([12, 7, 7])
})
it('reads decision replies and excludes structured PR link metadata from mapping', () => {
  const [i] = items(
    {
      items: [
        {
          ...sample.item,
          description: 'Field notes',
          question: { text: 'Which?', decisions: [{ replies: [{ label: 'North' }] }] },
          links: [{ kind: 'dispatch', title: 'Observe', pr: { title: 'orchard/sample#1' } }],
        },
      ],
    },
    bot,
    [],
  )
  expect(i?.options).toEqual(['North'])
  expect(i?.text).not.toContain('sample#1')
})
