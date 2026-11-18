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

export const isTabletPath = path => path === '/vistorias' || path.startsWith('/vistorias/')
