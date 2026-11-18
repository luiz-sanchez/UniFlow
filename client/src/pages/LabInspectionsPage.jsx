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
import { useTabletMode, requestFullscreen } from '../store/tabletModeStore'
import { BUILDINGS, fmtWhen, agoText, plural, brDay, timeOf, dayParts } from '../utils/labInspections'
import s from './LabInspections.module.css'

// Fluxos → Vistoria de Laboratórios (feita para o tablet): escolher o
// laboratório abre o checklist; "Histórico" mostra as vistorias e o que se
// repete. Checklist em LabInspectionRunPage. Servidor: routes/labInspections.js.
const PERIODS = [['30', '30 dias'], ['90', '90 dias'], ['0', 'Tudo']]

// A vistoria é diária: o cartão diz se o laboratório já foi vistoriado HOJE.
function LabCard({ lab, today, writable, onOpen, busy }) {
  const doneToday = lab.last_day === today
  let tone, status
  if (doneToday) {
    tone = lab.last_nok ? 'bad' : 'ok'
    status = `Feita hoje às ${timeOf(lab.last_at)}${lab.last_by ? ` · ${lab.last_by.split(' ')[0]}` : ''} · ${lab.last_nok ? plural(lab.last_nok, 'problema', 'problemas') : 'tudo conforme'}`
  } else {
    tone = 'none'
    status = `Falta hoje · ${lab.last_at ? `última ${agoText(lab.last_at)}` : 'nunca vistoriado'}`
  }
  const meta = [lab.location, lab.computers ? plural(lab.computers, 'computador', 'computadores') : null].filter(Boolean).join(' · ')
  const clickable = writable || lab.last_id
  return (
    <li>
      <button type="button" className={`${s.labCard} ${doneToday ? s.labDone : ''}`} onClick={() => onOpen(lab)} disabled={!clickable || busy}
        aria-label={`${lab.name}. ${status}${lab.draft_id ? '. Vistoria em andamento' : ''}`}>
        <span className={s.labTop}>
          <span className={s.labName}>{lab.name}</span>
          {lab.draft_id ? <span className={s.draftTag}>Em andamento</span>
            : doneToday && <span className={`${s.doneTag} ${s[`tone_${tone}`]}`}><LineIcon name={lab.last_nok ? 'alert' : 'check'} /> Hoje</span>}
        </span>
        <span className={s.labMeta}>{meta || 'Sem localização cadastrada'}</span>
        <span className={`${s.labStatus} ${s[`tone_${tone}`]}`}>
          <span className={s.dot} aria-hidden="true" />
          {status}
        </span>
        {writable && (
          <span className={`${s.labCta} ${doneToday && !lab.draft_id ? s.labCtaSoft : ''}`}>
            <LineIcon name={lab.draft_id ? 'play' : 'clipboard'} />
            {busy ? 'Abrindo…' : lab.draft_id ? 'Continuar vistoria' : doneToday ? 'Vistoriar de novo' : 'Começar vistoria'}
          </span>
        )}
      </button>
    </li>
  )
}

// Resumo do dia no prédio: "5 de 19 vistoriados hoje" + barra + filtro "Faltam".
function TodayBar({ done, total, show, onShow }) {
  if (!total) return null
  const left = total - done
  return (
    <section className={s.today} aria-label="Vistorias de hoje">
      <div className={s.todayText}>
        <strong>{left ? `Faltam ${plural(left, 'laboratório', 'laboratórios')} hoje` : 'Todos vistoriados hoje'}</strong>
        <span>{done} de {total} vistoriados · a vistoria é diária</span>
      </div>
      <div className={s.todayBar} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Vistoriados hoje">
        <span style={{ width: `${Math.round((done / total) * 100)}%` }} />
      </div>
      <div className={s.periods} role="radiogroup" aria-label="Mostrar">
        <button role="radio" aria-checked={show === 'faltam'} className={`${s.chip} ${show === 'faltam' ? s.chipOn : ''}`} onClick={() => onShow('faltam')}>Faltam hoje ({left})</button>
        <button role="radio" aria-checked={show === 'todos'} className={`${s.chip} ${show === 'todos' ? s.chipOn : ''}`} onClick={() => onShow('todos')}>Todos ({total})</button>
      </div>
    </section>
  )
}

