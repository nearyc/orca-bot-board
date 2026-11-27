import { items, bots, pullRequest } from './core/normalize'
import { prKey, type PullRequest, type Source } from './core/model'
import type { Progress, Snapshot } from './protocol'
export function demoBoard(state: string | null = null) {
  const list = bots(
    {
      bots: [
        { id: 'demo-hazel', name: 'Hazel' },
        { id: 'demo-fern', name: 'Fern' },
        { id: 'demo-lark', name: 'Lark' },
      ],
    },
    'local',
  )
  const entries = [
    ['needs_you', '选择果园采样方案', '第一轮应使用哪组样本？'],
    ['in_progress', '校准田间传感器', '正在对照基准验证读数。'],
    ['waiting', '审查灌溉计划', '正在等待现场报告。'],
    ['needs_you', '确认采样间隔', '采样器应每小时运行一次吗？'],
    ['in_progress', '整理幼苗清单', '已导入温室记录。'],
  ]
  entries.push(['planned', '规划下一次土壤调查', ''])
  if (state !== 'empty') entries.push(['done', '收集春季读数', ''], ['canceled', '停用旧采样路线', ''])
  const demoItems = entries.flatMap(([status, title, subject], n) =>
    items(
      {
        items: [
          {
            number: n + 1,
            status,
            title,
            description: n < 2 ? `收集第一批样本前，请查看 orchard/sample#${n + 1}。` : '准备季节性田间调查。',
            doneMeans: '田间记录已整理完毕，可供审查。',
            closedAt: status === 'done' || status === 'canceled' ? Date.now() : undefined,
            lastActivityAt: Date.now() - (n + 1) * 3600000,
            chat: { title: '田间调查' },
            question: { text: subject, options: ['使用春季读数', '使用秋季读数'] },
            wait: status === 'waiting' ? { text: subject } : null,
            links: [
              {
                kind: 'dispatch',
                title: '田间笔记',
                state: status === 'in_progress' ? 'working' : 'done',
                report: { subject, body: '已记录第一批样本。' },
              },
            ],
          },
        ],
      },
      list[n % list.length]!,
      [],
    ),
  )
  const pr = pullRequest({
    number: 1,
    title: '采样标记',
    url: 'https://github.com/orchard/sample/pull/1',
    isDraft: false,
    isCrossRepository: false,
    headRefName: 'marker',
    baseRefName: 'main',
    body: 'Closes #42',
    updatedAt: '2026-01-01T00:00:00Z',
    additions: 5,
    deletions: 2,
    changedFiles: 1,
    mergeable: 'MERGEABLE',
    repository: { nameWithOwner: 'orchard/sample' },
    closingIssuesReferences: { nodes: [] },
    commits: { nodes: [] },
  })
  pr.title = '在田间地图上添加采样点'
  pr.checks = 'SUCCESS'
  pr.sha = 'a'.repeat(40)
  if (['warnings', 'danger', 'progress'].includes(state || '')) {
    pr.draft = true
    pr.checks = null
    pr.base = 'spring-survey'
    pr.additions = 5012
  }
  if (state === 'danger') pr.title = '仅供测试 · 请勿合并田间读数'
  if (state === 'conflict') pr.mergeable = 'CONFLICTING'
  pr.updated = new Date(Date.now() - 2300000).toISOString()
  const data: Snapshot = {
    demo: true,
    computers: [
      {
        key: 'local',
        name: '田间观测站',
        source: { ok: true, value: { bots: list, items: demoItems, workspaces: [] } },
      },
    ],
    prs: [
      pr,
      {
        ...pr,
        number: 2,
        url: pr.url.replace(/1$/, '2'),
        title: '更新浇水日程',
        head: 'calendar',
        base: pr.head,
        draft: true,
        closes: [],
        mentions: [],
      },
    ],
    repos: {
      [pr.repo]: {
        ok: true,
        value: {
          push: state !== 'no-permission',
          defaultBranch: 'main',
          methods: ['squash', 'merge', 'rebase'],
        },
      },
    },
    merged: [],
    banner: null,
    total: 2,
    sources: { orca: { status: 'fresh', at: Date.now() }, github: { status: 'fresh', at: Date.now() } },
    prsAt: Date.now(),
    itemsAt: Date.now(),
    error: null,
    focus: false,
  }
  if (state !== 'empty') {
    for (const [number, title] of ['记录夏季调查结果', '导入历史读数', '修正调查范围'].entries()) {
      const n = number + 3
      data.prs.push({
        ...pr,
        number: n,
        title,
        head: 'survey-' + n,
        base: 'main',
        url: pr.url.replace(/1$/, String(n)),
        checks: n === 4 ? null : 'SUCCESS',
        additions: n === 4 ? 5012 : 5,
        mergeable: n === 5 ? 'CONFLICTING' : 'MERGEABLE',
        draft: false,
      })
    }
    const titles = [
      '记录田间调查的采样安排，并补充春季采样所用传感器的校准说明',
      '在田间笔记中保留 <details> 原文',
      '添加果园采样计划',
      '按地块显示水位',
      '验证观测站的读数',
      '汇总每日测量结果',
      '跟踪北区降雨量',
      '按距离排列观测站',
    ]
    for (let i = 0; i < (state === 'large' ? 120 : state === 'queue50' ? 50 : titles.length); i++) {
      const number = (state === 'large' ? 200 : 10) + i,
        head = 'station-' + number
      const title = titles[i] ?? '更新地块读数 #' + (i + 1)
      data.prs.push({
        ...pr,
        number,
        title,
        head,
        url: pr.url.replace(/1$/, String(number)),
        draft: false,
        checks: 'SUCCESS',
        base: 'main',
        mergeable: 'MERGEABLE',
      })
      const roster = data.computers[0]!.source
      if (roster.ok)
        roster.value.workspaces.push({
          computer: 'local',
          id: head,
          name: head,
          bot: list[i % list.length]!.name,
          repo: pr.repo,
          remote: null,
          path: null,
          branch: head,
          home: null,
        })
    }
    for (let i = 0; i < 42; i++)
      data.merged.push({
        ...pr,
        number: 100 + i,
        title: '记录地块观察结果 #' + (i + 1),
        url: pr.url.replace(/1$/, String(100 + i)),
        mergedAt: new Date().toISOString(),
      })
    if (state === 'large') {
      const roster = data.computers[0]!.source
      if (roster.ok) {
        for (let i = 0; i < 30; i++)
          roster.value.bots.push({ ...list[0]!, name: '田间机器人 ' + (i + 1), id: 'field-' + i })
        roster.value.workspaces.push({
          computer: 'local',
          id: 'history',
          name: 'history',
          bot: '田间机器人 30',
          repo: pr.repo,
          remote: null,
          path: null,
          branch: 'merged-survey',
          home: null,
        })
        data.merged[0]!.head = 'merged-survey'
      }
    }
    data.total = data.prs.length
    data.merged.push({
      ...pr,
      number: 6,
      title: '发布春季观测结果',
      url: pr.url.replace(/1$/, '6'),
      mergedAt: new Date().toISOString(),
    })
  }
  if (state === 'paired' || state === 'bot-warning') {
    const station = data.computers[0]!
    station.key = 'field-station'
    if (station.source.ok) {
      for (const row of [...station.source.value.bots, ...station.source.value.items]) row.computer = station.key
      if (state === 'bot-warning')
        station.source.value.bots[0]!.warning = {
          ok: false,
          command: 'orca bot work list',
          message: '执行任务列表不可用。',
          next: '请刷新后重试。',
        }
    }
    data.computers.unshift({
      key: 'local',
      name: '本机',
      source: { ok: true, value: { bots: [], items: [], workspaces: [] } },
    })
  }
  if (state === 'unreachable')
    data.computers.push({
      key: 'other',
      name: '温室',
      source: {
        ok: false,
        command: 'orca bot list',
        message: '连接超时。',
        next: '请重新连接设备后刷新看板。',
      },
    })
  if (state === 'signed-out') {
    data.prs = []
    data.sources.github = { status: 'failed', at: 0 }
    data.prsAt = 0
    data.total = 0
    data.banner = 'GitHub 未登录。请运行 gh auth login 后刷新看板。'
    data.error = {
      ok: false,
      command: 'gh api user',
      message: 'GitHub 未登录。',
      next: '请运行 gh auth login 后刷新看板。',
    }
  }
  return data
}

export async function demoMerge(
  pr: PullRequest,
  progress: (event: Progress) => void,
  onReady: () => void,
  fail: boolean,
): Promise<Source<null>> {
  const key = prKey(pr)
  for (const step of pr.draft ? (['ready', 'merge'] as const) : (['merge'] as const)) {
    progress({ key, step, state: 'running' })
    await new Promise((resolve) => setTimeout(resolve, 900))
    if (step === 'merge' && fail)
      return { ok: false, command: '演示', message: '必需的「田间调查」状态检查尚未完成。', next: '' }
    if (step === 'ready') onReady()
    progress({ key, step, state: 'done' })
  }
  return { ok: true, value: null }
}
