# Solidária

Campanha de doação solidária para apoiar financeiramente uma atleta. Monorepo com frontend (Next.js), backend (Fastify) e um pacote de tipos/schemas compartilhados.

> Projeto em construção por etapas. Este README acompanha o progresso — as seções sobre banco de dados, integração com Mercado Pago, webhook, testes e deploy serão preenchidas nas etapas em que cada parte for implementada.

## Stack

- **Frontend**: Next.js `16.3.4` + React `19.2.8` + TypeScript + Tailwind CSS `4` — landing page + formulário de doação prontos (Etapa 7)
- **Backend**: Node.js + Fastify `5.12.1` + TypeScript — `GET /health`, `GET /api/campaign`, `POST /api/payments/create` prontos (Etapas 3–4)
- **Banco**: PostgreSQL + Prisma `7.10.0` — schema e migrations prontos (Etapa 2)
- **Pagamentos**: Mercado Pago Checkout Pro (SDK `mercadopago@3.6.0`) — criação de preferência (Etapa 4) e webhook de confirmação (Etapa 6) prontos
- **Hospedagem**: Vercel (frontend) + Render (backend)
- **Versionamento**: GitHub

## Estrutura do monorepo

```text
solidaria/
├── apps/
│   ├── web/       # Next.js (App Router) + Tailwind
│   │   ├── src/
│   │   │   ├── app/                # rotas: /, /doacao/{sucesso,pendente,erro}
│   │   │   ├── components/campaign # Hero, Story, Goal, HowToHelp, Transparency, Faq
│   │   │   ├── components/donation # DonationForm
│   │   │   ├── components/layout   # Footer
│   │   │   ├── lib/                # api.ts, money.ts, errorMessages.ts, useClientRequestId.ts
│   │   │   └── test/                # setup do Vitest (jsdom)
│   └── api/       # Fastify + Prisma
│       ├── src/
│       │   ├── server.ts        # entrypoint (dotenv + listen)
│       │   ├── app.ts            # instância Fastify, CORS, error handlers, rotas
│       │   ├── routes/
│       │   │   ├── health.ts     # GET /health
│       │   │   ├── campaign.ts   # GET /api/campaign
│       │   │   ├── payments.ts   # POST /api/payments/create
│       │   │   └── webhooks.ts   # POST /api/webhooks/mercadopago
│       │   ├── lib/
│       │   │   ├── prisma.ts       # PrismaClient com driver adapter (pg)
│       │   │   ├── mercadopago.ts  # client oficial do MP (Preference, Payment)
│       │   │   └── donations.ts    # find-or-create idempotente + máquina de estados
│       │   ├── test/             # dublês de teste (fake Prisma)
│       │   └── generated/prisma/ # client gerado (gitignored)
│       └── prisma/
│           ├── schema.prisma
│           └── migrations/
├── packages/
│   └── shared/    # Tipos e schemas (Zod) compartilhados entre web e api
├── .env.example
├── eslint.config.mjs
├── tsconfig.base.json
└── package.json
```

## Configuração local

Requisitos: Node.js >= 20.9.

```bash
npm install
npm run lint
npm run typecheck
npm run format:check
```

## Scripts disponíveis

| Script                 | Descrição                                                                       |
| ---------------------- | ------------------------------------------------------------------------------- |
| `npm run lint`         | Roda o ESLint em todo o monorepo                                                |
| `npm run format`       | Formata todos os arquivos com Prettier                                          |
| `npm run format:check` | Verifica formatação sem alterar arquivos                                        |
| `npm run typecheck`    | Builda `packages/shared` (necessário para o `.d.ts`) e typecheca cada workspace |
| `npm run build`        | Builda `packages/shared`, depois `apps/api` (nessa ordem — ver decisões)        |

Dentro de `apps/api` especificamente: `npm run dev` (tsx watch), `npm run start` (roda o build), `npm run test` (Vitest), `npm run prisma:validate` / `prisma:generate` / `prisma:migrate`.

## Variáveis de ambiente

Veja [.env.example](.env.example) (visão geral, deploy) e [apps/api/.env.example](apps/api/.env.example) (o que a API realmente carrega). Nenhum valor real deve ser commitado — `.env`/`.env.local` estão no `.gitignore`.

