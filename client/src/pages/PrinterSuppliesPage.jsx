import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { exportPrinterSuppliesXlsx } from '../utils/exports'
import ExportXlsxButton from '../components/common/ExportXlsxButton'
import Modal from '../components/common/Modal'
import LineIcon from '../components/common/LineIcon'
import RowMenu from '../components/common/RowMenu'
import s from './PrinterSuppliesPage.module.css'

// Impressoras → Estoque de insumos: saldo POR PRÉDIO de toner, cilindro, tinta…
// Cada troca fica ligada à impressora (dá o consumo e a previsão de quando
// acaba). Servidor: server/src/routes/printerSupplies.js.

export const SUPPLY_LOCATIONS = [
  { key: 'sede', label: 'SEDE' }, { key: 'adm', label: 'ADM' }, { key: 'centro', label: 'CENTRO' },
  { key: 'g5', label: 'G5' }, { key: 'clinicas', label: 'CLÍNICAS' },
]
const LOC_LABEL = Object.fromEntries(SUPPLY_LOCATIONS.map(l => [l.key, l.label]))
export const SUPPLY_TYPES = {
  toner: 'Toner', cilindro: 'Cilindro / fotocondutor', tinta: 'Tinta (garrafa)', cartucho: 'Cartucho',
  fusor: 'Fusor', residuo: 'Caixa de resíduo', kit: 'Kit de manutenção', outro: 'Outro',
}
const COLORS = { '': '—', preto: 'Preto', ciano: 'Ciano', magenta: 'Magenta', amarelo: 'Amarelo', colorido: 'Colorido' }
const COLOR_DOT = { preto: '#111827', ciano: '#06B6D4', magenta: '#DB2777', amarelo: '#EAB308', colorido: 'conic-gradient(#06B6D4, #DB2777, #EAB308, #06B6D4)' }
const KIND_LABEL = {
  entrada: 'Entrada', troca: 'Troca', transferencia_saida: 'Transferido para', transferencia_entrada: 'Recebido de', ajuste: 'Ajuste',
}

const pad = n => String(n).padStart(2, '0')
const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }
export const fmtWhen = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '—' }

// Consumo por mês (trocas dos últimos 90 dias ÷ 3) e quantos meses o saldo dura
function forecast(supply, loc) {
  const used = supply.usage90?.[loc] || 0
  const perMonth = used / 3
  const qty = supply.stocks?.[loc]?.quantity || 0
  return { perMonth, months: perMonth > 0 ? qty / perMonth : null }
}
// insumo "deste prédio": tem saldo, mínimo ou troca recente aqui (o resto do catálogo fica recolhido)
const isHere = (supply, loc) => { const st = supply.stocks?.[loc]; return !!st && (st.quantity > 0 || st.min_quantity > 0 || (supply.usage90?.[loc] || 0) > 0) }
const isLow = (supply, loc) => { const st = supply.stocks?.[loc]; return !!st && st.min_quantity > 0 && st.quantity <= st.min_quantity }

function ColorDot({ color }) {
  if (!color) return null
  return <span className={s.colorDot} style={{ background: COLOR_DOT[color] }} title={COLORS[color]} />
}

