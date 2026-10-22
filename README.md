# Spotfiy

Clone do Spotify Web com login, player completo e músicas curtidas salvas por usuário.

**Stack:** Node.js + Express, SQLite, JWT + bcrypt no backend. HTML, CSS e JavaScript puro no frontend.

## Como rodar

```bash
npm install
cp .env.example .env     # depois edite o JWT_SECRET
npm start
```

Abra http://localhost:3000, crie uma conta e pronto.

Os arquivos de áudio ficam em `public/assets/audio/`, com os nomes que aparecem no campo `src` do `songs.json`
(por exemplo `order.mp3`). Sem o arquivo, a faixa aparece na lista e o player mostra um aviso amigável ao tentar tocá-la.

## Estrutura

```
server.js          inicialização do Express e rotas de músicas e curtidas
auth.js            cadastro, login, JWT e o middleware requireAuth
database.js        conexão com o SQLite e todas as queries
middleware.js      asyncHandler, 404 da API e tratamento de erros
schema.sql         tabelas (users e liked_songs)
update_covers.js   busca capas no iTunes e atualiza o songs.json
songs.json         catálogo de músicas
public/
  index.html       estrutura da página
  style.css        tema escuro estilo Spotify
  script.js        sessão, lista, busca, curtidas e player
```

## API

| Método | Rota                 | Descrição                             |
| ------ | -------------------- | ------------------------------------- |
| POST   | `/api/auth/register` | cria a conta e já devolve o token     |
| POST   | `/api/auth/login`    | devolve token e dados do usuário      |
| GET    | `/api/auth/me`       | valida o token e devolve o usuário    |
| GET    | `/api/songs`         | catálogo (exige login)                |
| GET    | `/api/likes`         | ids das músicas curtidas do usuário   |
| PUT    | `/api/likes/:songId` | curtir                                |
| DELETE | `/api/likes/:songId` | descurtir                             |

## Capas

```bash
npm run covers                         # atualiza todas
node update_covers.js --missing-only   # só as que estão sem capa
```

Antes de gravar, o script salva uma cópia em `songs.json.bak`. Reinicie o servidor depois para carregar o novo catálogo.

## Atalhos

- **Barra de espaço**: tocar / pausar
