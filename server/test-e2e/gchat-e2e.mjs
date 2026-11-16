// E2E: avisos de empréstimo pelo Google Chat (app UniFlow).
// Precisa do servidor de teste com o Google de mentira:
//   cd server && MOCK_GMAIL=1 node test-e2e/node-server.mjs
//   node test-e2e/gchat-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const EVENTS = `${BASE}/api/google-chat/events`
const key = new TextEncoder().encode('testsecret')
const tok = (id, email) => new SignJWT({ id, name: id, email, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tok('u-test', 'teste@colegioser.com'), colab: await tok('u-col', 'u-col@colegioser.com') }
const call = async (who, method, path, body, headers = {}) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who] ?? who}`, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
const mock = async (path, body) => (await fetch(BASE + '/__mock' + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })).json()
const sleep = ms => new Promise(r => setTimeout(r, ms))
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }
const sentTo = async space => (await mock('/gchat/sent')).sent.filter(m => m.space === space)
const waitSent = async (space, n) => { for (let i = 0; i < 40; i++) { const s = await sentTo(space); if (s.length >= n) return s; await sleep(100) } return sentTo(space) }

// ── Eventos do Google ────────────────────────────────────────────────────
let r = await fetch(EVENTS, { method: 'POST', body: '{}' })
expect('Evento sem assinatura do Google → 401', r.status, 401)
const forged = (await mock('/gchat-token', { aud: EVENTS, email: 'alguem@gmail.com' })).token
r = await fetch(EVENTS, { method: 'POST', headers: { Authorization: `Bearer ${forged}` }, body: '{}' })
expect('Token do Google de outra conta → 401', r.status, 401)
const wrongAud = (await mock('/gchat-token', { aud: 'https://outro-site/x' })).token
r = await fetch(EVENTS, { method: 'POST', headers: { Authorization: `Bearer ${wrongAud}` }, body: '{}' })
expect('Token pra outro endereço → 401', r.status, 401)

const g = (await mock('/gchat-token', { aud: EVENTS })).token
const added = { chat: { user: { email: 'prof.ana@pro.fecaf.com.br', displayName: 'Ana' }, addedToSpacePayload: { space: { name: 'spaces/ANA', spaceType: 'DIRECT_MESSAGE' } } } }
r = await call(g, 'POST', '/api/google-chat/events', added)
expect('Adicionou o app → 200', r.s, 200)
expect('Responde com boas-vindas (formato complemento)', /UniFlow/.test(r.j?.hostAppDataAction?.chatDataAction?.createMessageAction?.message?.text || ''), true)
let row = (await mock('/sql', { sql: "SELECT space FROM google_chat_dms WHERE email = 'prof.ana@pro.fecaf.com.br'" }))[0]
expect('Guarda a conversa da pessoa', row?.space, 'spaces/ANA')
r = await call(g, 'POST', '/api/google-chat/events', { type: 'MESSAGE', user: { email: 'prof.ana@pro.fecaf.com.br' }, space: { name: 'spaces/ANA', type: 'DM' }, message: { text: 'oi' } })
expect('Mensagem da pessoa (formato clássico) → resposta em texto', /meajuda/.test(r.j?.text || ''), true)

// ── Avisos do empréstimo ─────────────────────────────────────────────────
await mock('/setting', { key: 'gchat_loans_enabled', value: 'false' })
const loanBody = email => ({ requester_name: 'Ana', requester_email: email, equipment_model: 'Chromebook', patrimony: 'P-100', building: 'sede', send_email: true, deadline_period: 'noite' })
r = await call('admin', 'POST', '/api/equipment-loans', loanBody('prof.ana@pro.fecaf.com.br'))
expect('Empréstimo registrado', r.s, 200)
await sleep(800)
expect('Desligado no Admin: nada vai pro Chat', (await sentTo('spaces/ANA')).length, 0)

await mock('/setting', { key: 'gchat_loans_enabled', value: 'true' })
r = await call('admin', 'POST', '/api/equipment-loans', loanBody('prof.ana@pro.fecaf.com.br'))
const loanId = r.j?.id
let sent = await waitSent('spaces/ANA', 1)
expect('Ligado: aviso do empréstimo chega no Chat', sent.length, 1)
expect('Aviso tem o equipamento e o prazo', /Chromebook \(P-100\)/.test(sent[0]?.text) && /22h/.test(sent[0]?.text), true)

r = await call('admin', 'POST', `/api/equipment-loans/${loanId}/message`, { message: 'Favor devolver hoje.' })
expect('Mensagem rápida → 200 (e-mail)', r.s, 200)
sent = await sentTo('spaces/ANA')
expect('Mensagem rápida também vai pro Chat', /Favor devolver hoje\./.test(sent[1]?.text || ''), true)

// Quem não tem o app: pergunta ao Google 1 vez e lembra do "não tem"
const before = (await mock('/gchat/sent')).lookups
await call('admin', 'POST', '/api/equipment-loans', loanBody('sem.app@fecaf.com.br'))
await call('admin', 'POST', '/api/equipment-loans', loanBody('sem.app@fecaf.com.br'))
await sleep(800)
const after = (await mock('/gchat/sent')).lookups
expect('Sem o app: só 1 consulta ao Google para 2 empréstimos', after - before, 1)

// Quem tinha o app antes: achado pelo findDirectMessage
await mock('/gchat/dms', { 'beto@fecaf.com.br': 'spaces/BETO' })
await call('admin', 'POST', '/api/equipment-loans', loanBody('beto@fecaf.com.br'))
expect('Conversa achada no Google → aviso enviado', (await waitSent('spaces/BETO', 1)).length, 1)

// Removeu o app: esquece a conversa
await call(g, 'POST', '/api/google-chat/events', { chat: { user: { email: 'prof.ana@pro.fecaf.com.br' }, removedFromSpacePayload: { space: { name: 'spaces/ANA' } } } })
row = (await mock('/sql', { sql: "SELECT space FROM google_chat_dms WHERE email = 'prof.ana@pro.fecaf.com.br'" }))[0]
expect('Removeu o app → conversa esquecida', row?.space ?? null, null)

// ── Teste do Admin ───────────────────────────────────────────────────────
r = await call('colab', 'POST', '/api/google-chat/test')
expect('Teste: quem não é Super Admin → 403', r.s, 403)
r = await call('admin', 'POST', '/api/google-chat/test')
expect('Teste sem o app → explica como adicionar', r.s === 502 && /adicione o app/.test(r.j?.error || ''), true)
await mock('/sql', { sql: "DELETE FROM google_chat_dms WHERE email = 'teste@colegioser.com'" })
await mock('/gchat/dms', { 'teste@colegioser.com': 'spaces/ADM' })
r = await call('admin', 'POST', '/api/google-chat/test')
expect('Teste com o app → enviado', r.s, 200)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