// ── Cadastro do insumo ─────────────────────────────────────────────────────
function SupplyEditor({ supply, knownModels, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: supply?.name || '', code: supply?.code || '', type: supply?.type || 'toner', color: supply?.color || '',
    notes: supply?.notes || '', models: supply?.models || [],
    minimums: Object.fromEntries(SUPPLY_LOCATIONS.map(l => [l.key, supply?.stocks?.[l.key]?.min_quantity ?? 0])),
  })
  const [newModel, setNewModel] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggleModel = m => set('models', form.models.includes(m) ? form.models.filter(x => x !== m) : [...form.models, m])
  const allModels = [...new Set([...knownModels, ...form.models])].sort((a, b) => a.localeCompare(b, 'pt-BR'))

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true); setError('')
    try {
      const { data } = supply ? await api.put(`/printer-supplies/${supply.id}`, form) : await api.post('/printer-supplies', form)
      onSaved(data)
    } catch (e) { setError(e.response?.data?.error || 'Erro ao salvar.'); setSaving(false) }
  }

  return (
    <Modal title={supply ? 'Editar insumo' : 'Novo insumo'} onClose={onClose} width={620}>
      <div className="form-group">
        <label htmlFor="printer-supplies-nome" className="label">Nome *</label>
        <input id="printer-supplies-nome" autoFocus value={form.name} maxLength={120} onChange={e => set('name', e.target.value)} placeholder="Ex: Toner Ricoh SP 377 preto" />
      </div>
      <div className={s.formGrid3}>
        <div className="form-group">
          <label htmlFor="printer-supplies-tipo" className="label">Tipo</label>
          <select id="printer-supplies-tipo" value={form.type} onChange={e => set('type', e.target.value)}>
            {Object.entries(SUPPLY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="printer-supplies-cor" className="label">Cor</label>
          <select id="printer-supplies-cor" value={form.color} onChange={e => set('color', e.target.value)}>
            {Object.entries(COLORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="printer-supplies-codigo-part-number" className="label">Código / part number</label>
          <input id="printer-supplies-codigo-part-number" value={form.code} maxLength={60} onChange={e => set('code', e.target.value)} placeholder="Ex: 408161" />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Serve nas impressoras (modelos)</label>
        <div className={s.modelChips}>
          {allModels.map(m => (
            <button key={m} type="button" className={`${s.modelChip} ${form.models.includes(m) ? s.modelChipOn : ''}`} onClick={() => toggleModel(m)}>
              {form.models.includes(m) ? '✓ ' : ''}{m}
            </button>
          ))}
        </div>
        <div className={s.inlineRow}>
          <input value={newModel} onChange={e => setNewModel(e.target.value)} placeholder="Outro modelo…" onKeyDown={e => { if (e.key === 'Enter' && newModel.trim()) { set('models', [...form.models, newModel.trim()]); setNewModel('') } }} />
          <button type="button" className="btn btn-ghost btn-sm" disabled={!newModel.trim()} onClick={() => { set('models', [...form.models, newModel.trim()]); setNewModel('') }}>+ Adicionar</button>
        </div>
      </div>
      <div className="form-group">
        <label className="label">Estoque mínimo por prédio (avisa quando chegar nele)</label>
        <div className={s.minGrid}>
          {SUPPLY_LOCATIONS.map(l => (
            <label key={l.key} className={s.minCell}>
              <span>{l.label}</span>
              <input type="number" min={0} max={10000} value={form.minimums[l.key]} onChange={e => set('minimums', { ...form.minimums, [l.key]: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })} />
            </label>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="printer-supplies-observacoes" className="label">Observações</label>
        <textarea id="printer-supplies-observacoes" rows={2} value={form.notes} maxLength={1000} onChange={e => set('notes', e.target.value)} placeholder="Fornecedor, rendimento (páginas), onde fica guardado…" />
      </div>
      {error && <p role="alert" className={s.error}>{error}</p>}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!form.name.trim() || saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar'}</button>
    </Modal>
  )
}

// ── Detalhes da entrada (fornecedor, nota fiscal, valor) ───────────────────
const brl = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const parseMoney = v => {
  const t = String(v ?? '').replace(/\s|R\$/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  return t === '' ? null : Number(t)
}
// "Fornecedor X · NF 1234 · R$ 60,00 cada (R$ 300,00)" — o que a entrada diz
export function entryDetail(m) {
  const parts = []
  if (m.supplier) parts.push(m.supplier)
  if (m.invoice) parts.push(`NF ${m.invoice}`)
  if (m.unit_cost != null) parts.push(`${brl(m.unit_cost)} cada${m.delta > 1 ? ` (${brl(m.unit_cost * m.delta)})` : ''}`)
  return parts.join(' · ')
}

let suppliersCache = null
function useSuppliers() {
  const [list, setList] = useState(suppliersCache || [])
  useEffect(() => {
    if (suppliersCache) return
    api.get('/printer-supplies/suppliers').then(r => { suppliersCache = r.data || []; setList(suppliersCache) }).catch(() => {})
  }, [])
  return list
}

function EntryFields({ form, set, qty }) {
  const suppliers = useSuppliers()
  const unit = parseMoney(form.unit_cost)
  const badUnit = unit != null && !(Number.isFinite(unit) && unit >= 0)
  return (
    <>
      <div className={s.formGrid2}>
        <div className="form-group">
          <label htmlFor="supply-entry-supplier" className="label">Fornecedor</label>
          <input id="supply-entry-supplier" list="supply-entry-suppliers" value={form.supplier} maxLength={120} onChange={e => set('supplier', e.target.value)} placeholder="De quem veio" autoComplete="off" />
          <datalist id="supply-entry-suppliers">{suppliers.map(n => <option key={n} value={n} />)}</datalist>
        </div>
        <div className="form-group">
          <label htmlFor="supply-entry-invoice" className="label">Nota fiscal ou pedido</label>
          <input id="supply-entry-invoice" value={form.invoice} maxLength={60} onChange={e => set('invoice', e.target.value)} placeholder="Ex: 001234" />
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="supply-entry-unit" className="label">Valor por unidade (R$)</label>
        <input id="supply-entry-unit" inputMode="decimal" value={form.unit_cost} onChange={e => set('unit_cost', e.target.value)} placeholder="Ex: 189,90" aria-describedby="supply-entry-total" />
        <p id="supply-entry-total" className={badUnit ? s.error : s.hint} role={badUnit ? 'alert' : undefined}>
          {badUnit ? 'Digite só o valor, ex: 189,90.' : unit != null && qty > 0 ? `Total da entrada: ${brl(unit * qty)} (${qty} × ${brl(unit)})` : 'Opcional. Com o valor, o histórico mostra quanto custou a entrada.'}
        </p>
      </div>
    </>
  )
}
const entryValid = form => { const u = parseMoney(form.unit_cost); return u == null || (Number.isFinite(u) && u >= 0) }

// Completar uma entrada (ou a observação de outro movimento) já registrada
function MovementDetailsModal({ movement, onClose, onSaved }) {
  const isEntry = movement.kind === 'entrada'
  const [form, setForm] = useState({
    supplier: movement.supplier || '', invoice: movement.invoice || '',
    unit_cost: movement.unit_cost != null ? String(movement.unit_cost).replace('.', ',') : '', note: movement.note || '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const save = async () => {
    setSaving(true); setError('')
    try { onSaved((await api.patch(`/printer-supplies/movements/${movement.id}`, form)).data) }
    catch (e) { setError(e.response?.data?.error || 'Erro ao salvar.'); setSaving(false) }
  }
  return (
    <Modal title={isEntry ? 'Detalhes da entrada' : 'Observação do movimento'} onClose={onClose} width={520}>
      <p className={s.moveHead}>{KIND_LABEL[movement.kind]} de <strong>{Math.abs(movement.delta)}</strong> em {fmtWhen(movement.happened_at)}. A quantidade não muda aqui; se ela estiver errada, registre um ajuste.</p>
      {isEntry && <EntryFields form={form} set={set} qty={movement.delta} />}
      <div className="form-group">
        <label htmlFor="supply-mov-note" className="label">Observação</label>
        <input id="supply-mov-note" value={form.note} maxLength={500} onChange={e => set('note', e.target.value)} placeholder="Opcional" />
      </div>
      {error && <p role="alert" className={s.error}>{error}</p>}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={saving || !entryValid(form)} onClick={save}>{saving ? 'Salvando…' : 'Salvar detalhes'}</button>
    </Modal>
  )
}

// ── Movimento (entrada, troca, transferência, ajuste) ──────────────────────
const MOVE_TITLES = { entrada: 'Entrada no estoque', troca: 'Troca na impressora', transferencia: 'Transferir para outro prédio', ajuste: 'Ajustar saldo (contagem)' }

function MovementModal({ supply, location, kind, printers, onClose, onSaved }) {
  const current = supply.stocks?.[location]?.quantity || 0
  const here = printers.filter(p => p.location === location)
  const norm = m => String(m || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const fits = p => supply.models.some(m => norm(m) === norm(p.model))
  const compatible = here.filter(fits)
  const others = here.filter(p => !fits(p))
  const [form, setForm] = useState({
    quantity: kind === 'ajuste' ? current : 1,
    printer_id: compatible.length === 1 ? compatible[0].id : '',
    to_location: SUPPLY_LOCATIONS.find(l => l.key !== location)?.key,
    happened_at: nowLocal(), note: '', supplier: '', invoice: '', unit_cost: '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const qty = Number(form.quantity)
  const tooMuch = (kind === 'troca' || kind === 'transferencia') && qty > current
  const valid = Number.isInteger(qty) && qty >= (kind === 'ajuste' ? 0 : 1) && !tooMuch && (kind !== 'troca' || form.printer_id) && (kind !== 'entrada' || entryValid(form))

  const save = async () => {
    setSaving(true); setError('')
    try {
      const { data } = await api.post(`/printer-supplies/${supply.id}/movements`, { kind, location, ...form, quantity: qty })
      if (kind === 'entrada' && form.supplier.trim()) suppliersCache = null
      onSaved(data)
    } catch (e) { setError(e.response?.data?.error || 'Erro ao registrar.'); setSaving(false) }
  }
  const printerLabel = p => `${p.model}${p.department ? ` — ${p.department}` : ''}${p.ip ? ` (${p.ip})` : ''}`

  return (
    <Modal title={MOVE_TITLES[kind]} onClose={onClose} width={520}>
      <p className={s.moveHead}><ColorDot color={supply.color} /> <strong>{supply.name}</strong> · {LOC_LABEL[location]} · saldo atual <strong>{current}</strong></p>
      {kind === 'troca' && (
        <div className="form-group">
          <label htmlFor="printer-supplies-em-qual-impressora" className="label">Em qual impressora? *</label>
          <select id="printer-supplies-em-qual-impressora" value={form.printer_id} onChange={e => set('printer_id', e.target.value)}>
            <option value="">Escolha a impressora…</option>
            {compatible.length > 0 && <optgroup label="Compatíveis com este insumo">{compatible.map(p => <option key={p.id} value={p.id}>{printerLabel(p)}</option>)}</optgroup>}
            {others.length > 0 && <optgroup label={compatible.length ? 'Outras deste prédio' : 'Impressoras deste prédio'}>{others.map(p => <option key={p.id} value={p.id}>{printerLabel(p)}</option>)}</optgroup>}
          </select>
          {here.length === 0 && <p className={s.hint}>Nenhuma impressora cadastrada em {LOC_LABEL[location]}.</p>}
        </div>
      )}
      {kind === 'transferencia' && (
        <div className="form-group">
          <label htmlFor="printer-supplies-para-qual-predio" className="label">Para qual prédio?</label>
          <select id="printer-supplies-para-qual-predio" value={form.to_location} onChange={e => set('to_location', e.target.value)}>
            {SUPPLY_LOCATIONS.filter(l => l.key !== location).map(l => <option key={l.key} value={l.key}>{l.label} (saldo {supply.stocks?.[l.key]?.quantity || 0})</option>)}
          </select>
        </div>
      )}
      <div className={s.formGrid2}>
        <div className="form-group">
          <label htmlFor="printer-supplies-campo" className="label">{kind === 'ajuste' ? 'Quantidade contada (saldo real)' : 'Quantidade'}</label>
          <input id="printer-supplies-campo" type="number" min={kind === 'ajuste' ? 0 : 1} max={10000} value={form.quantity} onChange={e => set('quantity', e.target.value)} />
          {tooMuch && <p role="alert" className={s.error}>Só tem {current} em {LOC_LABEL[location]}.</p>}
        </div>
        <div className="form-group">
          <label htmlFor="printer-supplies-quando" className="label">Quando</label>
          <input id="printer-supplies-quando" type="datetime-local" value={form.happened_at} onChange={e => set('happened_at', e.target.value)} />
        </div>
      </div>
      {kind === 'entrada' && <EntryFields form={form} set={set} qty={qty} />}
      <div className="form-group">
        <label htmlFor="printer-supplies-observacao" className="label">Observação</label>
        <input id="printer-supplies-observacao" value={form.note} maxLength={500} onChange={e => set('note', e.target.value)} placeholder={kind === 'entrada' ? 'Opcional. Ex: veio com 1 caixa amassada' : kind === 'troca' ? 'Ex: contador 45.210 páginas, chamado #123' : 'Opcional'} />
      </div>
      {error && <p role="alert" className={s.error}>{error}</p>}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!valid || saving} onClick={save}>{saving ? 'Registrando…' : 'Registrar'}</button>
    </Modal>
  )
}

// ── Histórico do item no prédio ────────────────────────────────────────────
function HistoryModal({ supply, location, canChange, onClose }) {
  const [rows, setRows] = useState(null)
  const [editing, setEditing] = useState(null)
  useEffect(() => { api.get(`/printer-supplies/${supply.id}/movements`, { params: { location } }).then(r => setRows(r.data || [])).catch(() => setRows([])) }, [supply.id, location])
  const missing = (rows || []).filter(m => m.kind === 'entrada' && !m.supplier && !m.invoice && m.unit_cost == null).length
  // uma janela por vez (o Esc fecharia as duas): os detalhes tomam o lugar do
  // histórico e, ao salvar ou fechar, o histórico volta já atualizado
  if (editing) {
    return (
      <MovementDetailsModal
        movement={editing}
        onClose={() => setEditing(null)}
        onSaved={saved => { suppliersCache = null; setRows(rs => rs.map(r => (r.id === saved.id ? { ...r, ...saved } : r))); setEditing(null) }}
      />
    )
  }
  return (
    <Modal title={`Histórico — ${supply.name} (${LOC_LABEL[location]})`} onClose={onClose} width={760}>
      {!rows ? <p className={s.hint}>Carregando…</p> : rows.length === 0 ? <p className={s.hint}>Nenhuma movimentação ainda neste prédio.</p> : (
        <>
          {missing > 0 && (
            <p className={s.histNotice}>{missing === 1 ? '1 entrada está' : `${missing} entradas estão`} sem fornecedor, nota fiscal ou valor.{canChange ? ' Use "Completar" na linha para preencher.' : ''}</p>
          )}
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th>Quando</th><th>Movimento</th><th>Qtd</th><th>Saldo</th><th>Detalhes</th><th>Quem</th><th><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {rows.map(m => {
                  const detail = m.kind === 'entrada' ? entryDetail(m)
                    : m.printer_model ? `${m.printer_model}${m.printer_department ? ` — ${m.printer_department}` : ''}${m.printer_ip ? ` (${m.printer_ip})` : ''}` : ''
                  const incomplete = m.kind === 'entrada' && !detail
                  return (
                    <tr key={m.id}>
                      <td className={s.mono}>{fmtWhen(m.happened_at)}</td>
                      <td>{KIND_LABEL[m.kind] || m.kind}{m.related_location ? ` ${LOC_LABEL[m.related_location]}` : ''}</td>
                      <td className={m.delta < 0 ? s.neg : s.pos}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                      <td className={s.mono}>{m.balance_after}</td>
                      <td>
                        {incomplete ? <span className={s.histMissing}>Sem fornecedor, NF ou valor</span> : detail}
                        {m.note ? <span className={s.histNote}>{m.note}</span> : null}
                      </td>
                      <td>{m.user_name || '—'}</td>
                      <td className={s.histAction}>
                        {canChange(m) && (
                          <button type="button" className={`btn btn-ghost btn-sm ${s.histBtn}`} onClick={() => setEditing(m)}>
                            {incomplete ? 'Completar' : 'Editar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  )
}

export default function PrinterSuppliesPage() {
  // endereço digitado em maiúsculas (/SEDE) ou prédio que não existe: cai no
  // prédio certo em vez de quebrar a tela
  const { location: rawLoc = 'sede' } = useParams()
  const location = LOC_LABEL[rawLoc.toLowerCase()] ? rawLoc.toLowerCase() : 'sede'
  const { user } = useAuthStore()
  const [supplies, setSupplies] = useState(null)
  const [printers, setPrinters] = useState([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [showCatalog, setShowCatalog] = useState(false)
  const [editing, setEditing] = useState(null) // null | {} | supply
  const [moving, setMoving] = useState(null) // { supply, kind }
  const [history, setHistory] = useState(null) // supply
  const writable = canEditModule(user, 'printers')

  const load = () => api.get('/printer-supplies').then(r => setSupplies(r.data || [])).catch(() => setSupplies(prev => prev || []))
  useEffect(() => { load(); api.get('/printers').then(r => setPrinters(r.data || [])).catch(() => {}) }, [])
  useLiveRefresh(['printer-supplies'], () => load())

  const knownModels = useMemo(() => [...new Set(printers.map(p => p.model.replace(/\s+/g, ' ').trim()))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [printers])
  const lowByLoc = useMemo(() => Object.fromEntries(SUPPLY_LOCATIONS.map(l => [l.key, (supplies || []).filter(sp => isLow(sp, l.key)).length])), [supplies])
  useEffect(() => { setShowCatalog(false) }, [location])
  const { filtered, hiddenCount } = useMemo(() => {
    const q = search.trim().toLowerCase()
    const match = (supplies || []).filter(sp => {
      if (typeFilter && sp.type !== typeFilter) return false
      if (onlyLow && !isLow(sp, location)) return false
      if (q && ![sp.name, sp.code, sp.notes, ...sp.models].some(v => (v || '').toLowerCase().includes(q))) return false
      return true
    })
    // buscando, mostra o catálogo todo (é assim que se acha um insumo pra dar a 1ª entrada aqui)
    if (showCatalog || q) return { filtered: match, hiddenCount: 0 }
    const here = match.filter(sp => isHere(sp, location))
    return { filtered: here, hiddenCount: match.length - here.length }
  }, [supplies, search, typeFilter, onlyLow, location, showCatalog])
  const stats = useMemo(() => {
    const list = supplies || []
    return {
      units: list.reduce((a, sp) => a + (sp.stocks?.[location]?.quantity || 0), 0),
      low: lowByLoc[location] || 0,
      swaps: list.reduce((a, sp) => a + (sp.usage90?.[location] || 0), 0),
      items: list.filter(sp => isHere(sp, location)).length,
    }
  }, [supplies, location, lowByLoc])

  const upsert = sp => setSupplies(prev => (prev || []).some(x => x.id === sp.id) ? prev.map(x => (x.id === sp.id ? sp : x)) : [...(prev || []), sp])
  const remove = async sp => {
    if (!(await confirmDialog(`Remover "${sp.name}" do catálogo? Se já tiver histórico, ele é só desativado (o histórico fica).`, { title: 'Remover insumo' }))) return
    try { await api.delete(`/printer-supplies/${sp.id}`); setSupplies(prev => prev.filter(x => x.id !== sp.id)) }
    catch (e) { await alertDialog(e.response?.data?.error || 'Erro ao remover.', { title: 'Erro', danger: true }) }
  }

  if (!supplies) return <div className={s.loading}>Carregando estoque…</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Estoque de insumos</h1>
          <p className={s.sub}>Saldo de toner, cilindro e tinta por prédio. Cada troca fica ligada à impressora e dá a previsão de quando acaba.</p>
        </div>
        <div className={s.headerActions}>
          <Link className="btn btn-ghost" to={`/impressoras/${location}`}><LineIcon name="chevronLeft" size={15} /> Impressoras</Link>
          <ExportXlsxButton onExport={() => exportPrinterSuppliesXlsx()} />
          {writable && <button className="btn btn-primary" onClick={() => setEditing({})}><LineIcon name="plus" size={15} /> Novo insumo</button>}
        </div>
      </div>

      <nav className={s.tabs} aria-label="Prédios">
        {SUPPLY_LOCATIONS.map(l => (
          <Link key={l.key} to={`/estoque-insumos/${l.key}`} aria-current={l.key === location ? 'page' : undefined}
            className={`${s.tab} ${l.key === location ? s.tabOn : ''}`}>
            {l.label}
            {lowByLoc[l.key] ? <span className={s.tabBadge} title={`${lowByLoc[l.key]} no mínimo ou abaixo`}>{lowByLoc[l.key]}<span className="sr-only"> no mínimo ou abaixo</span></span> : null}
          </Link>
        ))}
      </nav>

      <div className={s.stats}>
        <div className={s.stat}><strong>{stats.units}</strong><span>Unidades em estoque</span></div>
        <button type="button" className={`${s.stat} ${s.statButton} ${stats.low ? s.statWarn : ''} ${onlyLow ? s.statOn : ''}`} aria-pressed={onlyLow} onClick={() => setOnlyLow(v => !v)}>
          <strong>{stats.low}</strong><span>{onlyLow ? 'Mostrando só estes' : 'No mínimo ou abaixo'}</span>
        </button>
        <div className={s.stat}><strong>{stats.swaps}</strong><span>Trocas nos últimos 90 dias</span></div>
        <div className={s.stat}><strong>{stats.items}</strong><span>Insumos neste prédio</span></div>
      </div>

      <div className={s.toolbar}>
        <label className={s.search}>
          <LineIcon name="search" size={15} />
          <span className="sr-only">Buscar insumos</span>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por insumo, código ou modelo de impressora" />
        </label>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="Tipo de insumo">
          <option value="">Todos os tipos</option>
          {Object.entries(SUPPLY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className={s.check}><input type="checkbox" checked={onlyLow} onChange={e => setOnlyLow(e.target.checked)} /> Só no mínimo ou abaixo</label>
      </div>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h3>{!supplies.length ? 'Nenhum insumo cadastrado ainda' : hiddenCount ? `Nenhum insumo em ${LOC_LABEL[location]} ainda` : 'Nada com esse filtro'}</h3>
          {hiddenCount > 0 && <p>Para começar a controlar aqui, abra o catálogo e dê a primeira entrada.</p>}
          {hiddenCount > 0 && <button type="button" className="btn btn-ghost" onClick={() => setShowCatalog(true)}>Mostrar o catálogo ({hiddenCount})</button>}
          <p hidden={!!hiddenCount}>{supplies.length ? 'Mude o filtro ou a busca.' : 'Cadastre os insumos (toner, cilindro, tinta...) com os modelos em que servem e o estoque mínimo de cada prédio. Depois é só dar entrada e registrar as trocas.'}</p>
        </div>
      ) : (
        <div className={s.tableCard}>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr><th>Insumo</th><th>Tipo</th><th>Serve em</th><th className={s.num}>Saldo</th><th className={s.num}>Mínimo</th><th className={s.num}>Consumo/mês</th><th className={s.num}>Dura</th><th className={s.actionsCol}><span className="sr-only">Ações</span></th></tr>
              </thead>
              <tbody>
                {filtered.map(sp => {
                  const st = sp.stocks[location]
                  const low = isLow(sp, location)
                  const f = forecast(sp, location)
                  return (
                    <tr key={sp.id}>
                      <td className={s.supplyCell}>
                        <div className={s.supplyName}><ColorDot color={sp.color} />{sp.name}</div>
                        <div className={s.supplyMeta}>{sp.code && `Cód. ${sp.code}`}</div>
                      </td>
                      <td className={s.typeCell} data-label="Tipo">{SUPPLY_TYPES[sp.type] || sp.type}</td>
                      <td className={s.modelsCell} data-label="Serve em" title={sp.models.join(', ')}>{sp.models.length ? sp.models.join(', ') : <span className={s.muted}>—</span>}</td>
                      <td className={`${s.num} ${s.qty} ${s.qtyCell} ${low ? s.qtyLow : ''}`} data-label="Saldo">{low && <span className={s.lowDot} aria-hidden="true" />}{st.quantity}{low && <span className="sr-only"> (no mínimo ou abaixo)</span>}</td>
                      <td className={`${s.num} ${s.muted}`} data-label="Mínimo">{st.min_quantity || '—'}</td>
                      <td className={`${s.num} ${s.muted}`} data-label="Consumo/mês">{f.perMonth ? f.perMonth.toFixed(1).replace('.', ',') : '—'}</td>
                      <td className={`${s.num} ${f.months != null && f.months < 1 ? s.qtyLow : s.muted}`} title="Saldo ÷ consumo médio dos últimos 90 dias" data-label="Dura">
                        {f.months == null ? '—' : f.months < 1
                          ? (d => `~${d} ${d === 1 ? 'dia' : 'dias'}`)(Math.max(1, Math.round(f.months * 30)))
                          : `~${f.months.toFixed(1).replace('.', ',')} ${f.months.toFixed(1) === '1.0' ? 'mês' : 'meses'}`}
                      </td>
                      <td className={s.actionsCell}>
                        <div className={s.actions}>
                          {writable && <>
                            {st.quantity ? (
                              <button type="button" className={s.actBtn} onClick={() => setMoving({ supply: sp, kind: 'troca' })} title="Registrar a troca numa impressora">
                                <LineIcon name="refresh" size={14} /> Trocar
                              </button>
                            ) : (
                              <span className={s.noStock} title="Não há este insumo neste prédio: registre uma entrada">Sem saldo</span>
                            )}
                            <button type="button" className={`${s.actBtn} ${!st.quantity ? s.actBtnMain : ''}`} onClick={() => setMoving({ supply: sp, kind: 'entrada' })} title="Compra ou recebimento">
                              <LineIcon name="plus" size={14} /> Entrada
                            </button>
                          </>}
                          <RowMenu name={sp.name} items={[
                            writable && { label: 'Transferir para outro prédio', icon: 'transfer', disabled: !st.quantity, onClick: () => setMoving({ supply: sp, kind: 'transferencia' }) },
                            writable && { label: 'Ajustar saldo', hint: 'Depois de uma contagem', icon: 'sliders', onClick: () => setMoving({ supply: sp, kind: 'ajuste' }) },
                            { label: 'Ver histórico', icon: 'clock', onClick: () => setHistory(sp) },
                            writable && { label: 'Editar insumo', icon: 'edit', onClick: () => setEditing(sp) },
                            user?.system_role === 'super_admin' && { label: 'Remover do catálogo', hint: 'Com histórico, só é desativado', icon: 'trash', danger: true, onClick: () => remove(sp) },
                          ]} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {filtered.length > 0 && (hiddenCount > 0 || (showCatalog && !search.trim())) && (
        <div className={s.catalogToggle}>
          {showCatalog
            ? <button type="button" className={s.linkBtn} onClick={() => setShowCatalog(false)}>Mostrar só os insumos de {LOC_LABEL[location]}</button>
            : <>
                <span>{hiddenCount} {hiddenCount === 1 ? 'insumo do catálogo não é usado' : 'insumos do catálogo não são usados'} em {LOC_LABEL[location]}.</span>
                <button type="button" className={s.linkBtn} onClick={() => setShowCatalog(true)}>Mostrar todos</button>
              </>}
        </div>
      )}

      {editing && <SupplyEditor supply={editing.id ? editing : null} knownModels={knownModels} onClose={() => setEditing(null)} onSaved={sp => { upsert(sp); setEditing(null) }} />}
      {moving && <MovementModal supply={moving.supply} location={location} kind={moving.kind} printers={printers} onClose={() => setMoving(null)} onSaved={sp => { upsert(sp); setMoving(null) }} />}
      {history && (
        <HistoryModal
          supply={history}
          location={location}
          canChange={m => writable && (m.created_by === user?.id || user?.system_role === 'super_admin')}
          onClose={() => setHistory(null)}
        />
      )}
    </div>
  )
}