## Banco de dados

Schema em [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma): `Campaign` e `Donation`, enums `DonationStatus`/`PaymentProvider`, valores monetários sempre em centavos (`Int`), `id` em UUID.

```bash
cd apps/api
npx prisma validate    # valida o schema — não precisa de banco
npx prisma generate    # gera o client em src/generated/prisma — não precisa de banco
npx prisma migrate dev # aplica as migrations — precisa de DATABASE_URL real, alcançável
```

**Índice único parcial em `mp_payment_id`** (chave de idempotência do webhook do Mercado Pago — só existe quando a doação já foi processada, por isso não pode ser um `@unique` comum): escrito como migration SQL manual em [`20260904010100_donations_mp_payment_id_partial_unique`](apps/api/prisma/migrations/20260904010100_donations_mp_payment_id_partial_unique/migration.sql), não declarado no `schema.prisma`. Motivo: índice parcial (`where`) no Prisma 7.10.0 só existe como _Preview feature_ (`partialIndexes`), sem GA até o Prisma 8 — não é apropriado depender de uma preview feature numa constraint crítica para consistência financeira. Reavaliar quando o Prisma 8 estabilizar.

## API

```bash
cd apps/api
npm run dev   # http://localhost:3333
```

| Rota                             | Descrição                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                    | Liveness check — não toca o banco, sempre `200 { "status": "ok" }`                                                                 |
| `GET /api/campaign`              | Campanha ativa + `currentAmount` (soma de doações `APPROVED`); `404` se não houver campanha ativa                                  |
| `POST /api/payments/create`      | Cria a Donation (idempotente por `clientRequestId`) + preferência no Mercado Pago; `5 req/min/IP`. Ver seção própria abaixo.       |
| `POST /api/webhooks/mercadopago` | Recebe notificações do Mercado Pago, valida assinatura, consulta o pagamento real e atualiza a Donation. Ver seção própria abaixo. |

Erros seguem sempre `{ "error": { "code": "...", "message": "..." } }` — nunca stack trace, SQL, token ou outra variável de ambiente na resposta. O error handler global (`app.ts`) repassa o status HTTP real de erros conhecidos (ex.: `429` do rate limit) em vez de mascarar tudo como `500` — só erros realmente inesperados (bug, banco fora do ar) viram `500 INTERNAL_ERROR` genérico.

## POST /api/payments/create

Schemas em [packages/shared/src/payment.ts](packages/shared/src/payment.ts): `createPaymentRequestSchema` / `createPaymentResponseSchema`, compartilhados entre `apps/api` (validação real) e o futuro `apps/web` (mesma validação no cliente).

**Request** — `clientRequestId` (UUID, gerado pelo frontend, chave de idempotência), `campaignId` (UUID), `amount` (centavos, inteiro, `500`–`5_000_000` = R$5–R$50.000), `donorName`, `donorEmail` (normalizado: trim + minúsculas), `isPublic` (default `false`). Um eventual campo `status` enviado pelo cliente é descartado silenciosamente pelo Zod (`z.object` não inclui campos não declarados no schema).

**Response 201** — `{ donationId, initPoint }`. Nunca o access token, a preferência completa do MP, ou qualquer campo interno do Prisma.

**Fluxo**: valida campanha (`isActive`) → `findOrCreateDonation` (idempotente, ver abaixo) → se `Donation` já tem `mpPreferenceId`/`mpInitPoint`, reaproveita sem chamar o MP de novo → senão cria a preferência (`external_reference = donation.id`, `notification_url = ${BACKEND_PUBLIC_URL}/api/webhooks/mercadopago`, valor convertido `amount / 100`) → salva `mpPreferenceId`/`mpInitPoint`.

**Idempotência**: chave é `clientRequestId` (`UNIQUE` no banco, Etapa 2). `donations.ts` tenta o `INSERT` direto; se colidir (`P2002`), relê a linha já existente — não faz `SELECT` antes do `INSERT` (evita a janela de corrida de um "check-then-act"). O Mercado Pago **não documenta** um mecanismo de idempotência para o endpoint de criação de preferência (`POST /checkout/preferences`) — só para Pagamentos/Estornos, onde é obrigatório desde 2024. Por isso a idempotência desta rota é 100% nossa, não do MP.

