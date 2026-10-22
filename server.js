// server.js
// Ponto de entrada: sobe o Express, serve o frontend (pasta public/) e expõe a API.

require('dotenv').config(); // precisa vir antes dos outros módulos, que leem process.env

const fs = require('fs');
const path = require('path');
const express = require('express');
const db = require('./database');
const { authRouter, requireAuth } = require('./auth');
const { asyncHandler, apiNotFound, errorHandler } = require('./middleware');

const PORT = process.env.PORT || 3000;
const SONGS_PATH = path.join(__dirname, 'songs.json');

// O catálogo é lido uma vez na inicialização. Se editar o songs.json (ou rodar o update_covers.js),
// reinicie o servidor.
function loadSongs() {
  const { songs } = JSON.parse(fs.readFileSync(SONGS_PATH, 'utf8'));

  if (!Array.isArray(songs)) {
    throw new Error('O songs.json precisa ter a chave "songs" com uma lista de músicas.');
  }
  return songs;
}

async function main() {
  await db.init();

  const songs = loadSongs();
  const songIds = new Set(songs.map((song) => song.id));

  // Só aceita curtir músicas que existem no catálogo.
  const requireKnownSong = (req, res, next) => {
    if (!songIds.has(req.params.songId)) {
      return res.status(404).json({ error: 'Música não encontrada.' });
    }
    next();
  };

  const app = express();
  app.use(express.json());

  // Frontend + áudios. O express.static já suporta "Range requests", que o navegador
  // usa para avançar/voltar dentro da música.
  app.use(express.static(path.join(__dirname, 'public')));

  app.use('/api/auth', authRouter);

  app.get('/api/songs', requireAuth, (req, res) => {
    res.json({ songs });
  });

  app.get(
    '/api/likes',
    requireAuth,
    asyncHandler(async (req, res) => {
      const likedIds = await db.getLikedSongIds(req.user.id);
      // Ignora curtidas de músicas que saíram do catálogo.
      res.json({ likedIds: likedIds.filter((id) => songIds.has(id)) });
    })
  );

  app.put(
    '/api/likes/:songId',
    requireAuth,
    requireKnownSong,
    asyncHandler(async (req, res) => {
      await db.addLike(req.user.id, req.params.songId);
      res.status(204).end();
    })
  );

  app.delete(
    '/api/likes/:songId',
    requireAuth,
    requireKnownSong,
    asyncHandler(async (req, res) => {
      await db.removeLike(req.user.id, req.params.songId);
      res.status(204).end();
    })
  );

  app.use('/api', apiNotFound);
  app.use(errorHandler);

  app.listen(PORT, () => {
    console.log(`Spotfiy rodando em http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Não foi possível iniciar o servidor:', err);
  process.exit(1);
});
