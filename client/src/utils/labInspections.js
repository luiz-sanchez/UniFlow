// Fluxos → Vistoria de Laboratórios: textos e formatos usados nas duas telas
// (LabInspectionsPage e LabInspectionRunPage). Servidor: routes/labInspections.js.
export const BUILDINGS = { sede: 'SEDE', centro: 'CENTRO', g5: 'G5' }

export const ANSWERS = {
  conforme: { label: 'Conforme', short: 'OK', icon: 'check' },
  nao_conforme: { label: 'Não conforme', short: 'Problema', icon: 'close' },
  na: { label: 'Não se aplica', short: 'N/A', icon: 'minus' },
}

export const ITEM_ICONS = ['monitor', 'keyboard', 'link', 'wifi', 'tv', 'fan', 'lightbulb', 'chair', 'broom', 'laptop', 'phone', 'lock', 'shield', 'wrench', 'pin', 'check']

// datas do D1 vêm em UTC sem "Z"
export const dbDate = v => (v ? new Date(/Z$/.test(v) ? v : v.replace(' ', 'T') + 'Z') : null)

export function fmtWhen(v) {
  const d = dbDate(v)
  if (!d) return '—'
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const diff = Math.round((today - day) / 86400000)
  if (diff === 0) return `hoje, ${time}`
  if (diff === 1) return `ontem, ${time}`
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })}, ${time}`
}

export function agoText(v) {
  const d = dbDate(v)
  if (!d) return null
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'hoje'
  if (days === 1) return 'ontem'
  if (days < 30) return `há ${days} dias`
  const months = Math.floor(days / 30)
  return months === 1 ? 'há 1 mês' : `há ${months} meses`
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// A vistoria é DIÁRIA: o "dia" é sempre o de Brasília (UTC−3 o ano todo),
// igual ao servidor (`date(finished_at, '-3 hours')`).
export const brDay = (offset = 0) => new Date(Date.now() - 3 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10)

export const timeOf = v => dbDate(v)?.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) || ''

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
// "2026-11-18" → { wd: 'qua', dm: '18/11', weekend: false }
export function dayParts(iso) {
  const d = new Date(iso + 'T12:00:00Z')
  const w = d.getUTCDay()
  return { wd: WEEKDAYS[w], dm: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`, weekend: w === 0 || w === 6 }
}
