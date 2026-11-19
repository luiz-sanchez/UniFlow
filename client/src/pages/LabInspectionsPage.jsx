import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
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
import { BUILDINGS, fmtWhen, agoText, plural, brDay, brPeriod, DAY_PERIODS, timeOf, dayParts } from '../utils/labInspections'
import s from './LabInspections.module.css'

// Fluxos → Vistoria de Laboratórios (feita para o tablet): escolher o
// laboratório abre o checklist; "Histórico" mostra as vistorias e o que se
// repete. Checklist em LabInspectionRunPage. Servidor: routes/labInspections.js.
const PERIODS = [['30', '30 dias'], ['90', '90 dias'], ['0', 'Tudo']]

// Dois períodos por dia: o cartão mostra Manhã e Noite de HOJE; o destaque
// (feito/falta) é o período de agora.
function PeriodLine({ name, p, isNow, cur }) {
  let tone, text
  if (p) {
    tone = p.nok ? 'bad' : 'ok'
    text = `${timeOf(p.at)}${p.by ? ` · ${p.by.split(' ')[0]}` : ''} · ${p.nok ? plural(p.nok, 'problema', 'problemas') : 'tudo conforme'}`
  } else if (isNow) { tone = 'none'; text = 'falta' }
  else if (cur === 'noite') { tone = 'miss'; text = 'não foi feita' } // a manhã já passou
  else { tone = 'later'; text = 'a partir das 14h' }
  return (
    <span className={`${s.labStatus} ${s[`tone_${tone}`]} ${isNow ? s.periodNow : ''}`}>
      <span className={s.dot} aria-hidden="true" />
      <span><b>{DAY_PERIODS[name]}</b> · {text}</span>
    </span>
  )
}

function LabCard({ lab, cur, writable, onOpen, busy }) {
  const periods = lab.periods || {}
  const doneNow = !!periods[cur]
  const nowP = periods[cur]
  const meta = [lab.location, lab.computers ? plural(lab.computers, 'computador', 'computadores') : null].filter(Boolean).join(' · ')
  const clickable = writable || lab.last_id
  const summary = Object.keys(DAY_PERIODS).map(k => `${DAY_PERIODS[k]}: ${periods[k] ? `feita às ${timeOf(periods[k].at)}` : 'não feita'}`).join('. ')
  return (
    <li>
      <button type="button" className={`${s.labCard} ${doneNow ? s.labDone : ''}`} onClick={() => onOpen(lab)} disabled={!clickable || busy}
        aria-label={`${lab.name}. ${summary}${lab.draft_id ? '. Vistoria em andamento' : ''}`}>
        <span className={s.labTop}>
          <span className={s.labName}>{lab.name}</span>
          {lab.draft_id ? <span className={s.draftTag}>Em andamento</span>
            : doneNow && <span className={`${s.doneTag} ${s[`tone_${nowP.nok ? 'bad' : 'ok'}`]}`}><LineIcon name={nowP.nok ? 'alert' : 'check'} /> {DAY_PERIODS[cur]}</span>}
        </span>
        <span className={s.labMeta}>{meta || 'Sem localização cadastrada'}</span>
        <span className={s.periodLines}>
          {Object.keys(DAY_PERIODS).map(k => <PeriodLine key={k} name={k} p={periods[k]} isNow={k === cur} cur={cur} />)}
        </span>
        {!lab.periods?.manha && !lab.periods?.noite && lab.last_at && <span className={s.labMeta}>Última vistoria {lab.last_day === brDay(-1) ? 'ontem' : agoText(lab.last_at)}</span>}
        {writable && (
          <span className={`${s.labCta} ${doneNow && !lab.draft_id ? s.labCtaSoft : ''}`}>
            <LineIcon name={lab.draft_id ? 'play' : 'clipboard'} />
            {busy ? 'Abrindo…' : lab.draft_id ? 'Continuar vistoria' : doneNow ? 'Vistoriar de novo' : `Começar vistoria da ${DAY_PERIODS[cur].toLowerCase()}`}
          </span>
        )}
      </button>
    </li>
  )
}

