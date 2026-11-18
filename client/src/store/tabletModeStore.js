import { create } from 'zustand'

// "Modo tablet" da Vistoria de Laboratórios: some o menu lateral e a barra de
// cima (AppLayout) e pede a tela cheia do navegador. Fica lembrado NESTE
// aparelho (o tablet da vistoria abre sempre assim); vale só nas telas /vistorias.
const KEY = 'uniflow-vistoria-tablet'
const read = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }

export const useTabletMode = create(set => ({
  on: read(),
  enter: () => {
    try { localStorage.setItem(KEY, '1') } catch { /* sem armazenamento: vale até fechar */ }
    set({ on: true })
    requestFullscreen()
  },
  exit: () => {
    try { localStorage.removeItem(KEY) } catch { /* idem */ }
    set({ on: false })
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  },
}))

// Tela cheia do navegador só pode ser pedida a partir de um toque (regra do navegador).
export function requestFullscreen() {
  const el = document.documentElement
  if (document.fullscreenElement || !el.requestFullscreen) return
  el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
}

// Este aparelho é o tablet da vistoria (modo tablet ligado nele)?
export const isTabletDevice = read

// Tablet compartilhado: ao sair do UniFlow, sai também da conta Google do
// navegador — assim o próximo "Entrar com Google" pede e-mail e senha de novo
// (sem isso o Google entra direto com a última conta). Abre a saída do Google
// numa janelinha e fecha sozinha. Só funciona a partir de um toque (o navegador
// bloqueia janela aberta sem toque).
export function signOutGoogle() {
  const w = window.open('https://accounts.google.com/Logout', 'google-logout', 'width=480,height=560,left=200,top=100')
  if (!w) return false
  setTimeout(() => { try { w.close() } catch { /* já fechou */ } }, 4000)
  return true
}

export const isTabletPath =path => path === '/vistorias' || path.startsWith('/vistorias/')
