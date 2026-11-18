-- Vistoria de Laboratórios: lista oficial passada pelo Luiz (18/11/2026).
--   Laboratório 01 a 03 → CENTRO; 04 a 22 → SEDE, menos o 21; Laboratório 21 → G5.
-- Os que vieram dos Incidentes ("Laboratorio 9", "Laboratório 03"...) são
-- renomeados para o padrão "Laboratório NN" e vão para o prédio certo (mantêm
-- o id, então nada se perde). Os que faltam são criados. Outros nomes ficam como estão.

UPDATE inspection_labs
SET name = 'Laboratório ' || printf('%02d', CAST(trim(replace(replace(lower(name), 'laboratório', ''), 'laboratorio', '')) AS INTEGER)),
    building = CASE
      WHEN CAST(trim(replace(replace(lower(name), 'laboratório', ''), 'laboratorio', '')) AS INTEGER) <= 3 THEN 'centro'
      WHEN CAST(trim(replace(replace(lower(name), 'laboratório', ''), 'laboratorio', '')) AS INTEGER) = 21 THEN 'g5'
      ELSE 'sede' END,
    sort = CAST(trim(replace(replace(lower(name), 'laboratório', ''), 'laboratorio', '')) AS INTEGER),
    updated_at = datetime('now')
WHERE trim(replace(replace(lower(name), 'laboratório', ''), 'laboratorio', '')) GLOB '[0-9]*'
  AND trim(replace(replace(lower(name), 'laboratório', ''), 'laboratorio', '')) NOT GLOB '*[^0-9]*'
  AND CAST(trim(replace(replace(lower(name), 'laboratório', ''), 'laboratorio', '')) AS INTEGER) BETWEEN 1 AND 22;

WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 22)
INSERT INTO inspection_labs (id, building, name, sort)
SELECT lower(hex(randomblob(16))),
       CASE WHEN x <= 3 THEN 'centro' WHEN x = 21 THEN 'g5' ELSE 'sede' END,
       'Laboratório ' || printf('%02d', x),
       x
FROM n
WHERE NOT EXISTS (SELECT 1 FROM inspection_labs l WHERE l.name = 'Laboratório ' || printf('%02d', n.x));