**Campanha inativa**: responde `404 CAMPAIGN_NOT_FOUND` — o mesmo código usado para campanha inexistente (não `400`), para não revelar a um cliente externo se um `campaignId` existe mas está inativo.

**Donation em estado terminal** (`APPROVED`/`REJECTED`/`CANCELLED`/`REFUNDED`): responde `409 DONATION_ALREADY_FINALIZED` — nunca reabre nem cria nova preferência.

**Falha do Mercado Pago**: a `Donation` permanece `PENDING` (sem `mpPreferenceId`) e a resposta é `502 PAYMENT_PROVIDER_ERROR` genérica; o detalhe real (`status`/`message` do SDK, nunca o token) só vai para o log interno.

## POST /api/webhooks/mercadopago

Validação de assinatura via `WebhookSignatureValidator` (SDK oficial `mercadopago`, não HMAC escrito à mão) — manifesto `id:{data.id};request-id:{x-request-id};ts:{ts};`, confirmado por round-trip real em teste (assinatura construída manualmente na suíte e validada pelo SDK de verdade, não mockado). `data.id` vem do **query string** da notificação (`?data.id=...`), não do corpo — confirmado no exemplo de código oficial do SDK. Tolerância de replay de `300s` no `ts` é escolha nossa (`toleranceSeconds`), não uma exigência documentada pelo MP.

**Fluxo**: valida assinatura (401 se inválida) → ignora `type !== "payment"` (200) → `GET /v1/payments/{data.id}` via SDK → localiza `Donation` por `external_reference` (200 se não achar — não é erro recuperável por retry) → mapeia status → `applyPaymentStatus` (`UPDATE` condicional atômico) → sempre `200`.

**Máquina de estados** (`lib/donations.ts`, `isTransitionAllowed`, testada exaustivamente): `PENDING → APPROVED|REJECTED|CANCELLED`, `APPROVED → REFUNDED`. Qualquer outra transição (fora de ordem, ex.: um `pending` atrasado chegando depois de `approved`) não é aplicada — testado explicitamente. `in_mediation` nunca é mapeado para nenhum `DonationStatus` (evento só logado).

**Idempotência e concorrência**: um único `UPDATE ... WHERE status = ANY(...)` (não `SELECT` + `UPDATE`) — a lista de status de origem permitidos é **derivada** de `isTransitionAllowed` (mesma função usada nos testes), não duplicada em SQL solto. Testado com a mesma notificação processada duas vezes e com duas notificações concorrentes via `Promise.all`.

**Validação de valor**: `transaction_amount * 100` comparado a `Donation.amount` com tolerância de 1 centavo — divergência só gera log de alerta, nunca bloqueia a atualização de status (o dinheiro já se moveu de fato).

## Frontend

```bash
cd apps/web
cp .env.example .env.local   # ajuste NEXT_PUBLIC_API_URL se necessário
npm run dev                    # http://localhost:3000
```

Landing page (`/`) busca `GET /api/campaign` no servidor (Server Component, `next: { revalidate: 30 }`) e renderiza: Hero, História, Objetivo (barra de progresso limitada a 100%), Como ajudar, formulário de doação, Transparência, FAQ, Footer. Sem campanha ativa ou com a API fora do ar, mostra um estado de fallback em vez de quebrar — **verificado de verdade**: com o backend real rodando mas sem Postgres alcançável, `GET /api/campaign` retorna `500` e a página renderiza corretamente "Não foi possível carregar a campanha" (não um erro não tratado).

**Formulário de doação**: valores sugeridos (R$10/25/50/100) + "Outro valor"; limites de `MIN_DONATION_AMOUNT_CENTS`/`MAX_DONATION_AMOUNT_CENTS` importados de `@solidaria/shared` (mesmos limites do backend, não duplicados — validação aqui é só UX, o backend valida de verdade). `clientRequestId` gerado uma vez por tentativa (`crypto.randomUUID()`, hook `useClientRequestId`) e reaproveitado em reenvios após erro, garantindo idempotência com o backend (Etapa 4). Botão desabilitado durante o envio e quando os dados são inválidos; erros da API (`400/404/409/429/502/500`) traduzidos para mensagens amigáveis (`lib/errorMessages.ts`) sem expor código/detalhe interno. Sucesso → `window.location.href = initPoint` (redirect real para o Checkout Pro).

