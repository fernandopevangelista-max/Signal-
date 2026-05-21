# Signal

Ferramenta operacional de call center para registro de sinais da linha de frente — sugestões, problemas e impactos — com painel administrativo completo.

## Requisitos

- Node.js 18 ou superior

## Instalação

```bash
npm install
```

Copie o arquivo de exemplo de variáveis de ambiente:

```bash
cp .env.example .env
```

Edite o `.env` conforme necessário:

```
PORT=3000
ADMIN_SECRET=signal2025
NODE_ENV=development
```

## Rodando o projeto

**Modo desenvolvimento (com reload automático):**

```bash
npm run dev
```

**Modo produção:**

```bash
npm start
```

O banco de dados `signal.db` é criado automaticamente na raiz do projeto na primeira execução, incluindo os segmentos iniciais pré-populados.

## Acessos

| URL | Descrição |
|---|---|
| `http://localhost:3000/` | Formulário do atendente |
| `http://localhost:3000/admin/signal2025` | Painel administrativo |

> Substitua `signal2025` pelo valor definido em `ADMIN_SECRET` no seu `.env`.

## Funcionalidades

### Formulário do atendente
- Registro de sinais sem necessidade de login
- Campos: nome, matrícula, segmento, tipo de registro, título, descrição, sugestão de solução e nível de impacto
- Animação de sucesso após envio

### Painel Admin
- **Dashboard**: totais, breakdowns por tipo/segmento/impacto/status e gráfico de registros por dia (30 dias)
- **Registros**: tabela paginada com filtros, busca por texto livre, modal de detalhes, alteração de status e exclusão
- **Segmentos**: gerenciamento de segmentos (criar, ativar/desativar, excluir)
- **Exportação**: export CSV de todos os registros ou por período

## Estrutura

```
signal/
├── server.js          ← servidor Express + SQLite
├── signal.db          ← banco de dados (gerado automaticamente)
├── package.json
├── .env.example
└── public/
    ├── index.html     ← formulário do atendente
    ├── admin.html     ← painel admin
    └── assets/
        ├── style.css
        └── app.js
```

## Stack

- **Backend**: Node.js + Express + SQLite (better-sqlite3)
- **Frontend**: HTML/CSS/JS vanilla
- **Porta padrão**: 3000
