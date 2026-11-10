-- Estoque de insumos: a Entrada tinha só uma observação livre ("ficou vago",
-- nov/2026). Agora cada entrada guarda de quem veio, a nota fiscal e quanto
-- custou cada unidade (o total = unidades × valor, calculado na tela).
-- Só a ENTRADA usa esses campos; os outros movimentos continuam como estão.
ALTER TABLE printer_supply_movements ADD COLUMN supplier TEXT;   -- fornecedor
ALTER TABLE printer_supply_movements ADD COLUMN invoice TEXT;    -- nº da nota fiscal / pedido
ALTER TABLE printer_supply_movements ADD COLUMN unit_cost REAL;  -- R$ por unidade

-- lista de fornecedores já usados (sugestão no formulário)
CREATE INDEX IF NOT EXISTS idx_supply_mov_supplier ON printer_supply_movements(supplier) WHERE supplier IS NOT NULL;
