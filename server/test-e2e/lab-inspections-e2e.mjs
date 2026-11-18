// E2E: Fluxos → Vistoria de Laboratórios (laboratórios, checklist, rascunho,
// finalizar → incidentes, histórico, recorrentes, permissões).
//   cd server && node test-e2e/node-server.mjs
//   node test-e2e/lab-inspections-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const tok = id => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tok('u-test'), ti: await tok('d-ti-ana'), colab: await tok('u-col'), aud: await tok('u-aud') }
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who]}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k='
const P = '/api/lab-inspections'

// ── Itens e laboratórios ─────────────────────────────────────────────────
let r = await call('ti', 'GET', `${P}/items`)
expect('10 itens iniciais no checklist', r.j?.length, 10)
const items = r.j
expect('Colaborador (só ver) não cria laboratório', (await call('colab', 'POST', `${P}/labs`, { building: 'sede', name: 'X' })).s, 403)
expect('prédio inválido recusado', (await call('ti', 'POST', `${P}/labs`, { building: 'x', name: 'Lab' })).s, 400)
r = await call('ti', 'POST', `${P}/labs`, { building: 'sede', name: 'Laboratório Vistoria', location: '2º andar', computers: 30 })
expect('Analista cria laboratório', r.s, 200)
const lab = r.j
r = await call('ti', 'POST', `${P}/labs`, { building: 'g5', name: 'Lab vazio' })
const emptyLab = r.j
expect('lab sem vistoria pode ser excluído', (await call('ti', 'DELETE', `${P}/labs/${emptyLab.id}`)).s, 200)

// ── Rascunho ─────────────────────────────────────────────────────────────
expect('Colaborador não começa vistoria', (await call('colab', 'POST', P, { lab_id: lab.id })).s, 403)
r = await call('ti', 'POST', P, { lab_id: lab.id })
expect('começa vistoria', r.s, 200)
const insp = r.j
expect('...rascunho com o checklist atual', `${insp?.status}|${insp?.items?.length}|${insp?.computers}`, 'rascunho|10|30')
r = await call('ti', 'POST', P, { lab_id: lab.id })
expect('2º toque no mesmo laboratório retoma o rascunho', r.j?.id, insp.id)
r = await call('ti', 'GET', `${P}/labs`)
expect('lista de laboratórios mostra o rascunho', r.j?.find(l => l.id === lab.id)?.draft_id, insp.id)

expect('status inválido recusado', (await call('ti', 'PUT', `${P}/${insp.id}/answers/${items[0].id}`, { status: 'x' })).s, 400)
expect('Super Admin também mexe no rascunho de outra pessoa', (await call('admin', 'PUT', `${P}/${insp.id}/answers/${items[0].id}`, { status: 'conforme' })).s, 200) // Super Admin pode
for (const it of items.slice(0, 7)) await call('ti', 'PUT', `${P}/${insp.id}/answers/${it.id}`, { status: 'conforme' })
expect('foto antes de "Não conforme" recusada', (await call('ti', 'POST', `${P}/${insp.id}/answers/${items[7].id}/photo`, { data: JPG, thumb: JPG })).s, 400)
await call('ti', 'PUT', `${P}/${insp.id}/answers/${items[7].id}`, { status: 'nao_conforme', problem: 'Duas lâmpadas queimadas', equipment: 'Lâmpadas fundo', needs_maintenance: true })
expect('foto no item não conforme', (await call('ti', 'POST', `${P}/${insp.id}/answers/${items[7].id}/photo`, { data: JPG, thumb: JPG })).s, 200)
await call('ti', 'PUT', `${P}/${insp.id}/answers/${items[8].id}`, { status: 'nao_conforme', problem: '' })

r = await call('ti', 'POST', `${P}/${insp.id}/finish`, {})
expect('finalizar com item faltando → 400', r.s, 400)
expect('...diz qual falta', r.j?.missing?.includes(items[9].id), true)
await call('ti', 'PUT', `${P}/${insp.id}/answers/${items[9].id}`, { status: 'na' })
r = await call('ti', 'POST', `${P}/${insp.id}/finish`, {})
expect('não conforme sem descrição → 400', r.s, 400)
await call('ti', 'PUT', `${P}/${insp.id}/answers/${items[8].id}`, { status: 'nao_conforme', problem: 'Cadeira 4 quebrada', needs_maintenance: false })

r = await call('ti', 'GET', `${P}/${insp.id}`)
expect('rascunho guarda a miniatura', r.j?.answers?.find(a => a.item_id === items[7].id)?.photo_thumb, JPG)

