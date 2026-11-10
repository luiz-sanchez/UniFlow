import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

// Estado que mora no endereço (?situacao=…&tecnico=…): F5, abrir em outra aba
// e mandar o link mantêm o filtro, e o "Voltar" do navegador desfaz a última
// escolha. O valor padrão não aparece no endereço.
//
// Várias trocas no mesmo clique (ex.: "Limpar filtros" zera 5 filtros) viram
// UMA navegação só — sem isso o react-router 6 aplicaria só a última e o
// histórico ganharia uma entrada por filtro. Até a navegação acontecer, a
// tela já mostra o valor novo (senão um <select>/<input> controlado voltaria
// ao valor antigo por um instante).
let pending = null

export function useUrlState(key, def = '', { replace = false } = {}) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const fromUrl = params.get(key) ?? def
  const [optimistic, setOptimistic] = useState(undefined)
  useEffect(() => { setOptimistic(undefined) }, [fromUrl])
  const value = optimistic ?? fromUrl

  const set = useCallback(v => {
    if (!pending) {
      pending = { params: new URLSearchParams(window.location.search), replace: true }
      queueMicrotask(() => {
        const { params: next, replace: rep } = pending
        pending = null
        const qs = next.toString()
        if (qs === window.location.search.replace(/^\?/, '')) return
        navigate({ search: qs ? `?${qs}` : '' }, { replace: rep })
      })
    }
    const cur = pending.params.get(key) ?? def
    const val = String((typeof v === 'function' ? v(cur) : v) ?? '')
    if (val === def) pending.params.delete(key)
    else pending.params.set(key, val)
    if (!replace) pending.replace = false
    setOptimistic(val)
  }, [key, def, replace, navigate])

  return [value, set]
}
