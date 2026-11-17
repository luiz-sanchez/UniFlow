// Google Chat (ver lib/googleChat.js). Os avisos saem como conversa normal da
// conta da T.I.; o app "UniFlow" do console continua existindo (o Google exige um
// app configurado pra usar a API do Chat) e só responde quem falar com ele:
//   POST /events — o Google chama quando alguém adiciona ou escreve pro app
//                  (pública, mas só aceita chamada assinada pelo Google).
//   POST /test   — Super Admin manda um aviso de teste pra si mesmo.
import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'
import { verifyChatRequest, sendChatToEmail, chatEnabled, chatSender } from '../lib/googleChat.js'

const app = new Hono()

const WELCOME = 'Olá! Sou o UniFlow, da equipe de T.I. Os avisos de empréstimo chegam pela conversa com a conta da T.I.'
const ONLY_NOTICES = 'Por aqui eu só envio avisos. Para falar com a T.I., responda o e-mail do empréstimo ou escreva para meajuda@fecaf.com.br.'

// Junta os dois formatos de evento (app clássico × complemento do Workspace).
function readEvent(body) {
  if (body?.chat) {
    const ch = body.chat
    const p = ch.addedToSpacePayload || ch.messagePayload || ch.removedFromSpacePayload || ch.appCommandPayload || {}
    const type = ch.addedToSpacePayload ? 'ADDED_TO_SPACE' : ch.removedFromSpacePayload ? 'REMOVED_FROM_SPACE'
      : ch.messagePayload || ch.appCommandPayload ? 'MESSAGE' : 'OTHER'
    return { addon: true, type, space: p.space || p.message?.space, user: ch.user }
  }
  return { addon: false, type: body?.type, space: body?.space || body?.message?.space, user: body?.user }
}

const reply = (addon, text) => addon
  ? { hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text } } } } }
  : { text }

app.post('/events', async c => {
  const url = new URL(c.req.url)
  if (!(await verifyChatRequest(c.env, c.req.header('Authorization'), `${url.origin}${url.pathname}`))) {
    return c.json({ error: 'Chamada não veio do Google Chat' }, 401)
  }
  const ev = readEvent(await c.req.json().catch(() => ({})))
  if (ev.type === 'ADDED_TO_SPACE') return c.json(reply(ev.addon, WELCOME))
  if (ev.type === 'MESSAGE') return c.json(reply(ev.addon, ONLY_NOTICES))
  return c.json({})
})

app.post('/test', auth, async c => {
  const db = c.get('db')
  const me = await db.prepare('SELECT email, system_role FROM users WHERE id = ?').get(c.get('user').id)
  if (me?.system_role !== 'super_admin') return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)
  const enabled = await chatEnabled(db)
  if (me.email.toLowerCase() === chatSender(c.env)) return c.json({ error: `Os avisos saem da conta ${me.email} — entre no UniFlow com outra conta para testar.` }, 400)
  // teste é sob demanda: não usa o "não achei" guardado
  await db.prepare('DELETE FROM google_chat_dms WHERE email = ? AND space IS NULL').run(me.email.toLowerCase())
  const r = await sendChatToEmail(c.env, db, me.email,
    `✅ **Teste do UniFlow**\nSe você está lendo isto, os avisos de empréstimo pelo Google Chat estão funcionando${enabled ? '' : ' (ainda desligados no Admin — só este teste saiu)'}.`,
    { force: true })
  if (r.ok) return c.json({ ok: true })
  const error = r.reason === 'no_dm'
    ? `O Google Chat não reconheceu ${me.email}.`
    : r.reason === 'off' ? 'A conta de serviço do Google não está configurada no servidor.'
    : /unauthorized_client/.test(r.error || '') ? 'Falta autorizar o Chat na delegação do Google Admin (Segurança → Controles de API → Delegação em todo o domínio).'
    : `O Google Chat recusou: ${r.error}`
  return c.json({ error }, 502)
})

export default app