**Páginas de retorno** (`/doacao/sucesso`, `/pendente`, `/erro`): apenas informativas — a confirmação real do pagamento vem do webhook (Etapa 6), não do redirecionamento do navegador.

## Decisões de tooling registradas nas etapas

- **npm workspaces** (não pnpm): ambiente de desenvolvimento já tem Node/npm prontos, sem instalação extra.
- **TypeScript pinado em `6.0.3`**, não na versão mais recente (`7.x`): o `typescript-eslint` ainda não suporta TypeScript 7 (`peerDependency: "<6.1.0"`). Reavaliar quando houver suporte oficial.
- **ESLint flat config** (`eslint.config.mjs`) com `typescript-eslint` + `eslint-config-prettier` — formato único suportado a partir do ESLint 9+.
- **Prisma pinado em `7.10.0`**, não na tag `latest` do npm (que aponta para `8.0.0-rc.12`, um release candidate). Reavaliar quando o Prisma 8 sair da fase RC.
- **`prisma.config.ts`** (não `url` dentro de `datasource db` no `schema.prisma`): no Prisma 7, colocar a connection string diretamente no schema gera erro — a URL agora vive só no `prisma.config.ts`, carregado via `dotenv/config`.
- **Índice parcial de `mp_payment_id` via migration SQL manual**, não via preview feature do Prisma — ver seção "Banco de dados" acima.
- **Vulnerabilidades conhecidas e aceitas (dev-time)**: `npm audit` reporta 4 vulnerabilidades _high_ em dependências transitivas do próprio pacote `prisma` (CLI) — `deepmerge-ts` (stack exhaustion) e `mysql2` (drivers que não usamos, já que o projeto é PostgreSQL). Afetam toda a faixa de versões atual do Prisma (6.x–8.x), sem correção disponível hoje, e existem só na ferramenta de linha de comando/build — não são publicadas no runtime (`@prisma/client`) nem chegam ao servidor em produção. Reavaliar a cada atualização do Prisma.
- **Driver adapter obrigatório em runtime** (`@prisma/adapter-pg`): no Prisma 7, `prisma.config.ts` só vale para a CLI — o `PrismaClient` instanciado no código da aplicação (`src/lib/prisma.ts`) precisa de um adapter explícito (`PrismaPg`) apontando para `DATABASE_URL`. Sem isso o client simplesmente não conecta a nada.
- **`npm run build`/`typecheck` (raiz) buildam `packages/shared` antes de `apps/api` explicitamente** (não via `--workspaces` puro): `apps/api` resolve `@solidaria/shared` pelo `dist/index.d.ts` publicado no `package.json` do pacote (`main`/`types`), então se `apps/api` for processado primeiro (ordem padrão de `--workspaces`, que segue `apps/*` antes de `packages/*`), o build falha em um clone limpo. Testado do zero (removendo os `dist/` e rodando `npm run build`) para confirmar.
- **`fastify-type-provider-zod`**: schemas Zod de `packages/shared` viram automaticamente a validação de response do Fastify (`campaignResponseSchema`, `apiErrorResponseSchema`) — sem glue code manual, com erro 400 automático se o formato não bater.
- **SDK oficial `mercadopago@3.6.0`** (não chamadas HTTP manuais): tipos batendo com a doc atual, classes de erro dedicadas (`MercadoPagoError` e subclasses) que garantidamente nunca guardam o Access Token no objeto de erro (mitigação a CWE-209 embutida no próprio SDK).
- **Sem idempotency key do Mercado Pago na criação de preferência**: o SDK aceita `requestOptions.idempotencyKey`, mas a referência oficial de `POST /checkout/preferences` não documenta esse header — só é obrigatório/documentado para Pagamentos e Estornos. Não usamos, para não criar uma falsa sensação de proteção; a idempotência desta rota é inteiramente via `clientRequestId` (constraint `UNIQUE` + catch de `P2002`).
- **Error handler global corrigido nesta etapa**: descoberto via teste automatizado — enviar de volta a própria instância de `Error` lançada pelo `@fastify/rate-limit` disparava a serialização especial de Error do Fastify (campo `error` vira string do motivo HTTP), colidindo com nosso schema `{ error: { code, message } }`. Corrigido extraindo um objeto plano antes de responder; ver `app.ts`.
- **Campanha inativa retorna o mesmo `404 CAMPAIGN_NOT_FOUND`** usado para campanha inexistente (não `400`) — evita revelar a um cliente externo se um `campaignId` existe mas está desativado.
- **`apps/api/tsconfig.build.json`** (separado do `tsconfig.json` usado pelo `typecheck`): descoberto via teste — sem isso, `tsc` compilava os arquivos `*.test.ts` para dentro de `dist/`, e o Vitest passava a descobrir e rodar cada teste duas vezes (uma via `src/`, outra via `dist/`). O `build.json` só adiciona `exclude` dos testes; o `typecheck` continua cobrindo tudo.
- **`WebhookSignatureValidator`/`InvalidWebhookSignatureError` do SDK oficial** (não HMAC escrito à mão): o pacote `mercadopago` já expõe essa validação pronta — usar reduz a chance de um bug sutil no cálculo do HMAC numa rota que é, ao mesmo tempo, a mais crítica para segurança e para consistência financeira do sistema.
- **Máquina de estados (`isTransitionAllowed`) extraída como função pura**, e o `UPDATE` do webhook deriva o guard SQL dela (`status = ANY(${allowedCurrentStatuses})`) em vez de reescrever a tabela de transições em SQL solto — uma única fonte de verdade, testável sem banco.
- **Error handler estendido para 4xx genéricos do próprio Fastify** (ex.: corpo JSON malformado): sem essa correção, esses erros caíam no fallback de `500 INTERNAL_ERROR` em vez de `400` — mesma classe de bug do rate limit, corrigida na mesma função.
- **`back_urls` adicionado a `POST /api/payments/create` nesta etapa** (Etapa 7 corrigindo uma lacuna real da Etapa 4): confirmado contra a documentação oficial que `auto_return: "approved"` **exige** `back_urls.success`, senão o Mercado Pago rejeita a criação da preferência (`invalid_auto_return`). Os testes da Etapa 4 não pegaram isso porque mockam o SDK inteiro — só apareceria em produção. `back_urls` aponta para `${FRONTEND_URL}/doacao/{sucesso,pendente,erro}`, as páginas de retorno criadas nesta etapa.
- **Tailwind CSS v4** (não v3): setup diferente — sem `tailwind.config.js`, só `@import "tailwindcss";` no CSS e o plugin `@tailwindcss/postcss` no PostCSS. Confirmado na doc oficial antes de configurar.
- **`apps/web/tsconfig.json` não estende `tsconfig.base.json`** (diferente de `apps/api`/`packages/shared`): o Next.js tem exigências próprias de compilador (`moduleResolution: "bundler"`, `jsx`) incompatíveis com nossa base voltada a Node/ESM puro — e o próprio `next build` reescreveu automaticamente `jsx: "preserve"` → `"react-jsx"` na primeira build real, confirmando na prática que Next.js gerencia esse arquivo com opinião própria.
- **`@vitejs/plugin-react` + `resolve.tsconfigPaths: true`** no `vitest.config.mts` do frontend: Vitest/Vite não transforma JSX nem resolve o alias `@/*` do `tsconfig.json` automaticamente. `tsconfigPaths` é a opção nativa do Vite (mais nova que o plugin `vite-tsconfig-paths`, que cheguei a usar e depois removi ao ver o aviso do próprio Vite sugerindo a alternativa nativa).
- **Bug real encontrado pelos testes do frontend**: sem um `afterEach(cleanup)` explícito em `src/test/setup.ts`, o auto-cleanup do `@testing-library/react` não é acionado neste setup (não usamos `test.globals` do Vitest) — formulários de testes anteriores continuavam no DOM, causando falhas em cascata por "múltiplos elementos encontrados". Corrigido com limpeza explícita.
- **Asserções de moeda usam regex, não string exata**: `toLocaleString("pt-BR", { style: "currency", ... })` insere um espaço não separável (U+00A0) entre "R$" e o valor, não um espaço comum — descoberto rodando o teste de verdade, não por suposição.

