import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { accessOf, departmentForCreate } from '../lib/permissions.js'

// Fluxos → Vistoria de Laboratórios: o técnico escolhe o laboratório no tablet e
// marca cada item do checklist (Conforme / Não conforme / Não se aplica). Cada
// toque grava na hora (rascunho), então fechar a aba não perde nada. Ao
// finalizar, os itens "precisa de manutenção" viram Incidentes Laboratórios.
// Módulo "incidents" (o portão do worker.js barra quem não vê / só vê).
// Sem separação por departamento: é rotina da TI.
const app = new Hono()
app.use('*', auth)

const BUILDINGS = ['sede', 'centro', 'g5']
const STATUSES = ['conforme', 'nao_conforme', 'na']
const CATEGORIES = ['maquina', 'sinistro', 'projecao', 'organizacao', 'rede', 'outro']
const PHOTO_RE = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/
const MAX_PHOTO_CHARS = 1_600_000
const MAX_THUMB_CHARS = 150_000

const str = (v, max) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}
const isSuper = async c => (await accessOf(c)).systemRole === 'super_admin'
// Data e hora de Brasília no formato dos incidentes ('YYYY-MM-DDTHH:MM')
const nowBrasilia = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 16)

// ── Laboratórios ──────────────────────────────────────────────────────────
// GET /labs — ativos (ou todos com ?all=1) + última vistoria finalizada e o
// rascunho em aberto de quem pergunta.
app.get('/labs', async c => {
  const db = c.get('db')
  const all = c.req.query('all') === '1'
  const rows = await db.prepare(`
    SELECT l.*,
      (SELECT i.id FROM lab_inspections i WHERE i.lab_id = l.id AND i.status = 'finalizada' ORDER BY i.finished_at DESC LIMIT 1) as last_id,
      (SELECT i.finished_at FROM lab_inspections i WHERE i.lab_id = l.id AND i.status = 'finalizada' ORDER BY i.finished_at DESC LIMIT 1) as last_at,
      (SELECT i.nok_count FROM lab_inspections i WHERE i.lab_id = l.id AND i.status = 'finalizada' ORDER BY i.finished_at DESC LIMIT 1) as last_nok,
      (SELECT i.id FROM lab_inspections i WHERE i.lab_id = l.id AND i.status = 'rascunho' AND i.created_by = ? ORDER BY i.started_at DESC LIMIT 1) as draft_id
    FROM inspection_labs l ${all ? '' : 'WHERE l.active = 1'}
    ORDER BY l.building, l.sort, l.name COLLATE NOCASE
  `).all(c.get('user').id)
  return c.json(rows)
})

function cleanLab(body, current = {}) {
  const pick = (k, fn) => (body[k] !== undefined ? fn(body[k]) : (current[k] ?? null))
  const out = {
    building: pick('building', v => String(v || '')),
    name: pick('name', v => str(v, 80)),
    location: pick('location', v => str(v, 120)),
    computers: pick('computers', v => Math.max(0, Math.min(999, parseInt(v, 10) || 0))) ?? 0,
    active: pick('active', v => (v === false || v === 0 ? 0 : 1)) ?? 1,
  }
  if (!BUILDINGS.includes(out.building)) return { error: 'Prédio inválido (use sede, centro ou g5)' }
  if (!out.name) return { error: 'Informe o nome do laboratório' }
  return out
}

app.post('/labs', async c => {
  const db = c.get('db')
  const v = cleanLab(await c.req.json())
  if (v.error) return c.json(v, 400)
  const id = uuid()
  await db.prepare('INSERT INTO inspection_labs (id, building, name, location, computers, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, v.building, v.name, v.location, v.computers, v.active,
      await db.scalar('SELECT COALESCE(MAX(sort), 0) + 1 FROM inspection_labs WHERE building = ?', v.building))
  return c.json(await db.prepare('SELECT * FROM inspection_labs WHERE id = ?').get(id))
})

