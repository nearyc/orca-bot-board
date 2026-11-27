import { button, el, notice } from './dom'

export function panel(title: string) {
  const dialog = el('dialog', '', 'merge-dialog controls')
  dialog.setAttribute('aria-label', title)
  dialog.append(
    el('h2', title),
    button('关闭', () => dialog.close()),
  )
  document.body.append(dialog)
  dialog.onclose = () => dialog.remove()
  dialog.showModal()
  return dialog
}

export function ask(title: string, value: string, submit: (text: string) => void) {
  const dialog = panel(title),
    form = el('form'),
    input = el('input')
  input.setAttribute('aria-label', title)
  input.value = value
  input.oninput = () => input.setCustomValidity('')
  input.required = true
  input.maxLength = 300
  const accept = el('button', '继续')
  form.append(input, accept)
  form.onsubmit = (e) => {
    e.preventDefault()
    if (!input.value.trim()) return
    try {
      submit(input.value.trim())
      dialog.close()
    } catch (error) {
      input.setCustomValidity(String(error))
      input.reportValidity()
      notice(error)
    }
  }
  dialog.append(form)
  input.select()
}
