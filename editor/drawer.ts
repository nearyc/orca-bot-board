import { itemStatusActions } from '../src/core/flags'
import { panelRequest } from './panel-request'
import { el, button, labels, notice, prPill, external, badge } from './dom'
import { age, prStats } from '../src/core/presentation'
import { showFiles } from './diff'
import { isClosed, itemKey, prKey, type Item, type MappedPr, type Workspace } from '../src/core/model'
export function drawers(openMerge: (p: MappedPr) => void, statusSelector: (i: Item) => HTMLElement) {
  const dialog = el('dialog'),
    body = el('section'),
    close = button('关闭', () => dialog.close())
  dialog.append(close, body)
  document.body.append(dialog)
  let origin: HTMLElement | null = null
  dialog.addEventListener('close', () => origin?.focus())
  dialog.onclick = (e) => {
    if (e.target === dialog && e.clientX < dialog.getBoundingClientRect().left) dialog.close()
  }
  function open(card: HTMLElement) {
    if (!dialog.open) {
      origin = card
      dialog.showModal()
    }
    body.replaceChildren()
    dialog.scrollTop = 0
  }
  function section(label: string, text: string | null) {
    if (text) body.append(el('h3', label), el('p', text))
  }
  function workspace(w: Workspace) {
    body.append(
      button('打开 ' + w.name, async () =>
        notice(await panelRequest('board.jump', { computer: w.computer, bot: w.bot, workspace: w.id })),
      ),
    )
  }
  function item(i: Item, prs: MappedPr[], trees: Workspace[], card: HTMLElement) {
    open(card)
    body.style.setProperty('--tone', 'var(--' + i.status + ')')
    body.append(
      badge(i.computer, i.bot),
      el('small', i.bot + ' · 任务 #' + i.number + ' · ' + age(i.updated)),
      el('h2', i.title),
      el('mark', labels[i.status]),
      ...(itemStatusActions && !isClosed(i.status) ? [statusSelector(i)] : []),
    )
    const answer = async () =>
      notice(await panelRequest('board.jump', { computer: i.computer, bot: i.bot, number: i.number }))
    if (i.status === 'needs_you') {
      section('问题', i.question)
      for (const opt of i.options) body.append(el('p', opt, 'option'))
      body.append(button('在 Orca 中回答', answer))
    }
    section('等待事项', i.wait)
    section('描述', i.description)
    section('完成标准', i.done)
    const report = i.workers.findLast((w) => w.subject || w.body)
    if (report) section('最新执行报告', [report.subject, report.body].filter(Boolean).join('\n'))
    if (i.workers.length) {
      body.append(el('h3', '执行者'))
      for (const w of i.workers) {
        const states: Record<string, string> = { working: '工作中', done: '已完成' }
        body.append(el('p', [w.title, w.state && (states[w.state] ?? w.state)].filter(Boolean).join(' · ')))
        const tree = trees.find(
          (t) => t.computer === i.computer && t.bot === i.bot && (w.workspace === t.id || w.workspace === t.name),
        )
        if (tree) workspace(tree)
      }
    }
    for (const p of prs.filter((p) => p.items.some((m) => itemKey(m) === itemKey(i))))
      body.append(button('查看差异 · ' + prKey(p), () => pr(p, card)))
    body.append(button('在 Orca 中打开聊天', answer))
    section('聊天', i.chat)
  }
  function pr(p: MappedPr, card: HTMLElement) {
    open(card)
    body.style.setProperty('--tone', 'var(--prs)')
    const match = p.items[0] ?? p.workspaces[0]
    if (match) body.append(badge(match.computer, match.bot), el('small', match.bot))
    body.append(
      el('small', prKey(p) + ' · ' + age(p.updated)),
      el('h2', p.title),
      prPill(p),
      el('p', prStats(p).diff, 'diff-counts'),
      button(
        '合并',
        () => {
          dialog.close()
          openMerge(p)
        },
        'merge-action',
      ),
      external('在 GitHub 查看文件', p.url + '/files'),
      external('在 GitHub 查看讨论', p.url),
    )
    section('依赖关系', p.behind ? '依赖 ' + p.behind : null)
    section('分支', p.head + ' → ' + p.base)
    section('关联关闭的问题', p.closes.map(prKey).join(', '))
    if (p.how)
      section(
        '匹配依据',
        {
          branch: '工作区分支与此拉取请求匹配。',
          item: '有任务引用了此拉取请求。',
          issue: '有任务引用了此拉取请求会关闭的问题。',
        }[p.how],
      )
    section('关联任务', p.items.map((i) => i.bot + ' #' + i.number + ' · ' + i.title).join('\n'))
    for (const w of p.workspaces) workspace(w)
    const files = el('div')
    body.append(el('h3', '改动'), files)
    void showFiles(files, p)
  }
  return { item, pr }
}
