import { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useUrlState } from '../hooks/useUrlState'
import { canEdit } from '../utils/permissions'
import { alertDialog } from '../store/dialogStore'
import LineIcon from '../components/common/LineIcon'
import InspectionSetup from '../components/labInspections/InspectionSetup'
import { BUILDINGS, fmtWhen, agoText, plural } from '../utils/labInspections'
import s from './LabInspections.module.css'

// Fluxos → Vistoria de Laboratórios (feita para o tablet): escolher o
// laboratório abre o checklist; "Histórico" mostra as vistorias e o que se
// repete. Checklist em LabInspectionRunPage. Servidor: routes/labInspections.js.
const PERIODS = [['30', '30 dias'], ['90', '90 dias'], ['0', 'Tudo']]

function LabCard({ lab, writable, onOpen, busy }) {
  let tone = 'none', status = 'Nunca vistoriado'
  if (lab.last_at) {
    tone = lab.last_nok ? 'bad' : 'ok'
    status = `${agoText(lab.last_at)} · ${lab.last_nok ? plural(lab.last_nok, 'problema', 'problemas') : 'tudo conforme'}`
  }
  const meta = [lab.location, lab.computers ? plural(lab.computers, 'computador', 'computadores') : null].filter(Boolean).join(' · ')
  const clickable = writable || lab.last_id
  return (
    <li>
      <button type="button" className={s.labCard} onClick={() => onOpen(lab)} disabled={!clickable || busy}
        aria-label={`${lab.name}. ${status}${lab.draft_id ? '. Vistoria em andamento' : ''}`}>
        <span className={s.labTop}>
          <span className={s.labName}>{lab.name}</span>
          {lab.draft_id && <span className={s.draftTag}>Em andamento</span>}
        </span>
        <span className={s.labMeta}>{meta || 'Sem localização cadastrada'}</span>
        <span className={`${s.labStatus} ${s[`tone_${tone}`]}`}>
          <span className={s.dot} aria-hidden="true" />
          {lab.last_at ? `Última vistoria ${status}` : status}
        </span>
        {writable && (
          <span className={s.labCta}>
            <LineIcon name={lab.draft_id ? 'play' : 'clipboard'} />
            {busy ? 'Abrindo…' : lab.draft_id ? 'Continuar vistoria' : 'Começar vistoria'}
          </span>
        )}
      </button>
    </li>
  )
}