## Testes

`npm run test` (raiz) — **76 testes**, todos mockados (sem banco/MP reais), rápidos, seguros para rodar em qualquer máquina/CI sem infraestrutura.

| Suíte    | Arquivo                                                                                                                                                                        | O quê                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend  | [payments.test.ts](apps/api/src/routes/payments.test.ts) (22)                                                                                                                  | validação Zod, campanha ativa/inexistente/inativa, idempotência, concorrência, contrato exato enviado ao MP, reutilização de preferência, estado terminal, falha do provedor, vazamento de token, rate limit                                                                                                                                                                                                |
| Backend  | [webhooks.test.ts](apps/api/src/routes/webhooks.test.ts) (20)                                                                                                                  | máquina de estados exaustiva, assinatura válida (round-trip real com o SDK)/ausente/inválida/sem `x-request-id`, `type` irrelevante, `external_reference` sem Donation, `in_mediation`, idempotência, concorrência, fora de ordem, `APPROVED→REFUNDED`, **`paymentId` conflitante entre duas Donations**, divergência de valor, falha na consulta ao MP, corpo malformado, rate limit, vazamento de secrets |
| Backend  | [flow.test.ts](apps/api/src/routes/flow.test.ts) (1)                                                                                                                           | fluxo ponta a ponta mockado: `GET /api/campaign` → `POST /api/payments/create` → `initPoint` → webhook aprova → `GET /api/campaign` reflete o novo total                                                                                                                                                                                                                                                    |
| Frontend | [money.test.ts](apps/web/src/lib/money.test.ts), [useClientRequestId.test.tsx](apps/web/src/lib/useClientRequestId.test.tsx), [api.test.ts](apps/web/src/lib/api.test.ts) (18) | conversão reais↔centavos, id estável entre retries, `fetch` mockado (sucesso/404/erro tipado)                                                                                                                                                                                                                                                                                                               |
| Frontend | [DonationForm.test.tsx](apps/web/src/components/donation/DonationForm.test.tsx) (13)                                                                                           | validação, seleção de valor, envio com sucesso e redirect, estado "Enviando...", mensagens amigáveis por código (incluindo `429`), erro de rede, reenvio com o mesmo `clientRequestId`, **acessibilidade automática (axe, 0 violações)**                                                                                                                                                                    |

