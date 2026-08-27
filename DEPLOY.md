# Deploy (Vercel & Cloudflare) — Guia rápido

Este documento mostra como publicar o projeto gratuitamente sem um domínio próprio, usando subdomínios gratuitos oferecidos pelos provedores.

Resumo das opções suportadas
- Vercel: fácil, integração com Git, subdomínio `*.vercel.app` gratuito.
- Cloudflare Pages + Workers: bom para latência global; use Upstash para Redis gratuito.

Pré-requisitos locais
- Conta no GitHub (ou GitLab). Faça push deste repositório.
- Para rate-limiter robusto entre instâncias, crie uma conta em Upstash (free) e copie `REDIS_URL`.

Variáveis de ambiente recomendadas
- `APP_URL` — URL pública (ex.: https://meu-app.vercel.app)
- `EMAIL_CONFIRM_SECRET` — segredo HMAC para tokens de confirmação
- `REDIS_URL` — (opcional) Upstash Redis URL
- `SENDGRID_API_KEY` / `POSTMARK_TOKEN` / `MAILGUN_API_KEY` + `MAILGUN_DOMAIN` — (opcionais) provedores de e-mail
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SMTP_FROM` — (opcionais) SMTP fallback
- `SUPABASE_SERVICE_ROLE_KEY` — (server only) para operações administrativas
- `ALLOW_AUTO_CONFIRM_SIGNUP` — somente se realmente quiser permitir auto-confirm (não recomendado em prod)

Deploy no Vercel (passos)
1. Crie conta em https://vercel.com e conecte seu repositório Git.
2. No painel do projeto, configure as Environment Variables listadas acima (Settings → Environment Variables). Use `Production` para chaves reais e `Preview/Development` para chaves de teste.
3. Se você quer usar Redis (Upstash): crie uma instância Upstash (https://upstash.com), copie `REDIS_URL` e adicione como secret em Vercel.
4. Se usar Mailgun/SendGrid/Postmark: crie a conta e adicione a API key como variável de ambiente.
5. Deploy automático ocorrerá ao pushar `main`. Se precisar de SSR em Node, ajuste o `vercel.json` ou adicione uma função `api` compatível — por enquanto este repo está configurado para build estática (Vite). Se seu app exige SSR em Node, me peça para adaptar `vercel.json`.

Notes sobre SSR e TanStack Start
- Se sua aplicação requer server-side runtime (TanStack Start server), Vercel precisa de uma função server/Node. Isso exige configurar `vercel.json` para usar `@vercel/node` para endpoints server, ou adaptar o projeto para Vercel Serverless Functions. Posso ajudar a adaptar se necessário.

Deploy no Cloudflare Pages + Workers
1. Crie conta Cloudflare e um projeto Pages (`Pages -> Create a project`) apontando para seu repositório.
2. Em `Settings` do Pages, adicione Environment Variables (APP_URL, EMAIL_CONFIRM_SECRET, etc.).
3. Para Redis use Upstash e configure `REDIS_URL` nas environment variables do Pages/Workers.
4. Configure `wrangler` se quiser publicar Workers diretamente (há já um `wrangler.jsonc` no repo). Use `wrangler pages dev` para testar localmente.

Testando envio de e-mail após deploy
- Local (dev) — use Ethereal com o script `node scripts/send-test-email.mjs destinatario@exemplo.com` para ver preview.
- Em produção — configure `MAILGUN`/`SENDGRID`/`POSTMARK` ou SMTP e teste via signup flow; confirme recebimento.

Rollback e chaves comprometidas
- Se alguma chave já foi committada, rotacione as chaves no provedor e remova do histórico Git (`git filter-repo` ou BFG). Posso fornecer comandos se quiser.

Ajuda adicional
- Quer que eu adapte o projeto para SSR no Vercel (Serverless Functions) automaticamente? Responda e eu faço um `vercel.json` + rota API e pequenos ajustes no build.
