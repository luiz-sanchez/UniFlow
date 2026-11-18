-- De 04 a 18/11/2026 nenhum e-mail saiu: o token OAuth do Gmail parou de valer
-- na troca de conta da Cloudflare e o envio desistia sem marcar erro. São avisos
-- de prazo de empréstimo, "Compromissos de hoje" etc. que já perderam a data —
-- decisão do Luiz: NÃO disparar agora. Ficam no histórico como não enviados.
-- (O envio passou a usar a conta de serviço com gmail.send — lib/email.js.)
UPDATE email_outbox
SET status = 'failed',
    error = 'Expirado: não enviado (o envio do Gmail ficou sem autorização de 04 a 18/11/2026)'
WHERE status = 'pending';