**Como roda sem banco/Mercado Pago reais**: `lib/prisma.js`/`lib/mercadopago.js` viram dublês via `vi.mock` — nenhum teste toca rede ou banco de verdade. A validação de assinatura usa o `WebhookSignatureValidator` **real** do SDK (não mockado).

### Testes de integração (banco Postgres real — autorados, não executados nesta sessão)

`apps/api/src/routes/*.integration.test.ts` (4 arquivos) usam o `PrismaClient` **real** (não mockado) contra um Postgres de teste descartável; só o cliente do Mercado Pago continua mockado (sem credenciais de sandbox). Existem especificamente para provar o que os dublês só conseguem simular: atomicidade real de `UNIQUE`/índice parcial sob concorrência genuína, e que `prisma migrate deploy` (não `migrate dev`) aplica as migrations do zero sem erro.

```bash
cd apps/api
docker compose -f docker-compose.test.yml up -d   # Postgres descartável na porta 55432
cp .env.test.example .env.test                      # já feito neste repo, com placeholders
npm run test:integration                              # roda migrate deploy + os 4 arquivos
```

**Status real nesta sessão**: autorados e com `typecheck` limpo contra os tipos reais do Prisma (pega erros de nome de campo/assinatura), mas **não executados** — o Docker Desktop desta máquina não estava com o daemon ativo, e não tenho credenciais do Postgres local já em uso na porta 5432. Tentei rodar mesmo assim para confirmar o modo de falha exato: sem `.env.test`, falha limpo em `DATABASE_URL não está definida`; com `.env.test` (placeholders) mas sem o container rodando, falha em `npx prisma migrate deploy` tentando conectar — ambos os pontos de falha são os esperados, não um bug de código. Ver `docker-compose.test.yml`, `.env.test.example`, `vitest.integration.config.ts`, `src/test/integrationSetup.ts`.

