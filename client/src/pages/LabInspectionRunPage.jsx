import { useEffect, useMemo, useRef, useState, useCallback, useId } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import { canEdit } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { photoPair } from '../utils/imageResize'
import LineIcon from '../components/common/LineIcon'
import RowMenu from '../components/common/RowMenu'
import Modal from '../components/common/Modal'
import { BUILDINGS, ANSWERS, fmtWhen, plural } from '../utils/labInspections'
import s from './LabInspections.module.css'

// Checklist de um laboratório (tablet): um item por cartão com 3 botões
// grandes. "Não conforme" abre o problema, a foto da câmera e "precisa de
// manutenção". Cada toque grava na hora; "Revisar e finalizar" mostra o resumo.
// Vistoria finalizada (ou de outra pessoa) abre como relatório.
const errMsg = e => e.response?.data?.error || 'Não foi possível salvar. Confira a internet e tente de novo.'

function PhotoView({ inspectionId, itemId, thumb, onClose }) {
  const [src, setSrc] = useState(thumb)
  useEffect(() => {
    api.get(`/lab-inspections/${inspectionId}/answers/${itemId}/photo`).then(r => setSrc(r.data.data)).catch(() => {})
  }, [inspectionId, itemId])
  return (
    <Modal title="Foto" onClose={onClose} width={900}>
      <img src={src} alt="Foto do problema" className={s.photoFull} />
    </Modal>
  )
}

function ItemCard({ item, answer, index, total, onStatus, onField, onCommit, onPhoto, onRemovePhoto, onViewPhoto, flagged, cardRef }) {
  const id = useId()
  const status = answer?.status
  const nok = status === 'nao_conforme'
  const [photoBusy, setPhotoBusy] = useState(false)
  const [showNotes, setShowNotes] = useState(!!answer?.notes)
  const fileRef = useRef(null)
  const problemRef = useRef(null)
  useEffect(() => { if (nok && !answer?.problem) problemRef.current?.focus({ preventScroll: true }) }, [nok]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async e => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setPhotoBusy(true)
    try { await onPhoto(item.id, await photoPair(f)) } catch (err) { alertDialog(err.message || errMsg(err), { danger: true }) } finally { setPhotoBusy(false) }
  }

  return (
    <li ref={cardRef} className={`${s.item} ${status ? s[`item_${status}`] : ''} ${flagged ? s.itemFlagged : ''}`}>
      <div className={s.itemHead}>
        <span className={s.itemIcon} aria-hidden="true"><LineIcon name={item.icon || 'check'} /></span>
        <div className={s.itemText}>
          <h3 id={`${id}-t`}>{item.label}</h3>
          {item.hint && <p>{item.hint}</p>}
        </div>
        <span className={s.itemNum} aria-hidden="true">{index + 1}/{total}</span>
      </div>
      <div className={s.choices} role="radiogroup" aria-labelledby={`${id}-t`}>
        {Object.entries(ANSWERS).map(([k, a]) => (
          <button key={k} type="button" role="radio" aria-checked={status === k}
            className={`${s.choice} ${s[`choice_${k}`]} ${status === k ? s.choiceOn : ''}`} onClick={() => onStatus(item.id, k)}>
            <LineIcon name={a.icon} />
            <span>{a.label}</span>
          </button>
        ))}
      </div>

      {nok && (
        <div className={s.problem}>
          <div>
            <label className="label" htmlFor={`${id}-p`}>O que está errado?</label>
            <textarea id={`${id}-p`} ref={problemRef} rows={2} value={answer.problem || ''} maxLength={2000}
              placeholder="Ex.: o PC 12 não liga; duas lâmpadas queimadas"
              onChange={e => onField(item.id, { problem: e.target.value })} onBlur={() => onCommit(item.id)}
              aria-invalid={flagged && !answer.problem ? 'true' : undefined} />
            {flagged && !answer.problem && <p className={s.fieldError} role="alert">Descreva o problema para finalizar.</p>}
          </div>
          <div>
            <label className="label" htmlFor={`${id}-e`}>Equipamentos afetados <span className={s.optional}>(opcional)</span></label>
            <input id={`${id}-e`} value={answer.equipment || ''} maxLength={200} placeholder="Ex.: PC 12 e PC 14, bancada 3"
              onChange={e => onField(item.id, { equipment: e.target.value })} onBlur={() => onCommit(item.id)} />
          </div>

          <div className={s.problemRow}>
            <button type="button" role="switch" aria-checked={!!answer.needs_maintenance}
              className={`${s.maint} ${answer.needs_maintenance ? s.maintOn : ''}`}
              onClick={() => { onField(item.id, { needs_maintenance: answer.needs_maintenance ? 0 : 1 }); onCommit(item.id, { needs_maintenance: answer.needs_maintenance ? 0 : 1 }) }}>
              <span className={s.switch} aria-hidden="true"><span /></span>
              <span><strong>Precisa de manutenção</strong><small>Abre um incidente ao finalizar</small></span>
            </button>

            {answer.photo_thumb ? (
              <div className={s.photoBox}>
                <button type="button" className={s.photoThumb} onClick={() => onViewPhoto(item.id, answer.photo_thumb)} aria-label="Ver foto">
                  <img src={answer.photo_thumb} alt="" width="72" height="54" />
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRemovePhoto(item.id)}>Tirar foto</button>
              </div>
            ) : (
              <>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
                <button type="button" className={s.cameraBtn} onClick={() => fileRef.current?.click()} disabled={photoBusy}>
                  <LineIcon name="camera" /> {photoBusy ? 'Enviando…' : 'Fotografar'}
                </button>
              </>
            )}
          </div>

          {showNotes ? (
            <div>
              <label className="label" htmlFor={`${id}-n`}>Observação</label>
              <textarea id={`${id}-n`} rows={2} value={answer.notes || ''} maxLength={2000}
                onChange={e => onField(item.id, { notes: e.target.value })} onBlur={() => onCommit(item.id)} />
            </div>
          ) : (
            <button type="button" className={s.linkBtn} onClick={() => setShowNotes(true)}><LineIcon name="plus" /> Adicionar observação</button>
          )}
        </div>
      )}
    </li>
  )
}

