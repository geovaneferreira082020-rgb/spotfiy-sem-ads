// update_covers.js
// Busca capas de álbum na iTunes Search API e grava a URL no campo "img" de cada música do songs.json.
//
// Uso:
//   node update_covers.js                  atualiza a capa de todas as músicas
//   node update_covers.js --missing-only   só preenche as músicas que estão sem capa
//
// Antes de gravar, o script salva uma cópia em songs.json.bak.

const fs = require('fs/promises');
const path = require('path');

const SONGS_PATH = path.join(__dirname, 'songs.json');
const BACKUP_PATH = `${SONGS_PATH}.bak`;
const COVER_SIZE = '300x300bb';

// A API do iTunes aceita cerca de 20 buscas por minuto; esperar entre elas evita bloqueio.
const DELAY_BETWEEN_REQUESTS_MS = 3200;

const missingOnly = process.argv.includes('--missing-only');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// "Marília Mendonça" -> "marilia mendonca": facilita comparar nomes de artistas.
const normalize = (text = '') =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

// Devolve a URL da capa ou null se nenhum resultado for do artista procurado.
async function findCoverUrl(song) {
  const term = encodeURIComponent(`${song.artist} ${song.title}`);
  const response = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=5`);
  if (!response.ok) throw new Error(`o iTunes respondeu com status ${response.status}`);

  const { results } = await response.json();

  // A busca é aproximada. Só aceitamos resultado do mesmo artista,
  // senão uma música com nome parecido poderia ganhar a capa errada.
  const artist = normalize(song.artist);
  const match = results.find((result) => result.artworkUrl100 && normalize(result.artistName).includes(artist));

  return match ? match.artworkUrl100.replace('100x100bb', COVER_SIZE) : null;
}

async function main() {
  const catalog = JSON.parse(await fs.readFile(SONGS_PATH, 'utf8'));

  await fs.copyFile(SONGS_PATH, BACKUP_PATH);
  console.log(`Backup salvo em ${path.basename(BACKUP_PATH)}`);

  const targets = catalog.songs.filter((song) => !missingOnly || !song.img);
  console.log(`Buscando capas de ${targets.length} música(s)...\n`);

  let updated = 0;

  for (const [index, song] of targets.entries()) {
    try {
      const coverUrl = await findCoverUrl(song);

      if (coverUrl) {
        song.img = coverUrl;
        updated += 1;
        console.log(`ok       ${song.title} (${song.artist})`);
      } else {
        console.log(`sem capa ${song.title} (${song.artist}): mantendo a atual`);
      }
    } catch (err) {
      console.error(`erro     ${song.title}: ${err.message}`);
    }

    if (index < targets.length - 1) await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  await fs.writeFile(SONGS_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`\nPronto: ${updated} de ${targets.length} capas atualizadas. Reinicie o servidor para carregar o novo songs.json.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Falha ao atualizar as capas:', err.message);
    process.exit(1);
  });
}

module.exports = { normalize, findCoverUrl };
