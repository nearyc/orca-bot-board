import { prStats } from '../src/core/presentation'
import { panelRequest } from './panel-request'
import {
  mergeableLabel,
  type Warning,
  methodLabels,
  type MergePreferences,
  assessMerge,
  type MergeMethod,
} from '../src/core/merge'
import { prKey, type MappedPr } from '../src/core/model'
import { el, button, describeFailure, notice } from './dom'

export function mergeDialog(saved: MergePreferences, update: () => void) {
  const modal = el('dialog', '', 'merge-dialog')
  modal.setAttribute('aria-label', '确认合并拉取请求')
  document.body.append(modal)
  let active = '',
    busy = false

  modal.oncancel = (e) => {
    if (busy) e.preventDefault()
  }
  modal.onclick = (e) => {
    const rect = modal.getBoundingClientRect()
    if (
      !busy &&
      e.target === modal &&
      (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)
    )
      modal.close()
  }
  return async (
    pr: MappedPr,
    closing = false,
    chosen?: (method: MergeMethod, warnings: Warning[], live: MappedPr) => void,
    dismiss?: () => void,
  ) => {
    if (modal.open) {
      dismiss?.()
      return
    }
    modal.onclose = () => dismiss?.()
    active = prKey(pr)

    const actions = el('footer'),
      cancel = button('取消', () => modal.close()),
      summary = el('div', '', 'merge-facts')
    actions.append(cancel)
    modal.replaceChildren(el('small', active), el('h2', pr.title), summary, actions)
    modal.showModal()
    modal.setAttribute('aria-label', closing ? '确认关闭拉取请求' : '确认合并拉取请求')
    if (closing) {
      modal.replaceChildren(el('h2', `关闭 ${active} 而不合并？`), actions)
      actions.append(
        button(
          '关闭拉取请求',
          async () => {
            if (busy) return
            busy = true
            actions.inert = true
            try {
              const result = await panelRequest('pr.close', { repo: pr.repo, number: pr.number })
              if (!result.ok) notice(describeFailure(result))
            } finally {
              busy = false
              actions.inert = false
              modal.close()
            }
          },
          'confirm danger',
        ),
      )
      return
    }
    summary.textContent = '正在读取拉取请求…'
    const read = await panelRequest(
      'pr.read',
      { repo: pr.repo, number: pr.number, prOnly: true },
      { timeoutMs: 120000 },
    ).catch((error: unknown) => {
      summary.textContent = `无法读取拉取请求。详情：${String(error)}`
      return null
    })
    if (!read || !modal.open || !modal.contains(summary)) return
    if (!read.ok) {
      summary.textContent = describeFailure(read)
      return
    }
    const live = read.value
    if (live.closed || live.merged) {
      summary.textContent = live.merged ? '此拉取请求已合并。' : '此拉取请求已关闭。'
      return
    }
    pr = { ...pr, ...live.pr, sha: live.pr.sha, behind: live.pr.behind }
    const facts = live.facts
    summary.replaceChildren()
    if (pr.behind) summary.append(el('p', `未按依赖顺序合并 · ${pr.behind} 仍未关闭。`, 'warning'))
    if (!facts?.ok || !pr.sha) {
      summary.append(el('p', facts && !facts.ok ? describeFailure(facts) : '无法获取合并信息，请刷新看板。'))
      return
    }
    const { diff, check } = prStats(pr)
    const assessment = assessMerge(pr, facts.value)
    summary.append(
      el('p', pr.head + ' → ' + pr.base),
      el('p', [mergeableLabel(pr.mergeable), check, diff].filter(Boolean).join(' · ')),
    )
    for (const w of assessment.warnings) summary.append(el('p', w.text, w.danger ? 'warning danger' : 'warning'))
    for (const blocker of assessment.blockers) summary.append(el('p', blocker, 'warning'))
    if (!assessment.canMerge) return
    const select = el('select'),
      label = el('label', '合并方式 ')
    for (const m of assessment.methods) {
      const opt = el('option', methodLabels[m])
      opt.selected = m === saved.mergeMethod
      opt.value = m
      select.append(opt)
    }
    label.append(select)
    summary.append(label)
    if (!assessment.methods.includes(saved.mergeMethod))
      summary.append(el('p', `仓库不支持「${methodLabels[saved.mergeMethod]}」，请选择其他方式。`, 'warning'))
    const skip = el('label', '', 'skip'),
      checkbox = el('input')
    checkbox.type = 'checkbox'
    skip.append(checkbox, '没有警告的拉取请求不再询问')
    summary.append(skip)
    actions.append(
      button(
        '确认合并',
        () => {
          modal.onclose = null
          modal.close()
          if (checkbox.checked) {
            saved.askBeforeMerging = false
            update()
          }
          chosen?.(select.value as MergeMethod, assessment.warnings, pr)
        },
        assessment.warnings.some((w) => w.danger) ? 'confirm danger' : 'confirm',
      ),
    )
  }
}