// ── Finalizar ────────────────────────────────────────────────────────────
r = await call('ti', 'POST', `${P}/${insp.id}/finish`, { notes: 'Sala ok no geral' })
expect('finaliza', r.s, 200)
expect('...contagens', `${r.j?.status}|${r.j?.ok_count}|${r.j?.nok_count}|${r.j?.na_count}|${r.j?.incident_count}`, 'finalizada|7|2|1|1')
expect('...técnico registrado', r.j?.created_by, 'd-ti-ana')
const incId = r.j?.answers?.find(a => a.item_id === items[7].id)?.incident_id
expect('...item de manutenção virou incidente', !!incId, true)
expect('...o outro não', r.j?.answers?.find(a => a.item_id === items[8].id)?.incident_id, null)
r = await call('ti', 'GET', `/api/lab-incidents/${incId}`)
expect('incidente com laboratório, problema e foto', `${r.j?.lab}|${r.j?.status}|${r.j?.photos?.length}`, 'Laboratório Vistoria|aberto|1')
expect('finalizar de novo → 409 (não duplica)', (await call('ti', 'POST', `${P}/${insp.id}/finish`, {})).s, 409)
expect('finalizada não aceita mudança', (await call('ti', 'PUT', `${P}/${insp.id}/answers/${items[0].id}`, { status: 'na' })).s, 409)
expect('foto grande sob demanda', (await call('colab', 'GET', `${P}/${insp.id}/answers/${items[7].id}/photo`)).j?.data, JPG)

// ── Histórico e recorrentes ──────────────────────────────────────────────
r = await call('colab', 'GET', `${P}?building=sede`)
expect('Colaborador consulta o histórico', r.j?.some(i => i.id === insp.id), true)
expect('...com os itens com problema', r.j?.find(i => i.id === insp.id)?.problems?.includes('Iluminação'), true)
// 2ª vistoria com o mesmo problema
const second = (await call('ti', 'POST', P, { lab_id: lab.id })).j
for (const it of items) await call('ti', 'PUT', `${P}/${second.id}/answers/${it.id}`, it.id === items[7].id ? { status: 'nao_conforme', problem: 'Lâmpada de novo' } : { status: 'conforme' })
expect('2ª vistoria finalizada', (await call('ti', 'POST', `${P}/${second.id}/finish`, {})).s, 200)
r = await call('ti', 'GET', `${P}/recurring?days=90`)
const rec = r.j?.find(x => x.lab_id === lab.id && x.item_id === items[7].id)
expect('Iluminação aparece como recorrente (2 de 2)', `${rec?.times}|${rec?.inspections}`, '2|2')
// ── Vistoria diária ──────────────────────────────────────────────────────
const brToday = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
r = await call('ti', 'GET', `${P}/labs`)
const labRow = r.j?.find(l => l.id === lab.id)
expect('laboratório: feita hoje (dia de Brasília)', labRow?.last_day, brToday)
expect('laboratório: quem fez a última', labRow?.last_by, 'd-ti-ana')
expect('laboratório sem vistoria: sem last_day', r.j?.find(l => l.id === emptyLab.id)?.last_day ?? null, null)
r = await call('ti', 'GET', `${P}/daily?days=14`)
const dayRow = r.j?.rows?.find(x => x.lab_id === lab.id)
expect('dia a dia: hoje = Brasília', r.j?.today, brToday)
expect('dia a dia: 2 vistorias hoje, com problema', `${dayRow?.day}|${dayRow?.n}|${dayRow?.nok > 0}`, `${brToday}|2|true`)
expect('Auditor vê o dia a dia', (await call('aud', 'GET', `${P}/daily`)).s, 200)
const labs74 = (await call('admin', 'GET', `${P}/labs`)).j || []
const by = n => labs74.find(l => l.name === `Laboratório ${n}`)?.building
expect('lista oficial (0074): 01 CENTRO, 04 SEDE, 21 G5, 22 SEDE', [by('01'), by('04'), by('21'), by('22')].join(','), 'centro,sede,g5,sede')

expect('laboratório usado não pode ser excluído', (await call('ti', 'DELETE', `${P}/labs/${lab.id}`)).s, 409)

// ── Descartar / apagar ───────────────────────────────────────────────────
const draft = (await call('ti', 'POST', P, { lab_id: lab.id })).j
expect('Analista descarta o próprio rascunho', (await call('ti', 'DELETE', `${P}/${draft.id}`)).s, 200)
expect('Analista não apaga vistoria finalizada', (await call('ti', 'DELETE', `${P}/${second.id}`)).s, 403)
expect('Super Admin apaga', (await call('admin', 'DELETE', `${P}/${second.id}`)).s, 200)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
