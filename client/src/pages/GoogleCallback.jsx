import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { isTabletDevice } from '../store/tabletModeStore'
import { expectedNonce } from '../utils/googleAuth'

// Volta do Google. Dois jeitos de chegar aqui:
//  - janelinha aberta pela tela de entrada → avisa a tela de trás e fecha;
//  - a própria tela (depois de "Sair", o Google segue direto para a entrada) →
//    entra aqui mesmo e vai para o Início (no tablet, para a Vistoria).
export default function GoogleCallback() {
  const navigate = useNavigate()
  const [msg, setMsg] = useState('Entrando…')

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1))
    const idToken = params.get('id_token')
    const error = params.get('error')
    if (window.opener) {
      window.opener.postMessage({ type: 'google-oauth', idToken, error }, window.location.origin)
      window.close()
      return
    }
    if (error || !idToken) { navigate('/login', { replace: true }); return }
    // confere que foi esta aba que pediu a entrada (nonce guardado ao pedir)
    let nonce = null
    try { nonce = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).nonce } catch { /* token estranho */ }
    if (!nonce || nonce !== expectedNonce()) { navigate('/login', { replace: true }); return }
    useAuthStore.getState().loginWithGoogle(idToken)
      .then(() => navigate(isTabletDevice() ? '/vistorias' : '/', { replace: true }))
      .catch(err => setMsg(err?.response?.data?.error || 'Não deu para entrar com o Google. Volte e tente de novo.'))
  }, [])

  return (
    <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: 'var(--muted, #8fa7bb)', background: 'var(--bg, #061826)', padding: 24, textAlign: 'center' }}>
      {msg}
      {msg !== 'Entrando…' && <a href="/login" style={{ color: 'var(--brand, #3F9BE0)' }}>Voltar para a entrada</a>}
    </div>
  )
}