// Histórico → "Dia a dia": cada laboratório × últimos 14 dias (foi feita? teve problema?).
function DailyGrid({ labs, daily }) {
  if (!daily || !labs.length) return null
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(daily.today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 13 + i)
    return d.toISOString().slice(0, 10)
  })
  const map = new Map(daily.rows.map(r => [`${r.lab_id}|${r.day}`, r]))
  return (
    <section className={s.daily} aria-labelledby="daily-title">
      <h2 id="daily-title">Dia a dia <span>últimos 14 dias</span></h2>
      <div className={s.dailyScroll}>
        <table className={s.dailyTable}>
          <thead>
            <tr>
              <th scope="col">Laboratório</th>
              {days.map(d => { const p = dayParts(d); return (
                <th key={d} scope="col" className={`${p.weekend ? s.weekend : ''} ${d === daily.today ? s.isToday : ''}`}>
                  <span>{p.wd}</span>{p.dm.slice(0, 2)}
                </th>
              ) })}
              <th scope="col">Feitas</th>
            </tr>
          </thead>
          <tbody>
            {labs.map(l => {
              const done = days.filter(d => map.has(`${l.id}|${d}`)).length
              return (
                <tr key={l.id}>
                  <th scope="row">{l.name}</th>
                  {days.map(d => {
                    const r = map.get(`${l.id}|${d}`)
                    const p = dayParts(d)
                    const label = r ? (r.nok ? `${p.dm}: vistoriado, com problema` : `${p.dm}: vistoriado, tudo conforme`) : `${p.dm}: sem vistoria`
                    return (
                      <td key={d} className={`${p.weekend ? s.weekend : ''} ${d === daily.today ? s.isToday : ''}`} title={label}>
                        <span className={`${s.cell} ${r ? (r.nok ? s.cellBad : s.cellOk) : ''}`} role="img" aria-label={label}>
                          {r ? <LineIcon name={r.nok ? 'alert' : 'check'} /> : null}
                        </span>
                      </td>
                    )
                  })}
                  <td className={s.dailyCount}>{done}/14</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className={s.dailyLegend}>
        <span><i className={`${s.cell} ${s.cellOk}`} /> tudo conforme</span>
        <span><i className={`${s.cell} ${s.cellBad}`} /> com problema</span>
        <span><i className={s.cell} /> sem vistoria</span>
      </p>
    </section>
  )
}

// Modo tablet: some o menu e a barra de cima e o navegador fica em tela cheia
// (lembrado neste aparelho). Saiu da tela cheia sem querer? Um toque volta.
function TabletButton() {
  const { on, enter, exit } = useTabletMode()
  const [full, setFull] = useState(!!document.fullscreenElement)
  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])
  if (!on) return <button className="btn btn-ghost" onClick={enter}><LineIcon name="maximize" /> Modo tablet</button>
  return (
    <>
      {!full && document.documentElement.requestFullscreen && <button className="btn btn-ghost" onClick={requestFullscreen}><LineIcon name="maximize" /> Tela cheia</button>}
      <button className="btn btn-ghost" onClick={exit}><LineIcon name="minimize" /> Sair do modo tablet</button>
    </>
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
  const [show, setShow] = useUrlState('mostrar', 'faltam')
  const [daily, setDaily] = useState(null)
  const [today, setToday] = useState(brDay)
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
    api.get('/lab-inspections/daily?days=14').then(r => setDaily(r.data)).catch(() => {})
  }, [tab, building, period])
  useEffect(load, [load])
  useEffect(loadHistory, [loadHistory])
  useLiveRefresh(['lab-inspections'], () => { load(); loadHistory() })
  // virou o dia com a tela aberta (tablet ligado de um dia pro outro): tudo volta a "falta hoje"
  useEffect(() => {
    const t = setInterval(() => setToday(brDay()), 60e3)
    return () => clearInterval(t)
  }, [])

  const here = useMemo(() => (labs || []).filter(l => l.building === building), [labs, building])
  // número na aba do prédio = quantos ainda faltam vistoriar hoje
  const left = useMemo(() => Object.fromEntries(Object.keys(BUILDINGS).map(b => [b, (labs || []).filter(l => l.building === b && l.last_day !== today).length])), [labs, today])
  const doneHere = here.filter(l => l.last_day === today).length
  const shown = show === 'faltam' ? here.filter(l => l.last_day !== today) : here
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
        <div className={s.headerActions}>
          <TabletButton />
          {writable && <button className="btn btn-ghost" onClick={() => setSetup(true)}><LineIcon name="sliders" /> Configurar</button>}
        </div>
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
            {v}{labs && <span title="Faltam hoje">{left[k] || '✓'}</span>}
          </button>
        ))}
      </div>

      {tab === 'vistoriar' && (
        labs === null ? <p className={s.loading}>Carregando…</p> : (
          <>
            <TodayBar done={doneHere} total={here.length} show={show} onShow={setShow} />
            {here.length ? (shown.length ? (
              <ul className={s.labGrid}>
                {shown.map(l => <LabCard key={l.id} lab={l} today={today} writable={writable} busy={opening === l.id} onOpen={open} />)}
              </ul>
            ) : (
              <div className={s.empty}>
                <h2>Tudo vistoriado hoje no {BUILDINGS[building]}</h2>
                <p>Amanhã os laboratórios voltam para a lista. <button className="btn btn-ghost" onClick={() => setShow('todos')}>Ver todos</button></p>
              </div>
            )) : (
              <div className={s.empty}>
                <h2>Nenhum laboratório no {BUILDINGS[building]}</h2>
                <p>{writable ? 'Cadastre os laboratórios deste prédio em Configurar para começar as vistorias.' : 'A equipe de TI ainda não cadastrou laboratórios aqui.'}</p>
                {writable && <button className="btn btn-primary" onClick={() => setSetup(true)}><LineIcon name="plus" /> Cadastrar laboratório</button>}
              </div>
            )}
            <Recurring rows={recHere} />
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
          <DailyGrid labs={here} daily={daily} />
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
