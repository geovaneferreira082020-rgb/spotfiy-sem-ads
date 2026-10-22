-- schema.sql
-- Executado a cada inicialização do servidor. Tudo usa IF NOT EXISTS,
-- então rodar de novo é seguro e não apaga dados.

-- Mesmas colunas da versão anterior, para que as contas já criadas continuem valendo.
CREATE TABLE IF NOT EXISTS users (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email    TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL            -- hash do bcrypt, nunca a senha em texto puro
);

-- Músicas curtidas: uma linha por par (usuário, música).
-- song_id é o "id" do songs.json (o catálogo não fica no banco).
-- A chave primária composta já impede curtir duas vezes e acelera a busca por usuário.
CREATE TABLE IF NOT EXISTS liked_songs (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id  TEXT    NOT NULL,
  liked_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, song_id)
);
