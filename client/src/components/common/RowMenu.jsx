import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import LineIcon from './LineIcon'
import s from './RowMenu.module.css'

// Menu "⋯" de uma linha de tabela (mesmo padrão da aba Usuários do Admin):
// abre com clique ou Enter, fecha com Esc, clique fora, rolagem ou ao escolher.
// items: [{ label, hint?, icon?, onClick, danger?, disabled? }] — itens falsos são ignorados.
// O menu é desenhado no <body> com posição fixa: dentro de tabelas com rolagem própria
// (cabeçalho fixo) ele era cortado. Abre embaixo do botão; se não couber, abre para cima.
export default function RowMenu({ name, items }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const menuRef = useRef(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const btn = ref.current?.querySelector('button')
    const menu = menuRef.current
    if (!btn || !menu) return
    const r = btn.getBoundingClientRect()
    const mh = menu.offsetHeight, mw = menu.offsetWidth
    const vh = window.innerHeight, vw = window.innerWidth
    const up = r.bottom + 4 + mh > vh - 8 && r.top - 4 - mh >= 8
    const top = up ? r.top - 4 - mh : Math.min(r.bottom + 4, Math.max(8, vh - 8 - mh))
    const left = Math.min(Math.max(8, r.right - mw), vw - 8 - mw)
    setPos({ top, left, up })
  }, [open])

  useEffect(() => {
    if (!open) return
    const inside = t => ref.current?.contains(t) || menuRef.current?.contains(t)
    const onDoc = e => { if (!inside(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus() } }
    const onScroll = e => { if (!menuRef.current?.contains(e.target)) setOpen(false) }
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  // foco no 1º item só depois de posicionado (senão a página rola até o canto)
  useEffect(() => {
    if (open && pos) menuRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true })
  }, [open, pos])

  const list = items.filter(Boolean)
  if (!list.length) return null
  return (
    <div className={s.wrap} ref={ref}>
      <button type="button" className={s.btn} onClick={() => setOpen(v => !v)}
        aria-haspopup="menu" aria-expanded={open} aria-label={`Mais ações de ${name}`} title="Mais ações">
        <LineIcon name="more" size={18} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className={`${s.menu} ${pos?.up ? s.up : ''}`} role="menu" aria-label={`Ações de ${name}`}
          style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}>
          {list.map(it => (
            <button key={it.label} type="button" role="menuitem" disabled={it.disabled}
              className={it.danger ? s.danger : undefined}
              onClick={() => { setOpen(false); it.onClick() }}>
              {it.icon && <LineIcon name={it.icon} />}
              <span>{it.label}{it.hint && <small>{it.hint}</small>}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
