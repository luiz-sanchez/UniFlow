// Avisos pelo Google Chat (app "UniFlow", projeto 320230369357 da helpdesk.ti,
// organização Colégio Ser — fecaf.com.br, pro.fecaf.com.br e colegioser.com).
//
// O app escreve na conversa 1:1 dele com a pessoa, usando a conta de serviço
// (GOOGLE_SA_*) com o escopo chat.bot — sem delegação em todo o domínio.
// Limite do Google: com a autenticação do app NÃO dá pra criar a conversa;
// ela só existe depois que a pessoa adiciona o app (ou o Admin instala pra
// todos). Por isso: quando o Google avisa que adicionaram o app, guardamos a
// conversa em google_chat_dms; se não tiver, perguntamos (findDirectMessage)
// e guardamos também o "não tem" por 6 h pra não perguntar a cada empréstimo.
// O e-mail continua saindo sempre — o Chat é um aviso a mais.
import { SignJWT, importPKCS8, createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose'

const SCOPE = 'https://www.googleapis.com/auth/chat.bot'
const API = 'https://chat.googleapis.com/v1'
const NEGATIVE_TTL_MS = 6 * 3600 * 1000

let cachedToken = null // { token, exp } — vale pro isolate inteiro

export const chatConfigured = env => !!(env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY)

export async function chatEnabled(db) {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'gchat_loans_enabled'").get()
  return row?.value === 'true'
}

async function getChatToken(env) {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token
  const pem = env.GOOGLE_SA_PRIVATE_KEY.includes('\\n') ? env.GOOGLE_SA_PRIVATE_KEY.replace(/\\n/g, '\n') : env.GOOGLE_SA_PRIVATE_KEY
  const key = await importPKCS8(pem, 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(env.GOOGLE_SA_EMAIL)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now).setExpirationTime(now + 3600)
    .sign(key)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!res.ok) throw new Error(`Google token (Chat) respondeu ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const data = await res.json()
  cachedToken = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 }
  return cachedToken.token
}

async function chatFetch(env, path, init = {}) {
  const token = await getChatToken(env)
  return fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
}

// Conversa 1:1 do app com a pessoa (ou null se ela ainda não adicionou o app).
export async function findDmSpace(env, db, email) {
  const e = email.trim().toLowerCase()
  const row = await db.prepare('SELECT space, checked_at FROM google_chat_dms WHERE email = ?').get(e)
  if (row?.space) return row.space
  if (row && Date.now() - Date.parse(row.checked_at + 'Z') < NEGATIVE_TTL_MS) return null

  const res = await chatFetch(env, `/spaces:findDirectMessage?name=${encodeURIComponent(`users/${e}`)}`)
  let space = null
  if (res.ok) space = (await res.json()).name || null
  else if (res.status !== 404) throw new Error(`Chat findDirectMessage respondeu ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  await rememberDm(db, e, space)
  return space
}

export async function rememberDm(db, email, space) {
  await db.prepare(`INSERT INTO google_chat_dms (email, space, checked_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(email) DO UPDATE SET space = excluded.space, checked_at = excluded.checked_at`).run(email.trim().toLowerCase(), space)
}

export async function forgetDmSpace(db, space) {
  await db.prepare("UPDATE google_chat_dms SET space = NULL, checked_at = datetime('now') WHERE space = ?").run(space)
}

// Manda `text` (Markdown padrão — o app está configurado assim no console: **negrito**, listas com "-").
// Devolve { ok: true } | { ok: false, reason: 'off'|'no_dm'|'error', error? }. Nunca lança.
export async function sendChatToEmail(env, db, email, text, { force = false } = {}) {
  try {
    if (!chatConfigured(env) || !email?.includes('@')) return { ok: false, reason: 'off' }
    if (!force && !(await chatEnabled(db))) return { ok: false, reason: 'off' }
    const space = await findDmSpace(env, db, email)
    if (!space) return { ok: false, reason: 'no_dm' }
    const res = await chatFetch(env, `/${space}/messages`, { method: 'POST', body: JSON.stringify({ text }) })
    if (res.ok) return { ok: true }
    // conversa apagada/app removido: esquece e tenta descobrir de novo na próxima
    if (res.status === 404 || res.status === 403) await forgetDmSpace(db, space)
    return { ok: false, reason: 'error', error: `Chat respondeu ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` }
  } catch (e) {
    console.error('[gchat] envio falhou', e.message)
    return { ok: false, reason: 'error', error: e.message }
  }
}

// ── Eventos que o Google manda pro app (alguém adicionou, escreveu, removeu) ──
// O Google assina cada chamada. Dois formatos possíveis, conforme a configuração:
//  - app do Chat clássico: emissor chat@system.gserviceaccount.com, público = nº do projeto;
//  - complemento do Workspace / público = URL: token OIDC do Google (accounts.google.com)
//    emitido para uma conta de serviço do Google (gcp-sa-gsuiteaddons ou chat@system).
const PROJECT_NUMBER = '320230369357'
const CHAT_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com'))
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

export async function verifyChatRequest(env, authHeader, endpointUrl) {
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return false
  try {
    const { iss } = decodeJwt(token)
    const audience = [PROJECT_NUMBER, endpointUrl]
    if (iss === 'chat@system.gserviceaccount.com') {
      await jwtVerify(token, CHAT_JWKS, { issuer: iss, audience })
      return true
    }
    const { payload } = await jwtVerify(token, GOOGLE_JWKS, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience })
    const email = String(payload.email || '')
    return payload.email_verified !== false && (email === 'chat@system.gserviceaccount.com'
      || email === `service-${PROJECT_NUMBER}@gcp-sa-gsuiteaddons.iam.gserviceaccount.com`)
  } catch (e) {
    console.error('[gchat] token do evento recusado', e.message)
    return false
  }
}
