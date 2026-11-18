// E2E: envio de e-mail pelo Gmail — conta de serviço (gmail.send) primeiro,
// token OAuth antigo como plano B, e falha VISÍVEL (erro na fila + sininho).
// Em nov/2026 o token OAuth parou de valer e ~230 e-mails ficaram presos sem aviso.
//   cd server && MOCK_GMAIL=1 node test-e2e/node-server.mjs
//   node test-e2e/email-send-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const admin = await new SignJWT({ id: 'u-test', name: 'u-test', email: 'teste@colegioser.com', tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
const mock = async (path, body) => (await fetch(BASE + '/__mock' + path, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined })).json()
const sql = (q, args) => mock('/sql', { sql: q, args })
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }
const lastSent = async () => (await mock('/gmail/sent')).at(-1)
const status = async () => JSON.parse((await mock('/setting?key=email_send_status'))?.value || '{}')
const alerts = async () => (await sql("SELECT COUNT(*) n FROM notifications WHERE user_id = 'u-test' AND title LIKE '%E-mails do UniFlow%'"))[0].n
await sql("UPDATE email_outbox SET status = 'failed' WHERE status = 'pending'")
await sql("DELETE FROM app_settings WHERE key IN ('email_send_status', 'email_send_alert_at')")

// 1) Normal: sai pela conta de serviço
let r = await call('POST', '/api/admin/settings/email-outbox/test', { to: 'alguem@fecaf.com.br' })
expect('envia', r.j?.sent, 1)
expect('...pela conta de serviço (gmail.send)', (await lastSent())?.token, 'sa-send-token')
expect('situação registrada como ok', (await status()).ok, true)

// 2) Como em nov/2026: OAuth revogado — a conta de serviço segura sozinha
await mock('/gmail/mode', { oauthBroken: true })
r = await call('POST', '/api/admin/settings/email-outbox/test', { to: 'alguem@fecaf.com.br' })
expect('OAuth revogado: ainda envia (conta de serviço)', r.j?.sent, 1)

// 3) Conta de serviço sem gmail.send, OAuth ok → plano B
await mock('/gmail/mode', { oauthBroken: false, saSendDenied: true })
r = await call('POST', '/api/admin/settings/email-outbox/test', { to: 'alguem@fecaf.com.br' })
expect('sem gmail.send: cai no token OAuth', (await lastSent())?.token, 'oauth-token')

// 4) Os dois quebrados: fica na fila COM o motivo + aviso no sininho (1 por dia)
await mock('/gmail/mode', { oauthBroken: true, saSendDenied: true })
r = await call('POST', '/api/admin/settings/email-outbox/test', { to: 'alguem@fecaf.com.br' })
expect('nada enviado', r.j?.sent, 0)
const row = (await sql("SELECT status, error FROM email_outbox WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1"))[0]
expect('continua na fila', row?.status, 'pending')
expect('...com o motivo à vista', /Ainda não enviado: .*unauthorized_client/.test(row?.error || ''), true)
expect('situação registrada como parada', (await status()).ok, false)
expect('Super Admin avisado no sininho', await alerts(), 1)
await call('POST', '/api/admin/settings/email-outbox/flush')
expect('...só 1 aviso por dia', await alerts(), 1)

// 5) Voltou: a fila esvazia
await mock('/gmail/mode', { oauthBroken: false, saSendDenied: false })
r = await call('POST', '/api/admin/settings/email-outbox/flush')
expect('autorizado de novo: a fila sai', r.j?.sent, 1)
expect('situação volta a ok', (await status()).ok, true)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