// ── Relatório (vistoria finalizada ou de outra pessoa) ──────────────────
function Report({ insp, justFinished, canDelete, onDelete }) {
  const [photo, setPhoto] = useState(null)
  const answers = insp.answers || []
  const problems = answers.filter(a => a.status === 'nao_conforme')
  const done = insp.status === 'finalizada'
  return (
    <div className={s.runPage}>
      <Link to={`/vistorias?predio=${insp.building}${done ? '&aba=historico' : ''}`} className={s.back}><LineIcon name="chevronLeft" /> {done ? 'Histórico' : 'Laboratórios'}</Link>
      {justFinished && (
        <div className={s.successBanner} role="status">
          <LineIcon name="check" />
          <div>
            <strong>Vistoria finalizada</strong>
            <span>{insp.incident_count ? `${plural(insp.incident_count, 'incidente foi aberto', 'incidentes foram abertos')} para a manutenção.` : 'Registrada no histórico.'}</span>
          </div>
        </div>
      )}
      <header className={s.reportHead}>
        <div>
          <p className={s.eyebrow}>{BUILDINGS[insp.building]}{insp.location ? ` · ${insp.location}` : ''}</p>
          <h1 className={s.title}>{insp.lab_name}</h1>
          <p className={s.sub}>
            {done ? `Vistoria de ${fmtWhen(insp.finished_at)} por ${insp.technician_name || 'técnico'}` : `Em andamento por ${insp.technician_name || 'outra pessoa'} desde ${fmtWhen(insp.started_at)}`}
          </p>
        </div>
        {canDelete && <RowMenu name="vistoria" items={[{ label: 'Apagar vistoria', icon: 'trash', danger: true, onClick: onDelete }]} />}
      </header>

      {done && (
        <div className={s.summary}>
          <div className={s.sumOk}><strong>{insp.ok_count}</strong><span>Conformes</span></div>
          <div className={s.sumBad}><strong>{insp.nok_count}</strong><span>Não conformes</span></div>
          <div><strong>{insp.na_count}</strong><span>Não se aplicam</span></div>
        </div>
      )}

      {!!problems.length && (
        <section className={s.reportSection}>
          <h2>Problemas encontrados</h2>
          <ul className={s.problemList}>
            {problems.map(a => (
              <li key={a.item_id}>
                {a.photo_thumb
                  ? <button type="button" className={s.photoThumb} onClick={() => setPhoto(a)} aria-label={`Ver foto de ${a.item_label}`}><img src={a.photo_thumb} alt="" width="72" height="54" /></button>
                  : <span className={s.itemIcon} aria-hidden="true"><LineIcon name={a.item_icon || 'alert'} /></span>}
                <div className={s.problemText}>
                  <strong>{a.item_label}</strong>
                  <p>{a.problem}</p>
                  {(a.equipment || a.notes) && <span>{[a.equipment && `Equipamentos: ${a.equipment}`, a.notes].filter(Boolean).join(' · ')}</span>}
                </div>
                {a.incident_id
                  ? <Link className={s.incidentLink} to={`/incidentes-laboratorios/${insp.building}?abrir=${a.incident_id}`}><LineIcon name="wrench" /> Ver incidente</Link>
                  : a.needs_maintenance ? <span className={s.incidentTag}>Vai virar incidente</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {insp.notes && (
        <section className={s.reportSection}>
          <h2>Observações gerais</h2>
          <p className={s.notes}>{insp.notes}</p>
        </section>
      )}

      <section className={s.reportSection}>
        <h2>Todos os itens</h2>
        <ul className={s.allItems}>
          {answers.map(a => (
            <li key={a.item_id}>
              <LineIcon name={a.item_icon || 'check'} />
              <span>{a.item_label}</span>
              <em className={s[`ans_${a.status}`]}><LineIcon name={ANSWERS[a.status]?.icon} /> {ANSWERS[a.status]?.label}</em>
            </li>
          ))}
          {!answers.length && <li className={s.muted}>Nenhum item respondido ainda.</li>}
        </ul>
      </section>
      {photo && <PhotoView inspectionId={insp.id} itemId={photo.item_id} thumb={photo.photo_thumb} onClose={() => setPhoto(null)} />}
    </div>
  )
}

export default function LabInspectionRunPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [insp, setInsp] = useState(null)
  const [answers, setAnswers] = useState({})
  const [step, setStep] = useState('check')
  const [flagged, setFlagged] = useState(new Set())
  const [notes, setNotes] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [justFinished, setJustFinished] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [saveState, setSaveState] = useState('') // '', 'saving', 'saved', 'error'
  const answersRef = useRef({})
  const cardRefs = useRef({})
  const pending = useRef(0)

  const load = useCallback(() => {
    api.get(`/lab-inspections/${id}`).then(r => {
      setInsp(r.data)
      const map = Object.fromEntries((r.data.answers || []).map(a => [a.item_id, a]))
      answersRef.current = map
      setAnswers(map)
      setNotes(r.data.notes || '')
    }).catch(() => setInsp(false))
  }, [id])
  useEffect(load, [load])

  const isSuper = user?.system_role === 'super_admin'
  const editable = insp && insp.status === 'rascunho' && canEdit(user, 'incidents') && (insp.created_by === user?.id || isSuper)
  const items = insp?.items || []
  const answered = items.filter(i => answers[i.id]).length
  const counts = useMemo(() => {
    const c = { conforme: 0, nao_conforme: 0, na: 0 }
    for (const i of items) if (answers[i.id]) c[answers[i.id].status]++
    return c
  }, [items, answers])

  const track = async fn => {
    pending.current++
    setSaveState('saving')
    try { await fn(); if (--pending.current === 0) setSaveState('saved') } catch (e) { pending.current--; setSaveState('error'); throw e }
  }
  const putAnswer = (itemId, a) => track(() => api.put(`/lab-inspections/${id}/answers/${itemId}`, {
    status: a.status, problem: a.problem, notes: a.notes, equipment: a.equipment, needs_maintenance: !!a.needs_maintenance,
  }))
  const setLocal = (itemId, patch) => {
    const next = { ...answersRef.current, [itemId]: { ...(answersRef.current[itemId] || { item_id: itemId }), ...patch } }
    answersRef.current = next
    setAnswers(next)
    return next[itemId]
  }

  const scrollToNext = fromId => {
    const idx = items.findIndex(i => i.id === fromId)
    const next = [...items.slice(idx + 1), ...items.slice(0, idx)].find(i => !answersRef.current[i.id])
    if (next) setTimeout(() => cardRefs.current[next.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
  }

  const onStatus = async (itemId, status) => {
    const before = answersRef.current[itemId]
    const wasNew = !before
    const a = setLocal(itemId, status === 'nao_conforme' ? { status } : { status, problem: null, equipment: null, needs_maintenance: 0, photo_thumb: null })
    if (flagged.has(itemId) && status !== 'nao_conforme') setFlagged(f => { const n = new Set(f); n.delete(itemId); return n })
    try {
      await putAnswer(itemId, a)
      if (status !== 'nao_conforme' && (wasNew || before?.status !== status)) scrollToNext(itemId)
    } catch (e) {
      const restore = { ...answersRef.current }
      if (before) restore[itemId] = before; else delete restore[itemId]
      answersRef.current = restore
      setAnswers(restore)
      alertDialog(errMsg(e), { danger: true })
    }
  }
  const onCommit = async (itemId, patch) => {
    const a = patch ? { ...answersRef.current[itemId], ...patch } : answersRef.current[itemId]
    if (!a?.status) return
    try { await putAnswer(itemId, a) } catch (e) { alertDialog(errMsg(e), { danger: true }) }
  }
  const onPhoto = async (itemId, pair) => {
    await onCommit(itemId) // garante a resposta gravada antes da foto
    await track(() => api.post(`/lab-inspections/${id}/answers/${itemId}/photo`, pair))
    setLocal(itemId, { photo_thumb: pair.thumb })
  }
  const onRemovePhoto = async itemId => {
    try { await track(() => api.delete(`/lab-inspections/${id}/answers/${itemId}/photo`)); setLocal(itemId, { photo_thumb: null }) } catch (e) { alertDialog(errMsg(e), { danger: true }) }
  }
  const fillRest = async () => {
    const rest = items.filter(i => !answersRef.current[i.id])
    if (!rest.length) return
    if (!await confirmDialog(`Marcar ${plural(rest.length, 'item que falta', 'itens que faltam')} como Conforme?`, { title: 'Tudo certo no resto', danger: false, confirmLabel: 'Marcar como Conforme' })) return
    for (const i of rest) setLocal(i.id, { status: 'conforme' })
    try { await Promise.all(rest.map(i => putAnswer(i.id, { status: 'conforme' }))) } catch (e) { alertDialog(errMsg(e), { danger: true }); load() }
  }
  const saveNotes = () => track(() => api.put(`/lab-inspections/${id}`, { notes })).catch(e => alertDialog(errMsg(e), { danger: true }))

  const missing = items.filter(i => !answers[i.id])
  const noDesc = items.filter(i => answers[i.id]?.status === 'nao_conforme' && !answers[i.id]?.problem?.trim())
  const goReview = () => { setStep('review'); window.scrollTo({ top: 0 }) }
  const backToCheck = targetIds => {
    setStep('check')
    if (targetIds?.length) {
      setFlagged(new Set(targetIds))
      setTimeout(() => cardRefs.current[targetIds[0]]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
    }
  }
  const finish = async () => {
    if (missing.length || noDesc.length) return backToCheck([...missing, ...noDesc].map(i => i.id))
    setFinishing(true)
    try {
      while (pending.current > 0) await new Promise(r => setTimeout(r, 100)) // espera as gravações em curso
      const r = await api.post(`/lab-inspections/${id}/finish`, { notes })
      setInsp(r.data)
      setJustFinished(true)
      window.scrollTo({ top: 0 })
    } catch (e) {
      if (e.response?.data?.missing) backToCheck(e.response.data.missing)
      alertDialog(errMsg(e), { danger: true })
    } finally { setFinishing(false) }
  }
  const discard = async () => {
    if (!await confirmDialog('Descartar esta vistoria? As respostas e fotos serão apagadas.', { confirmLabel: 'Descartar' })) return
    try { await api.delete(`/lab-inspections/${id}`); navigate(`/vistorias?predio=${insp.building}`) } catch (e) { alertDialog(errMsg(e), { danger: true }) }
  }
  const removeFinished = async () => {
    if (!await confirmDialog('Apagar esta vistoria do histórico? Os incidentes abertos por ela continuam.', { confirmLabel: 'Apagar' })) return
    try { await api.delete(`/lab-inspections/${id}`); navigate(`/vistorias?predio=${insp.building}&aba=historico`) } catch (e) { alertDialog(errMsg(e), { danger: true }) }
  }

  if (insp === null) return <div className={s.runPage}><p className={s.loading}>Carregando…</p></div>
  if (insp === false) return (
    <div className={s.runPage}>
      <div className={s.empty}><h2>Vistoria não encontrada</h2><p>Ela pode ter sido descartada.</p><Link className="btn btn-primary" to="/vistorias">Ver laboratórios</Link></div>
    </div>
  )
  if (!editable) return <Report insp={insp} justFinished={justFinished} canDelete={isSuper && insp.status === 'finalizada'} onDelete={removeFinished} />

  const pct = items.length ? Math.round((answered / items.length) * 100) : 0
  const problems = items.filter(i => answers[i.id]?.status === 'nao_conforme')

  return (
    <div className={s.runPage}>
      <div className={s.runBar}>
        <Link to={`/vistorias?predio=${insp.building}`} className={s.backIcon} aria-label="Voltar aos laboratórios"><LineIcon name="chevronLeft" /></Link>
        <div className={s.runTitle}>
          <strong>{insp.lab_name}</strong>
          <span>{[BUILDINGS[insp.building], insp.location, insp.computers ? plural(insp.computers, 'computador', 'computadores') : null].filter(Boolean).join(' · ')}</span>
        </div>
        <span className={`${s.saveState} ${saveState === 'error' ? s.saveError : ''}`} role="status">
          {saveState === 'saving' ? 'Salvando…' : saveState === 'saved' ? 'Salvo' : saveState === 'error' ? 'Não salvou' : ''}
        </span>
        <RowMenu name="vistoria" items={[{ label: 'Descartar vistoria', icon: 'trash', danger: true, onClick: discard }]} />
        <div className={s.progress} role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={answered} aria-label="Itens conferidos">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className={s.progressText}>
          <span><b>{answered}</b> de {items.length} conferidos</span>
          <span className={s.progressCounts}>
            <i className={s.cOk}>{counts.conforme} ok</i>
            <i className={s.cBad}>{counts.nao_conforme} com problema</i>
            <i>{counts.na} n/a</i>
          </span>
        </div>
      </div>

      {step === 'check' && (
        <>
          <ol className={s.items}>
            {items.map((it, i) => (
              <ItemCard key={it.id} item={it} index={i} total={items.length} answer={answers[it.id]} flagged={flagged.has(it.id)}
                cardRef={el => { cardRefs.current[it.id] = el }}
                onStatus={onStatus} onField={setLocal} onCommit={onCommit} onPhoto={onPhoto} onRemovePhoto={onRemovePhoto}
                onViewPhoto={(itemId, thumb) => setPhoto({ itemId, thumb })} />
            ))}
          </ol>
          <div className={s.actionBar}>
            {missing.length > 0 && missing.length < items.length && (
              <button type="button" className="btn btn-ghost" onClick={fillRest}>Os {missing.length} que faltam estão OK</button>
            )}
            <button type="button" className={`btn btn-primary ${s.bigBtn}`} onClick={goReview} disabled={!answered}>
              Revisar e finalizar <LineIcon name="chevronRight" />
            </button>
          </div>
        </>
      )}

      {step === 'review' && (
        <div className={s.review}>
          <h2 className={s.reviewTitle}>Revisão</h2>
          <div className={s.summary}>
            <div className={s.sumOk}><strong>{counts.conforme}</strong><span>Conformes</span></div>
            <div className={s.sumBad}><strong>{counts.nao_conforme}</strong><span>Não conformes</span></div>
            <div><strong>{counts.na}</strong><span>Não se aplicam</span></div>
          </div>

          {(missing.length > 0 || noDesc.length > 0) && (
            <div className={s.warnBox} role="alert">
              <LineIcon name="alert" />
              <div>
                {missing.length > 0 && <p>Falta conferir: <b>{missing.map(i => i.label).join(', ')}</b>.</p>}
                {noDesc.length > 0 && <p>Descreva o problema em: <b>{noDesc.map(i => i.label).join(', ')}</b>.</p>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => backToCheck([...missing, ...noDesc].map(i => i.id))}>Ir para o checklist</button>
              </div>
            </div>
          )}

          {problems.length > 0 ? (
            <section className={s.reportSection}>
              <h2>Problemas encontrados</h2>
              <ul className={s.problemList}>
                {problems.map(it => {
                  const a = answers[it.id]
                  return (
                    <li key={it.id}>
                      {a.photo_thumb
                        ? <img className={s.photoStatic} src={a.photo_thumb} alt="" width="72" height="54" />
                        : <span className={s.itemIcon} aria-hidden="true"><LineIcon name={it.icon || 'alert'} /></span>}
                      <div className={s.problemText}>
                        <strong>{it.label}</strong>
                        <p>{a.problem || <em className={s.badText}>Sem descrição</em>}</p>
                        {a.equipment && <span>Equipamentos: {a.equipment}</span>}
                      </div>
                      {a.needs_maintenance ? <span className={s.incidentTag}><LineIcon name="wrench" /> Abre incidente</span> : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : (
            <p className={s.allGood}><LineIcon name="check" /> Nenhum problema encontrado.</p>
          )}

          <section className={s.reportSection}>
            <label className={s.h2label} htmlFor="insp-notes">Observações gerais <span className={s.optional}>(opcional)</span></label>
            <textarea id="insp-notes" rows={3} value={notes} maxLength={5000} onChange={e => setNotes(e.target.value)} onBlur={saveNotes}
              placeholder="Algo que vale registrar sobre o laboratório como um todo" />
          </section>

          <p className={s.signature}><LineIcon name="user" /> {user?.name || 'Você'} · data e hora registradas ao finalizar</p>

          <div className={s.actionBar}>
            <button type="button" className="btn btn-ghost" onClick={() => setStep('check')}><LineIcon name="chevronLeft" /> Voltar ao checklist</button>
            <button type="button" className={`btn btn-green ${s.bigBtn}`} onClick={finish} disabled={finishing}>
              <LineIcon name="check" /> {finishing ? 'Finalizando…' : 'Finalizar vistoria'}
            </button>
          </div>
        </div>
      )}

      {photo && <PhotoView inspectionId={id} itemId={photo.itemId} thumb={photo.thumb} onClose={() => setPhoto(null)} />}
    </div>
  )
}