// Resumo do período de agora no prédio: "5 de 19 vistoriados na manhã" + barra + filtro "Faltam".
function TodayBar({ done, total, show, onShow, cur }) {
  if (!total) return null
  const left = total - done
  const when = cur === 'manha' ? 'na manhã' : 'na noite'
  return (
    <section className={s.today} aria-label={`Vistorias de hoje ${when}`}>
      <div className={s.todayText}>
        <strong>{left ? `Faltam ${plural(left, 'laboratório', 'laboratórios')} ${when}` : `Todos vistoriados ${when}`}</strong>
        <span>{done} de {total} vistoriados {when} · são 2 vistorias por dia: manhã (até 13:59) e noite (a partir das 14h)</span>
      </div>
      <div className={s.todayBar} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={`Vistoriados ${when}`}>
        <span style={{ width: `${Math.round((done / total) * 100)}%` }} />
      </div>
      <div className={s.periods} role="radiogroup" aria-label="Mostrar">
        <button role="radio" aria-checked={show === 'faltam'} className={`${s.chip} ${show === 'faltam' ? s.chipOn : ''}`} onClick={() => onShow('faltam')}>Faltam {when} ({left})</button>
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
  const map = new Map(daily.rows.map(r => [`${r.lab_id}|${r.day}|${r.period}`, r]))
  const PK = Object.keys(DAY_PERIODS)
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
              const done = days.reduce((a, d) => a + PK.filter(k => map.has(`${l.id}|${d}|${k}`)).length, 0)
              return (
                <tr key={l.id}>
                  <th scope="row">{l.name}</th>
                  {days.map(d => {
                    const p = dayParts(d)
                    const parts = PK.map(k => {
                      const r = map.get(`${l.id}|${d}|${k}`)
                      return { k, r, label: `${DAY_PERIODS[k]}: ${r ? (r.nok ? 'com problema' : 'tudo conforme') : 'sem vistoria'}` }
                    })
                    const label = `${p.dm}. ${parts.map(x => x.label).join('. ')}`
                    return (
                      <td key={d} className={`${p.weekend ? s.weekend : ''} ${d === daily.today ? s.isToday : ''}`} title={label}>
                        <span className={s.cellPair} role="img" aria-label={label}>
                          {parts.map(({ k, r }) => (
                            <span key={k} className={`${s.cell} ${s.cellHalf} ${r ? (r.nok ? s.cellBad : s.cellOk) : ''}`}>{k === 'manha' ? 'M' : 'N'}</span>
                          ))}
                        </span>
                      </td>
                    )
                  })}
                  <td className={s.dailyCount}>{done}/28</td>
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
        <span>M = manhã (até 13:59) · N = noite (a partir das 14h)</span>
      </p>
    </section>
  )
}

// Modo tablet: some o menu e a barra de cima e o navegador fica em tela cheia
// (lembrado neste aparelho). Saiu da tela cheia sem querer? Um toque volta.
function TabletButton() {
  const { on, enter, exit } = useTabletMode()
  const { user, logout } = useAuthStore()
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
      {/* tablet compartilhado: quem está vistoriando + sair (pede conta e senha no próximo) */}
      <button className="btn btn-ghost" onClick={() => logout('google')} title="Sai do UniFlow e da conta Google deste tablet">
        <LineIcon name="logout" /> Sair ({user?.name?.split(' ')[0] || 'conta'})
      </button>
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
  const [cur, setCur] = useState(brPeriod)
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
  // virou o período (14h) ou o dia com a tela aberta (tablet ligado o dia todo): recarrega
  // — os "períodos de hoje" vêm do servidor e zeram na virada do dia
  const dayRef = useRef(brDay())
  useEffect(() => {
    const t = setInterval(() => {
      const p = brPeriod(), d = brDay()
      if (d !== dayRef.current) { dayRef.current = d; load() }
      setCur(p)
    }, 60e3)
    return () => clearInterval(t)
  }, [load])

  const here = useMemo(() => (labs || []).filter(l => l.building === building), [labs, building])
  const doneNow = l => !!l.periods?.[cur]
  // número na aba do prédio = quantos ainda faltam no período de agora
  const left = useMemo(() => Object.fromEntries(Object.keys(BUILDINGS).map(b => [b, (labs || []).filter(l => l.building === b && !l.periods?.[cur]).length])), [labs, cur])
  const doneHere = here.filter(doneNow).length
  const shown = show === 'faltam' ? here.filter(l => !doneNow(l)) : here
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
            {v}{labs && <span title="Faltam no período de agora">{left[k] || '✓'}</span>}
          </button>
        ))}
      </div>

      {tab === 'vistoriar' && (
        labs === null ? <p className={s.loading}>Carregando…</p> : (
          <>
            <TodayBar done={doneHere} total={here.length} show={show} onShow={setShow} cur={cur} />
            {here.length ? (shown.length ? (
              <ul className={s.labGrid}>
                {shown.map(l => <LabCard key={l.id} lab={l} cur={cur} writable={writable} busy={opening === l.id} onOpen={open} />)}
              </ul>
            ) : (
              <div className={s.empty}>
                <h2>Tudo vistoriado {cur === 'manha' ? 'na manhã' : 'na noite'} no {BUILDINGS[building]}</h2>
                <p>{cur === 'manha' ? 'Às 14h os laboratórios voltam para a lista, para a vistoria da noite.' : 'Amanhã cedo os laboratórios voltam para a lista.'} <button className="btn btn-ghost" onClick={() => setShow('todos')}>Ver todos</button></p>
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
                        <span>{fmtWhen(h.finished_at)}{h.period ? ` · ${DAY_PERIODS[h.period]}` : ''} · {h.technician_name || 'Técnico'}</span>
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
