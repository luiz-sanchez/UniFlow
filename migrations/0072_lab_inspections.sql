-- Fluxos → Vistoria de Laboratórios: checklist feito no tablet pelos técnicos
-- (Conforme / Não conforme / Não se aplica), com problema, foto e "precisa de
-- manutenção" — que vira um Incidente Laboratórios ao finalizar.
-- Módulo "incidents" (mesmo de Incidentes). Ver server/src/routes/labInspections.js.

CREATE TABLE IF NOT EXISTS inspection_labs (
  id TEXT PRIMARY KEY,
  building TEXT NOT NULL,              -- sede | centro | g5
  name TEXT NOT NULL,                  -- "Laboratório 3"
  location TEXT,                       -- "2º andar, sala 204"
  computers INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inspection_labs_building ON inspection_labs(building, active, sort);

-- Itens do checklist (lista única, editável). A vistoria guarda o texto do item,
-- então mudar a lista não altera o histórico.
CREATE TABLE IF NOT EXISTS inspection_items (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  hint TEXT,                           -- o que conferir, em uma frase
  icon TEXT NOT NULL DEFAULT 'check',  -- nome do LineIcon
  incident_category TEXT NOT NULL DEFAULT 'outro', -- categoria do incidente gerado
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inspection_items_sort ON inspection_items(active, sort);

CREATE TABLE IF NOT EXISTS lab_inspections (
  id TEXT PRIMARY KEY,
  lab_id TEXT NOT NULL,
  building TEXT NOT NULL,
  lab_name TEXT NOT NULL,              -- cópia do nome na hora da vistoria
  status TEXT NOT NULL DEFAULT 'rascunho', -- rascunho | finalizada
  notes TEXT,                          -- observações gerais
  ok_count INTEGER NOT NULL DEFAULT 0,
  nok_count INTEGER NOT NULL DEFAULT 0,
  na_count INTEGER NOT NULL DEFAULT 0,
  incident_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,            -- técnico responsável
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lab_inspections_lab ON lab_inspections(lab_id, status, finished_at);
CREATE INDEX IF NOT EXISTS idx_lab_inspections_status ON lab_inspections(status, finished_at);
CREATE INDEX IF NOT EXISTS idx_lab_inspections_author ON lab_inspections(created_by, status);

CREATE TABLE IF NOT EXISTS lab_inspection_answers (
  inspection_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_label TEXT NOT NULL,
  item_icon TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,                -- conforme | nao_conforme | na
  problem TEXT,                        -- descrição do problema
  notes TEXT,                          -- observações do item
  equipment TEXT,                      -- equipamentos que precisam de manutenção
  needs_maintenance INTEGER NOT NULL DEFAULT 0,
  incident_id TEXT,                    -- incidente criado ao finalizar
  photo_thumb TEXT,                    -- foto reduzida no navegador (data URL)
  photo_data TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (inspection_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_lab_inspection_answers_status ON lab_inspection_answers(status, item_id);

INSERT OR IGNORE INTO inspection_items (id, label, hint, icon, incident_category, sort) VALUES
  ('item-computadores', 'Computadores', 'Ligam, entram no sistema e funcionam normalmente', 'monitor', 'maquina', 1),
  ('item-monitores', 'Monitores', 'Todos acendem, sem manchas ou riscos', 'monitor', 'maquina', 2),
  ('item-perifericos', 'Teclados e mouses', 'Todas as teclas e os cliques respondem', 'keyboard', 'maquina', 3),
  ('item-cabos', 'Cabos e conexões', 'Organizados, presos e sem fios soltos', 'link', 'organizacao', 4),
  ('item-internet', 'Internet', 'Navegação funcionando nas máquinas', 'wifi', 'rede', 5),
  ('item-projecao', 'Projetor ou TV', 'Liga, mostra a imagem e o controle funciona', 'tv', 'projecao', 6),
  ('item-ar', 'Ar-condicionado', 'Liga e gela; controle presente', 'fan', 'outro', 7),
  ('item-iluminacao', 'Iluminação', 'Todas as lâmpadas acesas', 'lightbulb', 'outro', 8),
  ('item-mobilia', 'Cadeiras e mesas', 'Sem quebras, rasgos ou peças soltas', 'chair', 'sinistro', 9),
  ('item-limpeza', 'Limpeza e organização', 'Sala limpa e em ordem', 'broom', 'organizacao', 10);

-- Laboratórios iniciais: os que já aparecem nos Incidentes (o Luiz confere a
-- localização e a quantidade de computadores pela tela).
INSERT INTO inspection_labs (id, building, name, sort)
  SELECT lower(hex(randomblob(16))), src.building, src.lab, 0
  FROM (SELECT building, MIN(trim(lab)) AS lab FROM lab_incidents WHERE trim(lab) != '' GROUP BY building, lower(trim(lab))) AS src
  WHERE NOT EXISTS (SELECT 1 FROM inspection_labs l WHERE l.building = src.building AND lower(l.name) = lower(src.lab));
