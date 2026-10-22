// database.js
// Conexão com o SQLite e todas as queries da aplicação.
// O resto do código nunca escreve SQL: chama as funções exportadas aqui.

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// O mesmo nome de arquivo da versão anterior, para não perder as contas já criadas.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'banco_de_dados.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('Erro ao abrir o banco de dados:', err.message);
});

// O sqlite3 trabalha com callbacks; estes wrappers deixam o resto do código usar async/await.
const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onDone(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });

const exec = (sql) =>
  new Promise((resolve, reject) => {
    db.exec(sql, (err) => (err ? reject(err) : resolve()));
  });

// Cria as tabelas (se ainda não existirem). Chamar uma vez, antes de subir o servidor.
async function init() {
  // O SQLite só respeita chaves estrangeiras (ON DELETE CASCADE) se isto estiver ligado.
  await run('PRAGMA foreign_keys = ON');
  await exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  console.log(`Banco de dados pronto em ${path.basename(DB_PATH)}`);
}

// Violação de UNIQUE (e-mail ou usuário repetido) chega como SQLITE_CONSTRAINT.
const isUniqueViolation = (err) => Boolean(err) && err.code === 'SQLITE_CONSTRAINT';

/* ---------- Usuários ---------- */

async function createUser({ username, email, passwordHash }) {
  const { lastID } = await run('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [
    username,
    email,
    passwordHash,
  ]);
  return lastID;
}

// COLLATE NOCASE: contas antigas podem ter e-mail salvo com maiúsculas.
const findUserByEmail = (email) =>
  get('SELECT id, username, email, password FROM users WHERE email = ? COLLATE NOCASE', [email]);

const findUserById = (id) => get('SELECT id, username, email FROM users WHERE id = ?', [id]);

/* ---------- Músicas curtidas ---------- */

async function getLikedSongIds(userId) {
  const rows = await all('SELECT song_id FROM liked_songs WHERE user_id = ? ORDER BY liked_at DESC', [userId]);
  return rows.map((row) => row.song_id);
}

// INSERT OR IGNORE / DELETE são idempotentes: repetir a chamada não gera erro.
const addLike = (userId, songId) =>
  run('INSERT OR IGNORE INTO liked_songs (user_id, song_id) VALUES (?, ?)', [userId, songId]);

const removeLike = (userId, songId) =>
  run('DELETE FROM liked_songs WHERE user_id = ? AND song_id = ?', [userId, songId]);

module.exports = {
  init,
  isUniqueViolation,
  createUser,
  findUserByEmail,
  findUserById,
  getLikedSongIds,
  addLike,
  removeLike,
};
