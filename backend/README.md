# BlackDz Store — API Backend

Backend em Node.js/Express para a BlackDz Store: autenticação, catálogo, checkout,
cupons, avaliações, tickets de suporte, chat de entrega por pedido e painel
administrativo.

Foi testado ponta a ponta neste ambiente (registro → login → checkout → confirmação
manual de pagamento pelo admin → liberação automática do chat do pedido → bloqueio
do painel admin para clientes) e todos os fluxos funcionaram como esperado.

## Rodando localmente

```bash
cd blackdz-backend
npm install
cp .env.example .env
# edite o .env: defina JWT_SECRET, ADMIN_EMAIL e ADMIN_PASSWORD com valores reais
npm start
```

O servidor sobe em `http://localhost:4000` (ou na porta definida em `PORT`).
Na primeira execução, uma conta admin é criada automaticamente a partir de
`ADMIN_EMAIL` / `ADMIN_PASSWORD` — troque a senha assim que possível.

Por padrão, os dados ficam em `database.json` (criado automaticamente na raiz do
projeto), usando [lowdb](https://github.com/typicode/lowdb) como camada de
persistência — ótimo pra rodar local sem configurar banco nenhum.

**Para publicar a loja de verdade**, defina a variável `DATABASE_URL` no `.env`
apontando para um Postgres (ex: [Supabase](https://supabase.com), gratuito e
sem cartão) — nesse caso os dados passam a ser gravados nesse banco em vez do
arquivo local, o que é obrigatório em hospedagens cujo disco não é permanente
(ex: Render). O resto do código (rotas) não muda nada — continua usando a
mesma interface do lowdb (`db.get("produtos")...`); veja `src/db.js` para
os detalhes. Passo a passo completo em `deploy/RENDER_DEPLOY.md`.

## Endpoints principais

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/api/auth/register` | — | Cria conta |
| POST | `/api/auth/login` | — | Login, retorna JWT |
| GET | `/api/products?game=&cat=&q=` | — | Lista produtos (filtros usados pelas páginas de categoria) |
| POST/PUT/DELETE | `/api/products/:id` | admin | CRUD de produtos |
| GET | `/api/categories` | — | Lista categorias com contagem de produtos |
| POST | `/api/coupons/validate` | — | Checagem de cupom antes do checkout |
| POST | `/api/checkout` | cliente | Cria pedido; total sempre recalculado no servidor |
| POST | `/api/checkout/:orderId/confirm` | admin | Confirma pagamento e libera o chat de entrega do pedido |
| GET | `/api/orders/me` \| `/api/orders` | cliente \| admin | Histórico de pedidos (o cliente vê só os seus) |
| GET/POST | `/api/chat/:orderId` | dono do pedido \| admin | Chat de entrega do pedido (texto, imagem, áudio ou arquivo) — é por aqui que o produto é enviado após o pagamento ser confirmado |
| GET/POST | `/api/reviews` | — / comprador | Avaliações (só quem comprou pode postar) |
| POST | `/api/support/tickets` | cliente | Abre ticket de suporte |
| GET | `/api/admin/stats` | admin | Faturamento, vendas, produtos mais vendidos |

## Decisões de segurança

- Senhas com hash `bcrypt` (nunca texto puro).
- Sessão via JWT assinado com `JWT_SECRET` — mantenha esse valor fora do repositório e do frontend.
- **O preço final de um pedido é sempre recalculado no servidor** a partir do banco de
  dados — o frontend nunca envia (nem pode alterar) o valor a pagar.
- Rotas de escrita em produtos, cupons, pedidos e stats exigem `role === "admin"`.
- O chat de um pedido só é liberado para o cliente depois que o pagamento é
  confirmado manualmente pelo admin; o próprio pedido só pode ser lido pelo dono
  (ou por um admin).
- Rate limiting nas rotas de autenticação e de forma geral na API.
- `helmet` para cabeçalhos HTTP seguros; CORS restrito às origens definidas em `CORS_ORIGIN`.

## O que trocar antes de ir para produção

1. **Pagamento**: `POST /api/checkout` e `POST /api/checkout/:orderId/confirm` estão
   com um gateway "mock". Troque pela criação real de um payment intent (Stripe, Mercado
   Pago, Pagar.me...) e faça a confirmação através do **webhook assinado do provedor**,
   nunca por uma chamada direta do botão "pagar" do cliente.
2. **Entrega de arquivos**: hoje a entrega é feita manualmente pela equipe através do
   chat do pedido (`/api/chat/:orderId`). Se quiser automatizar o envio de arquivos,
   adicione um endpoint de download que gere uma URL assinada de curta duração (S3
   presigned URL, Cloudflare R2 etc.) só depois de confirmar que o pedido pertence ao
   usuário autenticado e está pago.
3. **Banco de dados**: já resolvido — defina `DATABASE_URL` (ex: Supabase) e os
   dados passam a ser persistidos em Postgres de verdade em vez do arquivo local.
   Veja `deploy/RENDER_DEPLOY.md`.
4. **Segredos**: nunca comite o `.env` real; use um secret manager em produção.
