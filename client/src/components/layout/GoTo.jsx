import { useState, useEffect, useMemo, useRef, useId } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import { canView } from '../../utils/permissions'
import s from './GoTo.module.css'

// "Ir para…" da barra de cima: digita o nome de uma tela (ou de um quadro) e
// Enter leva direto. Ctrl+K (ou "/") foca o campo. Antes havia ali uma busca
// que não buscava nada.
const PAGES = [
  ['Início', '/', null, 'telão valores parisfe'],
  ['Agenda', '/agenda', 'agenda', 'eventos calendário reservas'],
  ['Métricas', '/metricas', 'metrics', 'tarefas concluídas'],
  ['Desempenho', '/time/desempenho', 'team', 'reconhecimento time'],
  ['Organograma', '/time/organograma', 'team', 'time cargos'],
  ['Jornada', '/time/jornada', 'team', 'trajetória time'],
  ['Escala', '/time/escala', 'team', 'plantão sábado domingo time'],
  ['Backlog de chamados', '/backlog', 'tickets', 'glpi abertos'],
  ['Total de chamados', '/chamados-total', 'tickets', 'glpi histórico'],
  ['Base de Conhecimento', '/base-conhecimento', 'kb', 'artigos textos prontos políticas'],
  ['Padronização de máquinas', '/base-conhecimento', 'kb', 'computador configuração'],
  ['Aprovações', '/aprovacoes', 'approvals', 'pedir aprovação fluxos'],
  ['Solicitações de compra', '/solicitacoes-compra', 'purchases', 'compras fluxos'],
  ['Incidentes nos laboratórios', '/incidentes-laboratorios', 'incidents', 'defeito fluxos'],
  ['Impressoras', '/impressoras', 'printers', 'ip driver'],
  ['Estoque de insumos', '/estoque-insumos', 'printers', 'toner cilindro tinta impressoras'],
  ['Empréstimos', '/emprestimo-equipamentos', 'loans', 'equipamentos chromebook projetor'],
  ['Pedidos de Chromebook', '/pedidos-chromebook', 'loans', 'professores empréstimos'],
  ['Empresas e filiais', '/empresas', 'companies', 'cnpj endereço'],
  ['Parceiros', '/parceiros', 'companies', 'fornecedores contato'],
  ['Links de internet', '/link-internet', 'companies', 'operadora velocidade'],
  ['Inventário: Brain', '/inventario/brain', 'inventory', 'kits patrimônio'],
  ['Cases de Sucesso', '/gestao/cases-de-sucesso', 'gestao', 'diretoria apresentação'],
  ['Documentos de gestão', '/gestao/documentos', 'gestao', 'contratos relatórios'],
  ['Desenvolvimentos', '/gestao/desenvolvimentos', 'gestao', 'sistemas'],
  ['Cofre de Senhas', '/gestao/cofre-senhas', 'vault', 'senhas'],
  ['VLANs', '/gestao/vlans', 'vault', 'wi-fi rede senhas'],
  ['Administração', '/admin', 'admin', 'usuários cargos departamentos logs'],
]
const norm = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function GoTo() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const id = useId()
  const inputRef = useRef(null)
  const wrapRef = useRef(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [boards, setBoards] = useState(null)

  const allowed = ([, , mod]) => {
    if (!mod) return true
    if (mod === 'admin') return user?.system_role === 'super_admin'
    if (mod === 'vault') return user?.system_role === 'super_admin' || !!user?.has_vault_access
    return canView(user, mod)
  }
  // quadros só são buscados quando alguém abre o campo (nada de chamada à toa)
  useEffect(() => {
    if (open && boards === null && canView(user, 'boards')) api.get('/boards').then(r => setBoards(r.data || [])).catch(() => setBoards([]))
  }, [open])

  const results = useMemo(() => {
    const t = norm(q.trim())
    if (!t) return []
    const pages = PAGES.filter(allowed).filter(p => norm(`${p[0]} ${p[3]}`).includes(t)).map(p => ({ label: p[0], to: p[1], kind: 'Tela' }))
    const bs = (boards || []).filter(b => norm(b.name).includes(t)).map(b => ({ label: b.name, to: `/boards/${b.id}`, kind: 'Quadro' }))
    // o que começa com o termo vem antes
    const score = r => (norm(r.label).startsWith(t) ? 0 : 1)
    return [...pages, ...bs].sort((a, b) => score(a) - score(b)).slice(0, 8)
  }, [q, boards, user])

  useEffect(() => { setActive(0) }, [q])
  useEffect(() => {
    const onKey = e => {
      const typing = /input|textarea|select/i.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault(); inputRef.current?.focus(); setOpen(true)
      }
    }
    const onDoc = e => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDoc)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDoc) }
  }, [])

  const go = r => { if (!r) return; navigate(r.to); setQ(''); setOpen(false); inputRef.current?.blur() }
  const onKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]) }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
  }

  const showList = open && q.trim()
  return (
    <div className={s.wrap} ref={wrapRef}>
      <svg className={s.icon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input
        ref={inputRef}
        className={s.input}
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Ir para uma tela ou quadro…"
        aria-label="Ir para uma tela ou quadro"
        role="combobox"
        aria-expanded={!!showList}
        aria-controls={`${id}-list`}
        aria-activedescendant={showList && results[active] ? `${id}-${active}` : undefined}
        autoComplete="off"
      />
      <kbd className={s.kbd} aria-hidden="true">Ctrl K</kbd>
      {showList && (
        <ul className={s.list} id={`${id}-list`} role="listbox">
          {results.length === 0 && <li className={s.empty}>Nenhuma tela ou quadro com "{q.trim()}".</li>}
          {results.map((r, i) => (
            <li key={r.to + r.label} id={`${id}-${i}`} role="option" aria-selected={i === active}
              className={`${s.item} ${i === active ? s.itemOn : ''}`}
              onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); go(r) }}>
              <span>{r.label}</span><span className={s.kind}>{r.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
