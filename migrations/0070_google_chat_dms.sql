-- Avisos de empréstimo pelo Google Chat (lib/googleChat.js): conversa 1:1 do
-- app UniFlow com cada pessoa. space NULL = a pessoa ainda não adicionou o app
-- (guardado pra não perguntar ao Google a cada empréstimo; reconsulta após 6 h).
-- Ligar/desligar: app_settings.gchat_loans_enabled ('true'), Admin → Notificações.
CREATE TABLE IF NOT EXISTS google_chat_dms (
  email TEXT PRIMARY KEY,
  space TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_google_chat_dms_space ON google_chat_dms(space);