function Recurring({ rows }) {
  if (!rows?.length) return null
  return (
    <section className={s.recurring} aria-labelledby="rec-title">
      <h2 id="rec-title"><LineIcon name="alert" /> Problemas que se repetem <span>nos últimos 90 dias</span></h2>
      <ul>
        {rows.map(r => (
          <li key={`${r.lab_id}-${r.item_id}`}>
            <span className={s.recIcon}><LineIcon name={r.item_icon || 'alert'} /></span>
            <span className={s.recMain}><strong>{r.item_label}</strong> em {r.lab_name}</span>
            <span className={s.recCount}>{r.times} de {plural(r.inspections, 'vistoria', 'vistorias')}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function LabInspectionsPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const writable = canEdit(user, 'incidents')
  const [tab, setTab] = useUrlState('aba', 'vistoriar')
  const [building, setBuilding] = useUrlState('predio', 'sede')
  const [period, setPeriod] = useUrlState('periodo', '90')
  const [labs, setLabs] = useState(null)
  const [history, setHistory] = useState(null)
  const [recurring, setRecurring] = useState([])
  const [opening, setOpening] = useState(null)
  const [setup, setSetup] = useState(false)

  const load = useCallback(() => {
    api.get('/lab-inspections/labs').then(r => setLabs(r.data)).catch(() => setLabs([]))
    api.get('/lab-inspections/recurring?days=90').then(r => setRecurring(r.data)).catch(() => {})
  }, [])
  const loadHistory = useCallback(() => {
    if (tab !== 'historico') return
    api.get('/lab-inspections', { params: { building, days: Number(period) || undefined } })
      .then(r => setHistory(r.data)).catch(() => setHistory([]))
  }, [tab, building, period])
  useEffect(load, [load])
  useEffect(loadHistory, [loadHistory])
  useLiveRefresh(['lab-inspections'], () => { load(); loadHistory() })

  const here = useMemo(() => (labs || []).filter(l => l.building === building), [labs, building])
  const counts = useMemo(() => Object.fromEntries(Object.keys(BUILDINGS).map(b => [b, (labs || []).filter(l => l.building === b).length])), [labs])
  const recHere = recurring.filter(r => r.building === building)

  const open = async lab => {
    if (!writable) return lab.last_id && navigate(`/vistorias/${lab.last_id}`)
    setOpening(lab.id)
    try {
      const r = await api.post('/lab-inspections', { lab_id: lab.id })
      navigate(`/vistorias/${r.data.id}`)
    } catch (e) {
      alertDialog(e.response?.data?.error || 'Não foi possível abrir a vistoria.', { danger: true })
      setOpening(null)
    }
  }

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>Vistoria de Laboratórios</h1>
          <p className={s.sub}>{writable ? 'Toque no laboratório para começar. Cada resposta é salva na hora.' : 'Consulte as vistorias feitas pela equipe de TI.'}</p>
        </div>
        {writable && <button className="btn btn-ghost" onClick={() => setSetup(true)}><LineIcon name="sliders" /> Configurar</button>}
      </header>

      <div className={s.tabs} role="tablist" aria-label="Seção">
        <button role="tab" aria-selected={tab === 'vistoriar'} className={`${s.tab} ${tab === 'vistoriar' ? s.tabOn : ''}`} onClick={() => setTab('vistoriar')}>
          {writable ? 'Vistoriar' : 'Laboratórios'}
        </button>
        <button role="tab" aria-selected={tab === 'historico'} className={`${s.tab} ${tab === 'historico' ? s.tabOn : ''}`} onClick={() => setTab('historico')}>Histórico</button>
      </div>

      <div className={s.buildings} role="radiogroup" aria-label="Prédio">
        {Object.entries(BUILDINGS).map(([k, v]) => (
          <button key={k} role="radio" aria-checked={building === k} className={`${s.building} ${building === k ? s.buildingOn : ''}`} onClick={() => setBuilding(k)}>
            {v}{labs && <span>{counts[k]}</span>}
          </button>
        ))}
      </div>

      {tab === 'vistoriar' && (
        labs === null ? <p className={s.loading}>Carregando…</p> : (
          <>
            <Recurring rows={recHere} />
            {here.length ? (
              <ul className={s.labGrid}>
                {here.map(l => <LabCard key={l.id} lab={l} writable={writable} busy={opening === l.id} onOpen={open} />)}
              </ul>
            ) : (
              <div className={s.empty}>
                <h2>Nenhum laboratório no {BUILDINGS[building]}</h2>
                <p>{writable ? 'Cadastre os laboratórios deste prédio em Configurar para começar as vistorias.' : 'A equipe de TI ainda não cadastrou laboratórios aqui.'}</p>
                {writable && <button className="btn btn-primary" onClick={() => setSetup(true)}><LineIcon name="plus" /> Cadastrar laboratório</button>}
              </div>
            )}
          </>
        )
      )}

      {tab === 'historico' && (
        <>
          <div className={s.periods} role="radiogroup" aria-label="Período">
            {PERIODS.map(([k, v]) => (
              <button key={k} role="radio" aria-checked={period === k} className={`${s.chip} ${period === k ? s.chipOn : ''}`} onClick={() => setPeriod(k)}>{v}</button>
            ))}
          </div>
          <Recurring rows={recHere} />
          {history === null ? <p className={s.loading}>Carregando…</p> : history.length ? (
            <ul className={s.history}>
              {history.map(h => {
                const problems = h.problems ? h.problems.split('|') : []
                return (
                  <li key={h.id}>
                    <Link to={`/vistorias/${h.id}`} className={s.histRow}>
                      <span className={`${s.histBadge} ${h.nok_count ? s.tone_bad : s.tone_ok}`} aria-hidden="true">
                        <LineIcon name={h.nok_count ? 'alert' : 'check'} />
                      </span>
                      <span className={s.histMain}>
                        <strong>{h.lab_name}</strong>
                        <span>{fmtWhen(h.finished_at)} · {h.technician_name || 'Técnico'}</span>
                        {!!problems.length && <span className={s.problemChips}>{problems.map(p => <em key={p}>{p}</em>)}</span>}
                      </span>
                      <span className={s.histSum}>
                        {h.nok_count ? <b className={s.badText}>{plural(h.nok_count, 'problema', 'problemas')}</b> : <b className={s.okText}>Tudo conforme</b>}
                        {!!h.incident_count && <span>{plural(h.incident_count, 'incidente aberto', 'incidentes abertos')}</span>}
                      </span>
                      <LineIcon name="chevronRight" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className={s.empty}>
              <h2>Nenhuma vistoria neste período</h2>
              <p>As vistorias finalizadas no {BUILDINGS[building]} aparecem aqui, com os problemas encontrados.</p>
            </div>
          )}
        </>
      )}

      {setup && <InspectionSetup building={building} onClose={() => { setSetup(false); load() }} />}
    </div>
  )
}
