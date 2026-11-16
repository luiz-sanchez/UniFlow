// E2E: avisos de empréstimo pelo Google Chat — conversa normal da conta da T.I.
// (delegação + spaces.setup), sem ninguém instalar app.
// Precisa do servidor de teste com o Google de mentira:
//   cd server && MOCK_GMAIL=1 node test-e2e/node-server.mjs
//   node test-e2e/gchat-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const EVENTS = `${BASE}/api/google-chat/events`
const key = new TextEncoder().encode('testsecret')
const tok = (id, email) => new SignJWT({ id, name: id, email, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tok('u-test', 'teste@colegioser.com'), colab: await tok('u-col', 'u-col@colegioser.com') }
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who] ?? who}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
const mock = async (path, body) => (await fetch(BASE + '/__mock' + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })).json()
const sleep = ms => new Promise(r => setTimeout(r, ms))
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }
const sentTo = async space => (await mock('/gchat/sent')).sent.filter(m => m.space === space)
const waitSent = async (space, n) => { for (let i = 0; i < 40; i++) { const s = await sentTo(space); if (s.length >= n) return s; await sleep(100) } return sentTo(space) }
const lookups = async () => (await mock('/gchat/sent')).lookups

// ── Eventos do app (só responde; não guarda nada) ────────────────────────
let r = await fetch(EVENTS, { method: 'POST', body: '{}' })
expect('Evento sem assinatura do Google → 401', r.status, 401)
const forged = (await mock('/gchat-token', { aud: EVENTS, email: 'alguem@gmail.com' })).token
r = await fetch(EVENTS, { method: 'POST', headers: { Authorization: `Bearer ${forged}` }, body: '{}' })
expect('Token do Google de outra conta → 401', r.status, 401)
const wrongAud = (await mock('/gchat-token', { aud: 'https://outro-site/x' })).token
r = await fetch(EVENTS, { method: 'POST', headers: { Authorization: `Bearer ${wrongAud}` }, body: '{}' })
expect('Token pra outro endereço → 401', r.status, 401)
const g = (await mock('/gchat-token', { aud: EVENTS })).token
r = await call(g, 'POST', '/api/google-chat/events', { type: 'MESSAGE', user: { email: 'x@fecaf.com.br' }, space: { name: 'spaces/X', type: 'DM' }, message: { text: 'oi' } })
expect('Mensagem pro app → resposta indicando o meajuda', /meajuda/.test(r.j?.text || ''), true)

// ── Avisos do empréstimo ─────────────────────────────────────────────────
const ANA = 'prof.ana@pro.fecaf.com.br', DM_ANA = `spaces/DM-${ANA}`
const loanBody = email => ({ requester_name: 'Ana', requester_email: email, equipment_model: 'Chromebook', patrimony: 'P-100', building: 'sede', send_email: true, deadline_period: 'noite' })
await mock('/setting', { key: 'gchat_loans_enabled', value: 'false' })
r = await call('admin', 'POST', '/api/equipment-loans', loanBody(ANA))
expect('Empréstimo registrado', r.s, 200)
await sleep(800)
expect('Desligado no Admin: nada vai pro Chat', (await sentTo(DM_ANA)).length, 0)

await mock('/setting', { key: 'gchat_loans_enabled', value: 'true' })
r = await call('admin', 'POST', '/api/equipment-loans', loanBody(ANA))
const loanId = r.j?.id
let sent = await waitSent(DM_ANA, 1)
expect('Ligado: aviso chega na conversa com a conta da T.I. (sem app)', sent.length, 1)
expect('Aviso tem o equipamento e o prazo', /Chromebook \(P-100\)/.test(sent[0]?.text) && /22h/.test(sent[0]?.text), true)
let row = (await mock('/sql', { sql: 'SELECT space FROM google_chat_dms WHERE email = ?', args: [ANA] }))[0]
expect('Conversa guardada', row?.space, DM_ANA)

const before = await lookups()
r = await call('admin', 'POST', `/api/equipment-loans/${loanId}/message`, { message: 'Favor devolver hoje.' })
expect('Mensagem rápida → 200 (e-mail)', r.s, 200)
sent = await sentTo(DM_ANA)
expect('Mensagem rápida também vai pro Chat', /Favor devolver hoje\./.test(sent[1]?.text || ''), true)
expect('Conversa já guardada: não pergunta ao Google de novo', (await lookups()) - before, 0)

// E-mail que o Google não conhece: pergunta 1 vez e lembra
const b2 = await lookups()
await call('admin', 'POST', '/api/equipment-loans', loanBody('nao.existe@fecaf.com.br'))
await call('admin', 'POST', '/api/equipment-loans', loanBody('nao.existe@fecaf.com.br'))
await sleep(800)
expect('Desconhecido: só 1 consulta para 2 empréstimos', (await lookups()) - b2, 1)

// A própria conta da T.I. como solicitante: não manda pra si mesma
const b3 = await lookups()
await call('admin', 'POST', '/api/equipment-loans', loanBody('helpdesk.ti@fecaf.com.br'))
await sleep(800)
expect('Solicitante = conta da T.I.: não tenta o Chat', (await lookups()) - b3, 0)

// ── Teste do Admin ───────────────────────────────────────────────────────
r = await call('colab', 'POST', '/api/google-chat/test')
expect('Teste: quem não é Super Admin → 403', r.s, 403)
r = await call('admin', 'POST', '/api/google-chat/test')
expect('Teste → enviado', r.s, 200)
expect('Teste chega na conversa do admin', (await sentTo('spaces/DM-teste@colegioser.com')).length, 1)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