app.put('/labs/:id', async c => {
  const db = c.get('db')
  const row = await db.prepare('SELECT * FROM inspection_labs WHERE id = ?').get(c.req.param('id'))
  if (!row) return c.json({ error: 'Laboratório não encontrado' }, 404)
  const v = cleanLab(await c.req.json(), row)
  if (v.error) return c.json(v, 400)
  await db.prepare(`UPDATE inspection_labs SET building = ?, name = ?, location = ?, computers = ?, active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(v.building, v.name, v.location, v.computers, v.active, row.id)
  return c.json(await db.prepare('SELECT * FROM inspection_labs WHERE id = ?').get(row.id))
})

// Excluir: só se nunca foi vistoriado (senão o histórico perderia a referência — desative).
app.delete('/labs/:id', async c => {
  const db = c.get('db')
  const id = c.req.param('id')
  const used = await db.scalar('SELECT COUNT(*) FROM lab_inspections WHERE lab_id = ?', id)
  if (used) return c.json({ error: 'Este laboratório já tem vistorias. Desative em vez de excluir, para manter o histórico.' }, 409)
  await db.prepare('DELETE FROM inspection_labs WHERE id = ?').run(id)
  return c.json({ ok: true })
})

// ── Itens do checklist ────────────────────────────────────────────────────
app.get('/items', async c => {
  const all = c.req.query('all') === '1'
  return c.json(await c.get('db').prepare(
    `SELECT * FROM inspection_items ${all ? '' : 'WHERE active = 1'} ORDER BY sort, label COLLATE NOCASE`).all())
})

function cleanItem(body, current = {}) {
  const pick = (k, fn) => (body[k] !== undefined ? fn(body[k]) : (current[k] ?? null))
  const out = {
    label: pick('label', v => str(v, 80)),
    hint: pick('hint', v => str(v, 160)),
    icon: pick('icon', v => (/^[a-zA-Z]{1,20}$/.test(String(v || '')) ? String(v) : 'check')) || 'check',
    incident_category: pick('incident_category', v => String(v || 'outro')) || 'outro',
    active: pick('active', v => (v === false || v === 0 ? 0 : 1)) ?? 1,
  }
  if (!out.label) return { error: 'Escreva o nome do item' }
  if (!CATEGORIES.includes(out.incident_category)) return { error: 'Tipo de incidente inválido' }
  return out
}

app.post('/items', async c => {
  const db = c.get('db')
  const v = cleanItem(await c.req.json())
  if (v.error) return c.json(v, 400)
  const id = uuid()
  await db.prepare('INSERT INTO inspection_items (id, label, hint, icon, incident_category, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, v.label, v.hint, v.icon, v.incident_category, v.active, await db.scalar('SELECT COALESCE(MAX(sort), 0) + 1 FROM inspection_items'))
  return c.json(await db.prepare('SELECT * FROM inspection_items WHERE id = ?').get(id))
})

// PUT /items/order { ids } — nova ordem
app.put('/items/order', async c => {
  const { ids } = await c.req.json()
  if (!Array.isArray(ids) || !ids.length || ids.length > 200) return c.json({ error: 'Ordem inválida' }, 400)
  await c.get('db').batch(ids.map((id, i) => ({ sql: 'UPDATE inspection_items SET sort = ? WHERE id = ?', args: [i + 1, String(id)] })))
  return c.json({ ok: true })
})

app.put('/items/:id', async c => {
  const db = c.get('db')
  const row = await db.prepare('SELECT * FROM inspection_items WHERE id = ?').get(c.req.param('id'))
  if (!row) return c.json({ error: 'Item não encontrado' }, 404)
  const v = cleanItem(await c.req.json(), row)
  if (v.error) return c.json(v, 400)
  await db.prepare('UPDATE inspection_items SET label = ?, hint = ?, icon = ?, incident_category = ?, active = ? WHERE id = ?')
    .run(v.label, v.hint, v.icon, v.incident_category, v.active, row.id)
  return c.json(await db.prepare('SELECT * FROM inspection_items WHERE id = ?').get(row.id))
})

app.delete('/items/:id', async c => {
  // a vistoria guarda o texto do item, então apagar não mexe no histórico
  await c.get('db').prepare('DELETE FROM inspection_items WHERE id = ?').run(c.req.param('id'))
  return c.json({ ok: true })
})

// ── Histórico e problemas recorrentes ─────────────────────────────────────
const LIST_COLS = `i.id, i.lab_id, i.building, i.lab_name, i.status, i.notes, i.ok_count, i.nok_count, i.na_count,
  i.incident_count, i.created_by, u.name as technician_name, i.started_at, i.finished_at`

// GET / ?building=&lab_id=&days= — vistorias finalizadas (mais novas primeiro)
app.get('/', async c => {
  let sql = `SELECT ${LIST_COLS},
      (SELECT group_concat(a.item_label, '|') FROM lab_inspection_answers a WHERE a.inspection_id = i.id AND a.status = 'nao_conforme') as problems
    FROM lab_inspections i LEFT JOIN users u ON u.id = i.created_by WHERE i.status = 'finalizada'`
  const args = []
  const building = c.req.query('building')
  if (BUILDINGS.includes(building)) { sql += ' AND i.building = ?'; args.push(building) }
  const lab = c.req.query('lab_id')
  if (lab) { sql += ' AND i.lab_id = ?'; args.push(lab) }
  const days = parseInt(c.req.query('days'), 10)
  if (days > 0) { sql += ` AND i.finished_at >= datetime('now', ?)`; args.push(`-${Math.min(days, 3650)} days`) }
  sql += ' ORDER BY i.finished_at DESC LIMIT 300'
  return c.json(await c.get('db').prepare(sql).all(...args))
})

// GET /recurring ?days=90 — item que deu "Não conforme" em 2+ vistorias do mesmo laboratório
app.get('/recurring', async c => {
  const days = Math.min(Math.max(parseInt(c.req.query('days'), 10) || 90, 1), 3650)
  const rows = await c.get('db').prepare(`
    SELECT i.lab_id, i.building, i.lab_name, a.item_id, MAX(a.item_label) as item_label, MAX(a.item_icon) as item_icon,
      COUNT(*) as times, MAX(i.finished_at) as last_at,
      (SELECT COUNT(*) FROM lab_inspections t WHERE t.lab_id = i.lab_id AND t.status = 'finalizada' AND t.finished_at >= datetime('now', ?)) as inspections
    FROM lab_inspection_answers a JOIN lab_inspections i ON i.id = a.inspection_id
    WHERE a.status = 'nao_conforme' AND i.status = 'finalizada' AND i.finished_at >= datetime('now', ?)
    GROUP BY i.lab_id, a.item_id HAVING COUNT(*) >= 2
    ORDER BY times DESC, last_at DESC LIMIT 50
  `).all(`-${days} days`, `-${days} days`)
  return c.json(rows)
})

// ── Uma vistoria ──────────────────────────────────────────────────────────
async function load(c, id) {
  const db = c.get('db')
  const row = await db.prepare(`SELECT ${LIST_COLS}, l.location, l.computers
    FROM lab_inspections i LEFT JOIN users u ON u.id = i.created_by LEFT JOIN inspection_labs l ON l.id = i.lab_id
    WHERE i.id = ?`).get(id)
  if (!row) return null
  row.answers = await db.prepare(`SELECT item_id, item_label, item_icon, sort, status, problem, notes, equipment, needs_maintenance,
      incident_id, photo_thumb, updated_at FROM lab_inspection_answers WHERE inspection_id = ? ORDER BY sort`).all(id)
  // rascunho: o checklist é a lista atual de itens
  if (row.status === 'rascunho') row.items = await db.prepare('SELECT id, label, hint, icon FROM inspection_items WHERE active = 1 ORDER BY sort, label COLLATE NOCASE').all()
  return row
}

// Rascunho só muda nas mãos de quem começou (ou do Super Admin).
async function draftFor(c, id) {
  const row = await c.get('db').prepare('SELECT * FROM lab_inspections WHERE id = ?').get(id)
  if (!row) return { error: c.json({ error: 'Vistoria não encontrada' }, 404) }
  if (row.status !== 'rascunho') return { error: c.json({ error: 'Esta vistoria já foi finalizada.' }, 409) }
  if (row.created_by !== c.get('user').id && !(await isSuper(c))) return { error: c.json({ error: 'Só quem começou a vistoria pode continuá-la.' }, 403) }
  return { row }
}

// POST / { lab_id } — começa (ou retoma o rascunho que a pessoa já tem nesse laboratório)
app.post('/', async c => {
  const db = c.get('db')
  const { lab_id } = await c.req.json()
  const lab = await db.prepare('SELECT * FROM inspection_labs WHERE id = ? AND active = 1').get(String(lab_id || ''))
  if (!lab) return c.json({ error: 'Laboratório não encontrado' }, 404)
  const me = c.get('user').id
  const draft = await db.prepare(`SELECT id FROM lab_inspections WHERE lab_id = ? AND status = 'rascunho' AND created_by = ? ORDER BY started_at DESC LIMIT 1`).get(lab.id, me)
  if (draft) return c.json(await load(c, draft.id))
  const id = uuid()
  await db.prepare('INSERT INTO lab_inspections (id, lab_id, building, lab_name, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(id, lab.id, lab.building, lab.name, me)
  return c.json(await load(c, id))
})

app.get('/:id', async c => {
  const row = await load(c, c.req.param('id'))
  if (!row) return c.json({ error: 'Vistoria não encontrada' }, 404)
  return c.json(row)
})

// PUT /:id { notes } — observações gerais do rascunho
app.put('/:id', async c => {
  const { row, error } = await draftFor(c, c.req.param('id'))
  if (error) return error
  const { notes } = await c.req.json()
  await c.get('db').prepare(`UPDATE lab_inspections SET notes = ?, updated_at = datetime('now') WHERE id = ?`).run(str(notes, 5000), row.id)
  return c.json({ ok: true })
})

// PUT /:id/answers/:itemId { status, problem, notes, equipment, needs_maintenance } — 1 toque = 1 gravação
app.put('/:id/answers/:itemId', async c => {
  const db = c.get('db')
  const { row, error } = await draftFor(c, c.req.param('id'))
  if (error) return error
  const item = await db.prepare('SELECT * FROM inspection_items WHERE id = ?').get(c.req.param('itemId'))
  if (!item) return c.json({ error: 'Item não encontrado' }, 404)
  const b = await c.req.json()
  if (!STATUSES.includes(b.status)) return c.json({ error: 'Escolha Conforme, Não conforme ou Não se aplica' }, 400)
  const nok = b.status === 'nao_conforme'
  // Ao sair de "Não conforme", o problema e a foto deixam de valer.
  await db.prepare(`
    INSERT INTO lab_inspection_answers (inspection_id, item_id, item_label, item_icon, sort, status, problem, notes, equipment, needs_maintenance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(inspection_id, item_id) DO UPDATE SET status = excluded.status, problem = excluded.problem, notes = excluded.notes,
      equipment = excluded.equipment, needs_maintenance = excluded.needs_maintenance,
      photo_thumb = CASE WHEN excluded.status = 'nao_conforme' THEN photo_thumb END,
      photo_data = CASE WHEN excluded.status = 'nao_conforme' THEN photo_data END,
      updated_at = datetime('now')
  `).run(row.id, item.id, item.label, item.icon, item.sort, b.status,
    nok ? str(b.problem, 2000) : null, str(b.notes, 2000), nok ? str(b.equipment, 200) : null, nok && b.needs_maintenance ? 1 : 0)
  await db.prepare(`UPDATE lab_inspections SET updated_at = datetime('now') WHERE id = ?`).run(row.id)
  return c.json({ ok: true })
})

// POST /:id/answers/:itemId/photo { data, thumb } — uma foto por item (já reduzida no navegador)
app.post('/:id/answers/:itemId/photo', async c => {
  const { row, error } = await draftFor(c, c.req.param('id'))
  if (error) return error
  if (Number(c.req.header('Content-Length') || 0) > MAX_PHOTO_CHARS + MAX_THUMB_CHARS + 10_000) return c.json({ error: 'Foto grande demais' }, 413)
  const { data, thumb } = await c.req.json()
  if (!PHOTO_RE.test(data || '') || data.length > MAX_PHOTO_CHARS) return c.json({ error: 'Foto inválida — use JPG, PNG ou WEBP.' }, 400)
  if (!PHOTO_RE.test(thumb || '') || thumb.length > MAX_THUMB_CHARS) return c.json({ error: 'Miniatura inválida' }, 400)
  const res = await c.get('db').prepare(`UPDATE lab_inspection_answers SET photo_thumb = ?, photo_data = ?, updated_at = datetime('now')
    WHERE inspection_id = ? AND item_id = ? AND status = 'nao_conforme'`).run(thumb, data, row.id, c.req.param('itemId'))
  if (!res?.meta?.changes && !res?.changes) return c.json({ error: 'Marque o item como Não conforme antes da foto.' }, 400)
  return c.json({ ok: true, thumb })
})

app.delete('/:id/answers/:itemId/photo', async c => {
  const { row, error } = await draftFor(c, c.req.param('id'))
  if (error) return error
  await c.get('db').prepare('UPDATE lab_inspection_answers SET photo_thumb = NULL, photo_data = NULL WHERE inspection_id = ? AND item_id = ?')
    .run(row.id, c.req.param('itemId'))
  return c.json({ ok: true })
})

app.get('/:id/answers/:itemId/photo', async c => {
  const photo = await c.get('db').prepare('SELECT photo_data as data FROM lab_inspection_answers WHERE inspection_id = ? AND item_id = ?')
    .get(c.req.param('id'), c.req.param('itemId'))
  if (!photo?.data) return c.json({ error: 'Foto não encontrada' }, 404)
  return c.json(photo)
})

// POST /:id/finish { notes } — confere, fecha e abre os incidentes de manutenção
app.post('/:id/finish', async c => {
  const db = c.get('db')
  const { row, error } = await draftFor(c, c.req.param('id'))
  if (error) return error
  const body = await c.req.json().catch(() => ({}))
  const items = await db.prepare('SELECT id, label, incident_category FROM inspection_items WHERE active = 1').all()
  const answers = await db.prepare('SELECT * FROM lab_inspection_answers WHERE inspection_id = ?').all(row.id)
  const byItem = new Map(answers.map(a => [a.item_id, a]))
  const missing = items.filter(i => !byItem.has(i.id))
  if (missing.length) return c.json({ error: `Faltam ${missing.length} item(ns): ${missing.map(i => i.label).join(', ')}.`, missing: missing.map(i => i.id) }, 400)
  const noDesc = answers.filter(a => a.status === 'nao_conforme' && !a.problem)
  if (noDesc.length) return c.json({ error: `Descreva o problema em: ${noDesc.map(a => a.item_label).join(', ')}.`, missing: noDesc.map(a => a.item_id) }, 400)

  const me = c.get('user').id
  const dept = departmentForCreate(await accessOf(c), undefined)
  const occurred = nowBrasilia()
  const cat = new Map(items.map(i => [i.id, i.incident_category]))
  const stmts = []
  let incidents = 0
  for (const a of answers.filter(x => x.status === 'nao_conforme' && x.needs_maintenance)) {
    const incId = uuid()
    incidents++
    const description = [a.problem, a.notes && `Observação: ${a.notes}`, `Encontrado na vistoria do laboratório em ${occurred.slice(8, 10)}/${occurred.slice(5, 7)}.`]
      .filter(Boolean).join('\n\n')
    stmts.push({
      sql: `INSERT INTO lab_incidents (id, building, lab, category, severity, title, description, equipment, occurred_at, reported_by_name, class_info, department_id, created_by)
        VALUES (?, ?, ?, ?, 'media', ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [incId, row.building, row.lab_name, cat.get(a.item_id) || 'outro', `${a.item_label}: ${a.problem}`.slice(0, 140), description,
        a.equipment, occurred, 'Vistoria de laboratório', null, dept, me],
    })
    stmts.push({ sql: 'UPDATE lab_inspection_answers SET incident_id = ? WHERE inspection_id = ? AND item_id = ?', args: [incId, row.id, a.item_id] })
    if (a.photo_data) {
      stmts.push({ sql: 'INSERT INTO lab_incident_photos (id, incident_id, thumb, data, created_by) VALUES (?, ?, ?, ?, ?)', args: [uuid(), incId, a.photo_thumb, a.photo_data, me] })
    }
  }
  const count = s => answers.filter(a => a.status === s).length
  const notes = body.notes !== undefined ? str(body.notes, 5000) : row.notes
  // trava: só fecha se ainda for rascunho (dois toques em "Finalizar" não criam incidente em dobro)
  const res = await db.prepare(`UPDATE lab_inspections SET status = 'finalizada', notes = ?, ok_count = ?, nok_count = ?, na_count = ?, incident_count = ?,
      finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'rascunho'`)
    .run(notes, count('conforme'), count('nao_conforme'), count('na'), incidents, row.id)
  if (!(res?.meta?.changes ?? res?.changes)) return c.json({ error: 'Esta vistoria já foi finalizada.' }, 409)
  if (stmts.length) await db.batch(stmts)
  return c.json(await load(c, row.id))
})

// DELETE /:id — descartar o rascunho (quem começou) ou apagar vistoria finalizada (Super Admin)
app.delete('/:id', async c => {
  const db = c.get('db')
  const row = await db.prepare('SELECT * FROM lab_inspections WHERE id = ?').get(c.req.param('id'))
  if (!row) return c.json({ error: 'Vistoria não encontrada' }, 404)
  const mine = row.created_by === c.get('user').id
  if (row.status === 'rascunho' ? !(mine || await isSuper(c)) : !(await isSuper(c))) {
    return c.json({ error: row.status === 'rascunho' ? 'Só quem começou pode descartar.' : 'Só o Super Admin apaga uma vistoria finalizada.' }, 403)
  }
  await db.batch([
    { sql: 'DELETE FROM lab_inspection_answers WHERE inspection_id = ?', args: [row.id] },
    { sql: 'DELETE FROM lab_inspections WHERE id = ?', args: [row.id] },
  ])
  return c.json({ ok: true })
})

export default app
