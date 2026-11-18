import { useEffect, useState, useId } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'
import LineIcon from '../common/LineIcon'
import RowMenu from '../common/RowMenu'
import { confirmDialog, alertDialog } from '../../store/dialogStore'
import { BUILDINGS, ITEM_ICONS } from '../../utils/labInspections'
import s from './InspectionSetup.module.css'

// "Configurar" da Vistoria de Laboratórios: laboratórios (prédio, localização,
// nº de computadores) e os itens do checklist (texto, dica, ícone, ordem).
const CATEGORY_LABELS = { maquina: 'Máquina com defeito', sinistro: 'Sinistro / dano', projecao: 'Projeção / TV', organizacao: 'Bagunça / organização', rede: 'Rede / internet', outro: 'Outro' }
const errMsg = e => e.response?.data?.error || 'Não foi possível salvar.'

function LabForm({ lab, building, onSaved, onCancel }) {
  const id = useId()
  const [f, setF] = useState({ building: lab?.building || building, name: lab?.name || '', location: lab?.location || '', computers: lab?.computers ?? '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }))
  const save = async e => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const body = { ...f, computers: Number(f.computers) || 0 }
      const r = lab ? await api.put(`/lab-inspections/labs/${lab.id}`, body) : await api.post('/lab-inspections/labs', body)
      onSaved(r.data)
    } catch (err) { setError(errMsg(err)) } finally { setBusy(false) }
  }
  return (
    <form className={s.form} onSubmit={save}>
      <div className={s.formGrid}>
        <div>
          <label className="label" htmlFor={`${id}-b`}>Prédio</label>
          <select id={`${id}-b`} value={f.building} onChange={set('building')}>
            {Object.entries(BUILDINGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className={s.wide}>
          <label className="label" htmlFor={`${id}-n`}>Nome</label>
          <input id={`${id}-n`} value={f.name} onChange={set('name')} placeholder="Laboratório 3" autoFocus required maxLength={80} />
        </div>
        <div className={s.wide}>
          <label className="label" htmlFor={`${id}-l`}>Localização</label>
          <input id={`${id}-l`} value={f.location} onChange={set('location')} placeholder="2º andar, sala 204" maxLength={120} />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-c`}>Computadores</label>
          <input id={`${id}-c`} type="number" inputMode="numeric" min="0" max="999" value={f.computers} onChange={set('computers')} />
        </div>
      </div>
      {error && <p className={s.error} role="alert">{error}</p>}
      <div className={s.formActions}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : lab ? 'Salvar laboratório' : 'Adicionar laboratório'}</button>
      </div>
    </form>
  )
}

function ItemForm({ item, onSaved, onCancel }) {
  const id = useId()
  const [f, setF] = useState({ label: item?.label || '', hint: item?.hint || '', icon: item?.icon || 'check', incident_category: item?.incident_category || 'outro' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }))
  const save = async e => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const r = item ? await api.put(`/lab-inspections/items/${item.id}`, f) : await api.post('/lab-inspections/items', f)
      onSaved(r.data)
    } catch (err) { setError(errMsg(err)) } finally { setBusy(false) }
  }
  return (
    <form className={s.form} onSubmit={save}>
      <div className={s.formGrid}>
        <div className={s.full}>
          <label className="label" htmlFor={`${id}-l`}>O que conferir</label>
          <input id={`${id}-l`} value={f.label} onChange={set('label')} placeholder="Computadores" autoFocus required maxLength={80} />
        </div>
        <div className={s.full}>
          <label className="label" htmlFor={`${id}-h`}>Dica para o técnico</label>
          <input id={`${id}-h`} value={f.hint} onChange={set('hint')} placeholder="Ligam e funcionam normalmente" maxLength={160} />
        </div>
        <div className={s.full}>
          <span className="label" id={`${id}-i`}>Ícone</span>
          <div className={s.icons} role="radiogroup" aria-labelledby={`${id}-i`}>
            {ITEM_ICONS.map(ic => (
              <button key={ic} type="button" role="radio" aria-checked={f.icon === ic} aria-label={ic}
                className={`${s.iconPick} ${f.icon === ic ? s.iconOn : ''}`} onClick={() => setF(p => ({ ...p, icon: ic }))}>
                <LineIcon name={ic} />
              </button>
            ))}
          </div>
        </div>
        <div className={s.full}>
          <label className="label" htmlFor={`${id}-c`}>Se precisar de manutenção, abre incidente do tipo</label>
          <select id={`${id}-c`} value={f.incident_category} onChange={set('incident_category')}>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      {error && <p className={s.error} role="alert">{error}</p>}
      <div className={s.formActions}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : item ? 'Salvar item' : 'Adicionar item'}</button>
      </div>
    </form>
  )
}

export default function InspectionSetup({ building, onClose }) {
  const [tab, setTab] = useState('labs')
  const [labs, setLabs] = useState(null)
  const [items, setItems] = useState(null)
  const [editing, setEditing] = useState(null) // { kind, row|null }

  const load = () => {
    api.get('/lab-inspections/labs?all=1').then(r => setLabs(r.data)).catch(() => setLabs([]))
    api.get('/lab-inspections/items?all=1').then(r => setItems(r.data)).catch(() => setItems([]))
  }
  useEffect(load, [])

  const toggleLab = async lab => {
    try { await api.put(`/lab-inspections/labs/${lab.id}`, { active: !lab.active }); load() } catch (e) { alertDialog(errMsg(e), { danger: true }) }
  }
  const removeLab = async lab => {
    if (!await confirmDialog(`Excluir "${lab.name}"?`, { confirmLabel: 'Excluir' })) return
    try { await api.delete(`/lab-inspections/labs/${lab.id}`); load() } catch (e) { alertDialog(errMsg(e), { danger: true }) }
  }
  const toggleItem = async item => {
    try { await api.put(`/lab-inspections/items/${item.id}`, { active: !item.active }); load() } catch (e) { alertDialog(errMsg(e), { danger: true }) }
  }
  const removeItem = async item => {
    if (!await confirmDialog(`Excluir o item "${item.label}"? As vistorias antigas continuam com ele.`, { confirmLabel: 'Excluir' })) return
    try { await api.delete(`/lab-inspections/items/${item.id}`); load() } catch (e) { alertDialog(errMsg(e), { danger: true }) }
  }
  const move = async (idx, dir) => {
    const next = [...items]
    const j = idx + dir
    if (j < 0 || j >= next.length) return
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setItems(next)
    try { await api.put('/lab-inspections/items/order', { ids: next.map(i => i.id) }) } catch (e) { alertDialog(errMsg(e), { danger: true }); load() }
  }
  const done = () => { setEditing(null); load() }

  return (
    <Modal title="Configurar vistoria" onClose={onClose} width={640}>
      <div className={s.tabs} role="tablist">
        <button role="tab" aria-selected={tab === 'labs'} className={`${s.tab} ${tab === 'labs' ? s.tabOn : ''}`} onClick={() => { setTab('labs'); setEditing(null) }}>Laboratórios</button>
        <button role="tab" aria-selected={tab === 'items'} className={`${s.tab} ${tab === 'items' ? s.tabOn : ''}`} onClick={() => { setTab('items'); setEditing(null) }}>Itens do checklist</button>
      </div>

      {tab === 'labs' && (
        editing?.kind === 'lab' ? <LabForm lab={editing.row} building={building} onSaved={done} onCancel={() => setEditing(null)} /> : (
          <>
            <p className={s.lead}>Laboratório desativado some da lista de vistoria, mas o histórico continua.</p>
            {labs === null ? <p className={s.muted}>Carregando…</p> : (
              <ul className={s.list}>
                {labs.map(l => (
                  <li key={l.id} className={!l.active ? s.off : ''}>
                    <span className={s.tag}>{BUILDINGS[l.building] || l.building}</span>
                    <div className={s.main}>
                      <strong>{l.name}</strong>
                      <span>{[l.location, l.computers ? `${l.computers} computadores` : null, !l.active && 'desativado'].filter(Boolean).join(' · ') || 'Sem localização'}</span>
                    </div>
                    <RowMenu name={l.name} items={[
                      { label: 'Editar', icon: 'edit', onClick: () => setEditing({ kind: 'lab', row: l }) },
                      { label: l.active ? 'Desativar' : 'Reativar', icon: l.active ? 'eyeOff' : 'eye', onClick: () => toggleLab(l) },
                      { label: 'Excluir', icon: 'trash', danger: true, onClick: () => removeLab(l) },
                    ]} />
                  </li>
                ))}
              </ul>
            )}
            <button className="btn btn-primary" onClick={() => setEditing({ kind: 'lab', row: null })}><LineIcon name="plus" /> Adicionar laboratório</button>
          </>
        )
      )}

      {tab === 'items' && (
        editing?.kind === 'item' ? <ItemForm item={editing.row} onSaved={done} onCancel={() => setEditing(null)} /> : (
          <>
            <p className={s.lead}>Mudar a lista vale para as próximas vistorias; as antigas guardam o que foi conferido.</p>
            {items === null ? <p className={s.muted}>Carregando…</p> : (
              <ul className={s.list}>
                {items.map((it, i) => (
                  <li key={it.id} className={!it.active ? s.off : ''}>
                    <span className={s.itemIcon}><LineIcon name={it.icon} /></span>
                    <div className={s.main}>
                      <strong>{it.label}</strong>
                      <span>{it.hint || '—'}{!it.active && ' · desligado'}</span>
                    </div>
                    <div className={s.moves}>
                      <button type="button" className={s.move} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir ${it.label}`}><LineIcon name="chevronUp" /></button>
                      <button type="button" className={s.move} onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`Descer ${it.label}`}><LineIcon name="chevronDown" /></button>
                    </div>
                    <RowMenu name={it.label} items={[
                      { label: 'Editar', icon: 'edit', onClick: () => setEditing({ kind: 'item', row: it }) },
                      { label: it.active ? 'Desligar' : 'Ligar', icon: it.active ? 'eyeOff' : 'eye', onClick: () => toggleItem(it) },
                      { label: 'Excluir', icon: 'trash', danger: true, onClick: () => removeItem(it) },
                    ]} />
                  </li>
                ))}
              </ul>
            )}
            <button className="btn btn-primary" onClick={() => setEditing({ kind: 'item', row: null })}><LineIcon name="plus" /> Adicionar item</button>
          </>
        )
      )}
    </Modal>
  )
}
