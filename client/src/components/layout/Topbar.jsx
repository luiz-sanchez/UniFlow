import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useNotificationStore } from '../../store/notificationStore'
import { useAuthStore } from '../../store/authStore'
import { useTheme } from '../../hooks/useTheme'
import { useVisiblePolling } from '../../hooks/useVisiblePolling'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'
import { useDepartmentStore, getDeptView, setDeptView } from '../../store/departmentStore'
import { parseDbTimestamp } from '../../utils/formatDuration'
import GoTo from './GoTo'
import s from './Topbar.module.css'

function IconMenu() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  )
}

function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  )
}

function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

function IconBell() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  )
}

// Recursos da API (1º pedaço do caminho) cujas rotas criam notificação no servidor
const NOTIFYING_RESOURCES = ['boards', 'approvals', 'purchase-requests', 'teacher']

export default function Topbar({ onMenuClick }) {
  const [showNotifs, setShowNotifs] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const { notifications, unread, fetch, markRead, markAllRead } = useNotificationStore()
  const { user, logout } = useAuthStore()
  const { theme, toggle } = useTheme()
  const ref = useRef()
  const accRef = useRef()
  const location = useLocation()

  useEffect(() => { fetch() }, [location.pathname])
  // Antes era setInterval fixo de 30s independente da aba estar visível —
  // rodava o dia inteiro em toda sessão aberta, mesmo em segundo plano.
  // Contra o limite de requests/dia do plano Free, isso pesava bastante
  // (essa é a única coisa que roda em TODA página, sempre). Agora só faz
  // polling com a aba visível, e o intervalo dobrou (30s → 60s).
  useVisiblePolling(fetch, 60_000)
  // Tempo real: só os recursos cujas escritas criam notificação (cartão atribuído,
  // aprovação pedida, compra...) — busca na hora em vez de esperar os 60s. Antes
  // reagia a QUALQUER alteração: cada escrita de alguém fazia todas as abas
  // abertas buscarem o sininho (out/2026, quase estourou a cota de logs do dia).
  // Os avisos criados pelos crons e pelo Cofre chegam no ciclo de 60s.
  useLiveRefresh(NOTIFYING_RESOURCES, fetch)

  useEffect(() => {
    const handler = e => {
      if (ref.current && !ref.current.contains(e.target)) setShowNotifs(false)
      if (accRef.current && !accRef.current.contains(e.target)) setShowAccount(false)
    }
    const onKey = e => { if (e.key === 'Escape') { setShowNotifs(false); setShowAccount(false) } }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', onKey) }
  }, [])

  // "Ver como departamento": só pra quem enxerga todos os departamentos. Estreita
  // as listas do sistema inteiro pro departamento escolhido (o servidor decide);
  // recarrega a página pra todas as telas buscarem de novo já filtradas.
  const { departments, loaded: deptsLoaded, fetch: fetchDepartments } = useDepartmentStore()
  const seesAllDepartments = user?.scope === 'all'
  useEffect(() => { if (seesAllDepartments && !deptsLoaded) fetchDepartments() }, [seesAllDepartments, deptsLoaded])
  const changeDeptView = e => { setDeptView(e.target.value); window.location.reload() }

  const handleThemeToggle = () => {
    document.documentElement.classList.add('theme-transition')
    toggle()
    setTimeout(() => document.documentElement.classList.remove('theme-transition'), 350)
  }

  return (
    <header className={s.topbar}>
      {/* Hamburger – mobile only */}
      <button className={`btn btn-icon ${s.menuBtn}`} onClick={onMenuClick} aria-label="Abrir menu">
        <IconMenu />
      </button>

      <div className={s.goTo}><GoTo /></div>

      <div className={s.actions}>
        {seesAllDepartments && (
          <select
            className={s.deptView}
            value={getDeptView()}
            onChange={changeDeptView}
            aria-label="Ver como departamento"
            title="Ver o sistema como um departamento (só filtra a tela — não muda o seu acesso)"
          >
            <option value="all">Todos os departamentos</option>
            <option value="geral">Só o que é Geral</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {/* Notifications */}
        <div ref={ref} className={s.notifWrap}>
          <button
            className={`btn btn-icon ${s.notifBtn}`}
            onClick={() => { setShowNotifs(!showNotifs); setShowAccount(false) }}
            aria-label={unread > 0 ? `Notificações (${unread} não lidas)` : 'Notificações'}
            aria-expanded={showNotifs}
          >
            <IconBell />
            {unread > 0 && <span className={s.badge} aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
          </button>

          {showNotifs && (
            <div className={s.notifPanel}>
              <div className={s.notifHeader}>
                <span>Notificações</span>
                {unread > 0 && (
                  <button className={s.linkBtn} onClick={markAllRead}>
                    Marcar todas como lidas
                  </button>
                )}
              </div>
              <div className={s.notifList}>
                {notifications.length === 0 && (
                  <div className={s.empty}>
                    <span className={s.emptyIcon}><IconBell /></span>
                    Nada novo por aqui. Avisos de cartões, aprovações e compras aparecem neste lugar.
                  </div>
                )}
                {notifications.map(n => (
                  <button
                    type="button"
                    key={n.id}
                    className={`${s.notifItem} ${!n.read ? s.unread : ''}`}
                    onClick={() => { if (!n.read) markRead(n.id) }}
                  >
                    {!n.read && <span className={s.unreadDot} />}
                    <div className={s.notifBody}>
                      <div className={s.notifTitle}>{n.title}</div>
                      {n.content && <div className={s.notifContent}>{n.content}</div>}
                      <div className={s.notifTime}>
                        {parseDbTimestamp(n.created_at)?.toLocaleString('pt-BR', {
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Conta: nome, tema e sair (antes ficavam soltos no rodapé do menu) */}
        <div ref={accRef} className={s.accWrap}>
          <button
            type="button"
            className={s.userAvatar}
            onClick={() => { setShowAccount(!showAccount); setShowNotifs(false) }}
            aria-label={`Sua conta: ${user?.name || ''}`}
            aria-expanded={showAccount}
            aria-haspopup="menu"
          >
            {user?.avatar && !avatarFailed
              ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} className={s.avatarImg} />
              : <span>{user?.name?.charAt(0).toUpperCase()}</span>
            }
          </button>
          {showAccount && (
            <div className={s.accPanel} role="menu">
              <div className={s.accHead}>
                <div className={s.accName}>{user?.name}</div>
                <div className={s.accMail}>{user?.email}</div>
              </div>
              <button type="button" role="menuitem" className={s.accItem} onClick={handleThemeToggle}>
                {theme === 'dark' ? <IconSun /> : <IconMoon />}
                {theme === 'dark' ? 'Usar o tema claro' : 'Usar o tema escuro'}
              </button>
              <button type="button" role="menuitem" className={`${s.accItem} ${s.accOut}`} onClick={logout}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>
                Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
