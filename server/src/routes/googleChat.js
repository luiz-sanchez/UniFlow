// Google Chat — app "UniFlow" (ver lib/googleChat.js).
//   POST /events — o Google chama quando alguém adiciona, escreve ou remove o app
//                  (pública, mas só aceita chamada assinada pelo Google).
//   POST /test   — Super Admin manda um aviso de teste pra si mesmo.
import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'
import { verifyChatRequest, rememberDm, forgetDmSpace, sendChatToEmail, chatEnabled } from '../lib/googleChat.js'

const app = new Hono()

const WELCOME = 'Olá! Sou o **UniFlow**, da equipe de T.I. Por aqui você recebe os avisos dos seus empréstimos de equipamentos (o que foi registrado em seu nome e o prazo de devolução).'
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

const isDm = space => space?.spaceType === 'DIRECT_MESSAGE' || space?.type === 'DM' || space?.singleUserBotDm

app.post('/events', async c => {
  const url = new URL(c.req.url)
  if (!(await verifyChatRequest(c.env, c.req.header('Authorization'), `${url.origin}${url.pathname}`))) {
    return c.json({ error: 'Chamada não veio do Google Chat' }, 401)
  }
  const db = c.get('db')
  const ev = readEvent(await c.req.json().catch(() => ({})))
  const email = ev.user?.email

  if (ev.type === 'ADDED_TO_SPACE') {
    if (email && ev.space?.name && isDm(ev.space)) await rememberDm(db, email, ev.space.name)
    return c.json(reply(ev.addon, WELCOME))
  }
  if (ev.type === 'REMOVED_FROM_SPACE') {
    if (ev.space?.name) await forgetDmSpace(db, ev.space.name)
    return c.json({})
  }
  if (ev.type === 'MESSAGE') {
    // quem já tinha o app antes de o UniFlow guardar a conversa: guarda agora
    if (email && ev.space?.name && isDm(ev.space)) await rememberDm(db, email, ev.space.name)
    return c.json(reply(ev.addon, ONLY_NOTICES))
  }
  return c.json({})
})

app.post('/test', auth, async c => {
  const db = c.get('db')
  const me = await db.prepare('SELECT email, system_role FROM users WHERE id = ?').get(c.get('user').id)
  if (me?.system_role !== 'super_admin') return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)
  const enabled = await chatEnabled(db)
  // teste é sob demanda: não usa o "não tem o app" guardado (pode ter acabado de adicionar)
  await db.prepare('DELETE FROM google_chat_dms WHERE email = ? AND space IS NULL').run(me.email.toLowerCase())
  const r = await sendChatToEmail(c.env, db, me.email,
    `**Teste do UniFlow** ✅\nSe você está lendo isto, os avisos de empréstimo pelo Google Chat estão funcionando${enabled ? '' : ' (ainda desligados no Admin — só este teste saiu)'}.`,
    { force: true })
  if (r.ok) return c.json({ ok: true })
  const error = r.reason === 'no_dm'
    ? `Não achei o app UniFlow no Google Chat de ${me.email}. Entre no Chat com essa conta e adicione o app (Novo chat → Encontrar apps → UniFlow); depois tente de novo.`
    : r.reason === 'off' ? 'A conta de serviço do Google não está configurada no servidor.'
    : `O Google Chat recusou: ${r.error}`
  return c.json({ error }, 502)
})

export default app
