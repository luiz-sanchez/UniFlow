// E2E: Cofre de Senhas e VLANs liberados pelo CARGO (Admin → Cargos), além da
// lista pessoal antiga do Cofre. Auditor continua sem ver senha.
//   cd server && node test-e2e/node-server.mjs
//   node test-e2e/secret-roles-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const tok = id => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tok('u-test'), rede: await tok('u-sr-rede'), cofre: await tok('u-sr-cofre'), lista: await tok('u-sr-lista'), aud: await tok('u-aud') }
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who]}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
const sql = (s, args = []) => fetch(BASE + '/__mock/sql', { method: 'POST', body: JSON.stringify({ sql: s, args }) }).then(r => r.json())
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }

// ── Os dois módulos aparecem na tela de Cargos ───────────────────────────
const roles = (await call('admin', 'GET', '/api/admin/roles')).j
const keys = (roles?.modules || []).map(m => m.key)
expect('Cargos: módulo "Cofre de Senhas" configurável', keys.includes('vault'), true)
expect('Cargos: módulo "VLANs" configurável', keys.includes('vlans'), true)

// Cargo "Redes": VLANs ver, Cofre nada. Cargo "Cofre leitura": Cofre ver.
const rede = (await call('admin', 'POST', '/api/admin/roles', { name: 'Redes (teste)', permissions: { vlans: 'view' } })).j
const cofre = (await call('admin', 'POST', '/api/admin/roles', { name: 'Cofre leitura (teste)', permissions: { vault: 'view' } })).j
for (const [id, role] of [['u-sr-rede', rede.id], ['u-sr-cofre', cofre.id], ['u-sr-lista', 'role-colaborador']]) {
  await sql("INSERT OR IGNORE INTO users (id, name, email, password, system_role, role_id) VALUES (?, ?, ?, 'x', 'user', ?)", [id, id, `${id}@colegioser.com`, role])
}

// ── VLANs pelo cargo ─────────────────────────────────────────────────────
let me = (await call('rede', 'GET', '/api/auth/me')).j
expect('/auth/me: vlans = view, vault = none', `${me?.permissions?.vlans}|${me?.permissions?.vault}`, 'view|none')
expect('cargo com VLANs abre as VLANs', (await call('rede', 'GET', '/api/vlans?site=matriz')).s, 200)
expect('...mas não o Cofre', (await call('rede', 'GET', '/api/vault')).s, 403)

// ── Cofre só "ver" ───────────────────────────────────────────────────────
const entry = (await call('admin', 'POST', '/api/vault', { title: 'Painel teste', password: 'segredo-1' })).j
expect('cargo com Cofre "ver" lista', (await call('cofre', 'GET', '/api/vault')).s, 200)
expect('...e mostra a senha', (await call('cofre', 'GET', `/api/vault/${entry.id}/reveal`)).j?.password, 'segredo-1')
expect('...mas não cadastra', (await call('cofre', 'POST', '/api/vault', { title: 'x', password: 'y' })).s, 403)
expect('...nem exclui', (await call('cofre', 'DELETE', `/api/vault/${entry.id}`)).s, 403)
expect('...nem gerencia quem acessa', (await call('cofre', 'GET', '/api/vault/access/list')).s, 403)
expect('...e não vê as VLANs', (await call('cofre', 'GET', '/api/vlans?site=matriz')).s, 403)

// Cargo passa para "editar"
await call('admin', 'PUT', `/api/admin/roles/${cofre.id}`, { name: 'Cofre leitura (teste)', permissions: { vault: 'edit' } })
expect('cargo com Cofre "editar" cadastra', (await call('cofre', 'POST', '/api/vault', { title: 'Novo', password: 'z' })).s, 200)

// ── Lista pessoal antiga continua valendo (editar nos dois) ─────────────
expect('Colaborador sem nada não abre o Cofre', (await call('lista', 'GET', '/api/vault')).s, 403)
await call('admin', 'POST', '/api/vault/access', { user_id: 'u-sr-lista' })
me = (await call('lista', 'GET', '/api/auth/me')).j
expect('lista pessoal → vault e vlans = edit', `${me?.permissions?.vault}|${me?.permissions?.vlans}|${me?.has_vault_access}`, 'edit|edit|true')
expect('...abre as VLANs', (await call('lista', 'GET', '/api/vlans?site=matriz')).s, 200)

// ── Auditor continua sem senha; teto do departamento vale ───────────────
me = (await call('aud', 'GET', '/api/auth/me')).j
expect('Auditor: Cofre e VLANs = none', `${me?.permissions?.vault}|${me?.permissions?.vlans}`, 'none|none')
expect('Auditor não abre o Cofre', (await call('aud', 'GET', '/api/vault')).s, 403)

// limpeza (os cargos de teste saem; quem estava neles volta a Colaborador)
await call('admin', 'DELETE', `/api/vault/access/u-sr-lista`)
await call('admin', 'DELETE', `/api/admin/roles/${rede.id}`)
await call('admin', 'DELETE', `/api/admin/roles/${cofre.id}`)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)
