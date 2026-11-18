import { useState, useEffect, useRef } from 'react'
import { startLive, stopLive } from '../../services/live'
import api from '../../services/api'
import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { pageTitle } from './GoTo'
import ConfirmDialogHost from '../common/ConfirmDialogHost'
import { useTabletMode, isTabletPath, requestFullscreen } from '../../store/tabletModeStore'
import styles from './AppLayout.module.css'

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  // Modo tablet da Vistoria: sem menu nem barra de cima, tela cheia e tela acesa.
  const tablet = useTabletMode(s => s.on) && isTabletPath(location.pathname)

  useEffect(() => {
    if (!tablet) return
    // o navegador só deixa entrar em tela cheia num toque: o 1º toque na tela
    // (ao reabrir a aba, ou depois de sair sem querer) volta para a tela cheia
    const onTouch = () => requestFullscreen()
    document.addEventListener('pointerdown', onTouch)
    // tela não apaga no meio da vistoria (onde o navegador permitir)
    let lock = null
    const keepAwake = () => {
      if (document.visibilityState !== 'visible' || !navigator.wakeLock) return
      navigator.wakeLock.request('screen').then(l => { lock = l }).catch(() => {})
    }
    keepAwake()
    document.addEventListener('visibilitychange', keepAwake)
    return () => {
      document.removeEventListener('pointerdown', onTouch)
      document.removeEventListener('visibilitychange', keepAwake)
      lock?.release().catch(() => {})
    }
  }, [tablet])

  // Tempo real: abre a conexão enquanto a pessoa está logada e fecha ao sair
  // (este layout só existe dentro da área logada).
  useEffect(() => {
    startLive()
    return stopLive
  }, [])

  // Log de auditoria: cada tela aberta (Admin → Logs). Só o caminho, sem a
  // ?busca; a mesma tela de novo em menos de 30 s não repete o registro.
  const lastView = useRef({ path: null, at: 0 })
  useEffect(() => {
    const path = location.pathname
    document.title = pageTitle(path)
    const now = Date.now()
    if (lastView.current.path === path && now - lastView.current.at < 30000) return
    lastView.current = { path, at: now }
    api.post('/audit/view', { path }).catch(() => {})
  }, [location.pathname])

  return (
    <div className={`${styles.layout} ${tablet ? styles.tablet : ''}`}>
      {/* Primeiro item do Tab: pula o menu (~30 paradas) e vai direto ao conteúdo. */}
      <a
        href="#conteudo"
        className="skip-link"
        onClick={e => { e.preventDefault(); document.getElementById('conteudo')?.focus() }}
      >
        Pular para o conteúdo
      </a>
      {!tablet && <Sidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />}

      {/* Backdrop for mobile sidebar */}
      {sidebarOpen && (
        <div className={styles.backdrop} onClick={() => setSidebarOpen(false)} />
      )}

      <div className={styles.main}>
        {!tablet && <Topbar onMenuClick={() => setSidebarOpen(o => !o)} />}
        <main id="conteudo" className={styles.content} tabIndex={-1}>
          {/* key={pathname} remonta esse div a cada navegação, o que
              reinicia a animação de entrada — dá vida a toda troca de
              página sem precisar mexer em cada page.jsx individualmente. */}
          <div key={location.pathname} className={styles.pageTransition}>
            {/* tela ainda baixando: fica o fundo, sem piscar o menu */}
            <Suspense fallback={null}><Outlet /></Suspense>
          </div>
        </main>
      </div>

      <ConfirmDialogHost />
    </div>
  )
}