**Limitação assumida sobre concorrência nos testes mockados**: os dublês de `donation.create`/`applyPaymentStatus` em `fakePrisma.ts` simulam constraints `UNIQUE` via microtask + mapas em memória (inclusive a colisão de `mp_payment_id` entre duas Donations) — validam que o **código de aplicação** trata a colisão corretamente, mas não substituem a prova de atomicidade real, que só os testes de integração acima (quando rodados contra Postgres de verdade) confirmam.

## Auditoria e hardening (Etapa 8)

Correções aplicadas depois de reler todo o código com espírito crítico:

- **`@fastify/helmet` estava na spec desde a Fase 1 e nunca tinha sido instalado** — adicionado (Etapa 8).
- **`GET /api/campaign` e `POST /api/webhooks/mercadopago` não tinham rate limit** (só `POST /api/payments/create` tinha) — adicionados (`60/min` e `120/min`, respectivamente; a de campanha bate no banco a cada chamada, a de webhook é defesa contra flood de requisições forjadas).
- **`GET /api/campaign` não enviava `Cache-Control`** — adicionado (`public, max-age=30`).
- **`applyPaymentStatus` não tratava conflito real de `mp_payment_id` entre duas Donations** — uma notificação forjada/inconsistente apontando `external_reference` para uma Donation diferente da que já é dona daquele `payment_id` bateria na constraint `UNIQUE` do banco e derrubaria a rota com `500`. Corrigido: captura o erro (`P2010`) e trata como transição não aplicada, igual aos outros casos "fora de ordem".
- **Comentário desatualizado em `.env.example`** dizia que o webhook "ainda não estava implementado" (já estava, desde a Etapa 6).
- **`.gitignore` só cobria `.env`/`.env.local` literalmente** — `.env.test` (introduzido nesta etapa) vazaria se alguém commitasse sem perceber. Trocado para `.env.*` com exceção explícita para os `.example`.

Riscos identificados e **não** corrigidos nesta etapa (fora do escopo de "testes e hardening", decisões de produto/infra que dependem de você):

- Sem repositório Git inicializado — sem histórico, sem diffs revisáveis, sem forma de reverter. Recomendo `git init` + primeiro commit antes do deploy.
- Nada impede duas `Campaign` com `isActive = true` ao mesmo tempo a nível de banco — hoje só é seguro porque a criação de campanha é manual (Prisma Studio). Se um painel admin for construído (fora de escopo), valeria um índice único parcial (`WHERE is_active`) igual ao de `mp_payment_id`.
- CORS protege só clientes de navegador — chamadas diretas (curl/script) a `/api/payments/create` não são bloqueadas por CORS, só pelo rate limit + validação Zod + checagem de campanha ativa. Isso é uma limitação inerente ao CORS (não uma falha nossa), documentada aqui para não gerar falsa sensação de proteção.
- Nenhuma chamada real foi feita contra o Mercado Pago (sandbox) ou um Postgres real nesta sessão — ver seção "Testes de integração" acima para o que está pronto para rodar assim que houver credenciais/infra.

## Progresso

- [x] Etapa 1 — Monorepo + tooling
- [x] Etapa 2 — Banco de dados (Prisma schema + migrations)
- [x] Etapa 3 — API: `/health` e `/api/campaign`
- [x] Etapa 4 — `/api/payments/create`
- [x] Etapa 5 — Integração Mercado Pago (pesquisa/guia técnico do webhook)
- [x] Etapa 6 — Webhook (`/api/webhooks/mercadopago`)
- [x] Etapa 7 — Frontend (landing page + formulário de doação)
- [x] Etapa 8 — Testes, auditoria e hardening
- [ ] Etapa 9 — Deploy
