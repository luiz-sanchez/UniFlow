import { isTabletDevice } from '../store/tabletModeStore'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const NONCE_KEY = 'uniflow-google-nonce'

// Endereço de "Entrar com Google" (fluxo implícito: o Google devolve o id_token
// em /auth/google/callback#id_token=...). O nonce fica guardado nesta aba para
// conferir na volta quando a entrada acontece na própria tela (sem janelinha).
export function googleAuthUrl() {
  const nonce = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
  try { sessionStorage.setItem(NONCE_KEY, nonce) } catch { /* sem armazenamento */ }
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: `${window.location.origin}/auth/google/callback`,
    response_type: 'id_token',
    scope: 'openid email profile',
    prompt: 'select_account',
    nonce,
  })
  // Tablet da vistoria: max_age=0 pede ao Google que exija a senha de novo.
  if (isTabletDevice()) params.set('max_age', '0')
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export function expectedNonce() {
  try { return sessionStorage.getItem(NONCE_KEY) } catch { return null }
}

// "Sair": sai da conta Google do navegador e o próprio Google já abre a tela de
// entrada do UniFlow (continue = endereço acima — o Google só aceita continuar
// para endereços dele, e este é). Assim a próxima pessoa precisa digitar conta e
// senha, sem passar por aviso de redirecionamento.
export function googleLogoutUrl() {
  return `https://accounts.google.com/Logout?continue=${encodeURIComponent(googleAuthUrl())}`
}
