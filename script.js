/* ==========================================================================
   Spotfiy — frontend (script.js)
   Seções: 1. Configuração e estado   2. Utilitários   3. API
           4. Sessão e telas          5. Biblioteca (lista, busca, curtidas)
           6. Player                  7. Eventos e inicialização
   ========================================================================== */

/* ---------- 1. Configuração e estado ---------- */

const API_URL = ''; // mesma origem: o Express serve o frontend e a API juntos
const APP_TITLE = 'Spotfiy';
const TOKEN_KEY = 'spotfiy:token';
const VOLUME_KEY = 'spotfiy:volume';
const DEFAULT_VOLUME = 0.8;
const RESTART_THRESHOLD_SECONDS = 3; // "anterior" depois disso volta ao começo da faixa
const TOAST_DURATION_MS = 4000;

const REPEAT_MODES = ['off', 'all', 'one'];
const REPEAT_LABELS = {
  off: 'Repetir: desativado',
  all: 'Repetir: todas as músicas',
  one: 'Repetir: esta música',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const COVER_FALLBACK =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#282828"/>' +
      '<path fill="#b3b3b3" transform="translate(4.8 4.8) scale(.6)" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>'
  );

const state = {
  songs: [],
  likedIds: new Set(),
  view: 'all', // 'all' | 'liked'
  query: '',
  currentSong: null,
  shuffle: false,
  repeat: 'off', // 'off' | 'all' | 'one'
  isSeeking: false,
  lastVolume: DEFAULT_VOLUME,
};

// Fila de reprodução. `original` é a ordem da lista no momento em que o play foi dado;
// `order` é a ordem em que as faixas tocam (embaralhada quando o shuffle está ligado).
const queue = { original: [], order: [], position: -1 };

const $ = (id) => document.getElementById(id);

const els = {
  authView: $('auth-view'),
  loginBox: $('login-box'),
  registerBox: $('register-box'),
  loginForm: $('login-form'),
  registerForm: $('register-form'),
  loginError: $('login-error'),
  registerError: $('register-error'),
  showRegister: $('show-register'),
  showLogin: $('show-login'),

  appView: $('app-view'),
  main: $('main'),
  topbar: $('topbar'),
  userName: $('user-name'),
  logoutBtn: $('logout-btn'),
  searchInput: $('search-input'),
  likedCount: $('liked-count'),
  viewTitle: $('view-title'),
  viewSubtitle: $('view-subtitle'),
  trackHeader: $('track-header'),
  trackList: $('track-list'),
  trackTemplate: $('track-template'),
  listMessage: $('list-message'),
  listMessageText: $('list-message-text'),
  listRetryBtn: $('list-retry-btn'),
  toast: $('toast'),

  audio: $('audio-player'),
  playerCover: $('player-cover'),
  playerTitle: $('player-title'),
  playerArtist: $('player-artist'),
  playerLike: $('player-like-btn'),
  shuffleBtn: $('shuffle-btn'),
  prevBtn: $('prev-btn'),
  playBtn: $('play-btn'),
  nextBtn: $('next-btn'),
  repeatBtn: $('repeat-btn'),
  currentTime: $('current-time'),
  duration: $('duration'),
  progress: $('progress'),
  muteBtn: $('mute-btn'),
  volume: $('volume'),
};

const audio = els.audio;

/* ---------- 2. Utilitários ---------- */

// Minúsculas e sem acento: "Marília" casa com "marilia".
const normalizeText = (value = '') =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const pluralizeSongs = (count) => `${count} ${count === 1 ? 'música' : 'músicas'}`;

function formatTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// Fisher-Yates: devolve uma cópia embaralhada, sem mexer no array original.
function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Troca o ícone de um botão (os ícones vêm do sprite no index.html).
function setIcon(button, iconName) {
  button.querySelector('use').setAttribute('href', `#icon-${iconName}`);
}

// Capa com fallback: se a imagem não existir ou falhar, mostra o placeholder.
function setCover(img, url) {
  img.onerror = () => {
    img.onerror = null; // evita loop caso o próprio fallback falhe
    img.src = COVER_FALLBACK;
  };
  img.src = url || COVER_FALLBACK;
}

// Preenche a parte "cheia" dos sliders (progresso e volume) via variável CSS.
function setSliderFill(slider) {
  const max = Number(slider.max) || 0;
  const percent = max ? (Number(slider.value) / max) * 100 : 0;
  slider.style.setProperty('--fill', `${percent}%`);
}

let toastTimer;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), TOAST_DURATION_MS);
}

function showFormError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

// Desabilita o botão de enviar e troca o texto enquanto a requisição está em andamento.
function setFormBusy(form, busy, busyLabel = '') {
  const button = form.querySelector('button[type="submit"]');

  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel;
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
  button.disabled = busy;
}

/* ---------- 3. API ---------- */

class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

// Wrapper do fetch: injeta o token, lê o JSON e transforma qualquer falha em ApiError
// com uma mensagem que já pode ser mostrada ao usuário.
async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';

  const token = auth ? localStorage.getItem(TOKEN_KEY) : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(API_URL + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Não foi possível conectar ao servidor. Verifique sua conexão e tente de novo.');
  }

  const data = await response.json().catch(() => ({})); // respostas 204 não têm corpo
  if (response.ok) return data;

  // 401 com token enviado = sessão expirada ou inválida.
  if (response.status === 401 && token) handleSessionExpired();

  throw new ApiError(data.error || 'Algo deu errado. Tente novamente.', response.status);
}

/* ---------- 4. Sessão e telas ---------- */

function showAuthView(message = '') {
  els.appView.hidden = true;
  els.authView.hidden = false;
  switchAuthForm('login');
  showFormError(els.loginError, message);
}

function showAppView() {
  els.authView.hidden = true;
  els.appView.hidden = false;
}

function switchAuthForm(form) {
  const showLogin = form === 'login';
  els.loginBox.hidden = !showLogin;
  els.registerBox.hidden = showLogin;
  showFormError(els.loginError, '');
  showFormError(els.registerError, '');
}

// Guarda o token, abre o app e carrega a biblioteca do usuário.
async function beginSession({ token, user }) {
  localStorage.setItem(TOKEN_KEY, token);
  els.userName.textContent = user.username;
  showAppView();
  await loadLibrary();
}

function handleSessionExpired() {
  localStorage.removeItem(TOKEN_KEY);
  resetApp();
  showAuthView('Sua sessão expirou. Entre novamente.');
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  resetApp();
  showAuthView();
}

// Limpa tudo que pertence ao usuário anterior (música tocando, curtidas, busca).
function resetApp() {
  resetPlayer();
  state.songs = [];
  state.likedIds = new Set();
  state.query = '';
  els.searchInput.value = '';
  els.trackList.replaceChildren();
  els.trackHeader.hidden = true;
  hideListMessage();
  updateLikedCount();
  state.view = 'all';
  syncNav();
}

// Tanto o login quanto o cadastro terminam do mesmo jeito; só muda o endpoint e onde o erro aparece.
async function submitAuthForm(event, { endpoint, errorEl, busyLabel }) {
  event.preventDefault();
  const form = event.currentTarget;

  showFormError(errorEl, '');
  setFormBusy(form, true, busyLabel);

  try {
    const session = await api(endpoint, {
      method: 'POST',
      auth: false,
      body: Object.fromEntries(new FormData(form)),
    });
    form.reset(); // não deixa a senha digitada no formulário
    await beginSession(session);
  } catch (error) {
    showFormError(errorEl, error.message);
  } finally {
    setFormBusy(form, false);
  }
}

/* ---------- 5. Biblioteca: lista, busca e curtidas ---------- */

async function loadLibrary() {
  showListMessage('Carregando músicas...');

  try {
    const [{ songs }, { likedIds }] = await Promise.all([api('/api/songs'), api('/api/likes')]);

    // searchText é calculado uma vez aqui para a busca ser instantânea depois.
    state.songs = songs.map((song) => ({
      ...song,
      searchText: normalizeText(`${song.title} ${song.artist} ${song.genre || ''}`),
    }));
    state.likedIds = new Set(likedIds);

    updateLikedCount();
    renderTrackList();
  } catch (error) {
    if (error.status === 401) return; // handleSessionExpired já levou o usuário ao login
    showListMessage(`Não foi possível carregar as músicas. ${error.message}`, { retry: true });
  }
}

const findSong = (id) => state.songs.find((song) => song.id === id);

// Aplica a aba atual (todas / curtidas) e o texto da busca.
// Cada palavra digitada precisa aparecer no título, artista ou gênero ("linkin rock" funciona).
function getVisibleSongs() {
  const terms = normalizeText(state.query).split(/\s+/).filter(Boolean);

  return state.songs.filter((song) => {
    if (state.view === 'liked' && !state.likedIds.has(song.id)) return false;
    return terms.every((term) => song.searchText.includes(term));
  });
}

function setView(view) {
  state.view = view;
  syncNav();
  renderTrackList();
}

function syncNav() {
  document.querySelectorAll('.view-link').forEach((link) => {
    const isActive = link.dataset.target === state.view;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  els.main.dataset.view = state.view;
}

function renderTrackList() {
  const songs = getVisibleSongs();

  els.trackList.replaceChildren(...songs.map((song, index) => createTrackRow(song, index + 1)));
  els.trackHeader.hidden = songs.length === 0;

  els.viewTitle.textContent = state.view === 'liked' ? 'Músicas Curtidas' : 'Todas as músicas';
  els.viewSubtitle.textContent = pluralizeSongs(songs.length);

  if (songs.length) hideListMessage();
  else showListMessage(describeEmptyList());

  syncNowPlaying();
}

function describeEmptyList() {
  const query = state.query.trim();

  if (query) return `Nenhum resultado para “${query}”. Tente outro título, artista ou gênero.`;
  if (state.view === 'liked') {
    return 'Você ainda não curtiu nenhuma música. Toque no coração ao lado de uma faixa para salvá-la aqui.';
  }
  return 'Nenhuma música disponível no momento.';
}

function showListMessage(text, { retry = false } = {}) {
  els.listMessageText.textContent = text;
  els.listRetryBtn.hidden = !retry;
  els.listMessage.hidden = false;
}

function hideListMessage() {
  els.listMessage.hidden = true;
}

// Monta uma linha a partir do <template> do HTML. Tudo entra via textContent,
// então títulos com caracteres especiais nunca viram HTML.
function createTrackRow(song, position) {
  const row = els.trackTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.id = song.id;

  row.querySelector('.track-number').textContent = position;
  row.querySelector('.track-title').textContent = song.title;
  row.querySelector('.track-artist').textContent = song.artist;
  row.querySelector('.track-genre').textContent = song.genre || '—';
  row.querySelector('.track-play').setAttribute('aria-label', `Tocar ${song.title}, de ${song.artist}`);

  setCover(row.querySelector('.track-cover'), song.img);
  paintLikeButton(row.querySelector('.like-btn'), state.likedIds.has(song.id), song.title);

  return row;
}

// Destaca a faixa atual na lista; o equalizador só anima enquanto a música toca.
function syncNowPlaying() {
  const currentId = state.currentSong?.id;
  const playing = !audio.paused;

  els.trackList.querySelectorAll('.track').forEach((row) => {
    const isCurrent = row.dataset.id === currentId;
    row.classList.toggle('is-current', isCurrent);
    row.classList.toggle('is-playing', isCurrent && playing);
  });
}

function paintLikeButton(button, liked, songTitle) {
  const name = songTitle ? `“${songTitle}”` : 'música';

  button.classList.toggle('is-liked', liked);
  button.setAttribute('aria-pressed', liked);
  button.setAttribute('aria-label', liked ? `Remover ${name} das Músicas Curtidas` : `Curtir ${name}`);
  button.title = liked ? 'Remover das Músicas Curtidas' : 'Curtir';
  setIcon(button, liked ? 'heart-filled' : 'heart-outline');
}

function updateLikedCount() {
  els.likedCount.textContent = `Playlist • ${pluralizeSongs(state.likedIds.size)}`;
}

// Atualiza o estado local e todos os lugares que mostram o coração dessa música.
function setLiked(songId, liked) {
  if (liked) state.likedIds.add(songId);
  else state.likedIds.delete(songId);

  updateLikedCount();

  if (state.view === 'liked') {
    renderTrackList(); // a faixa entra ou sai da aba de curtidas
  } else {
    const song = findSong(songId);
    els.trackList
      .querySelectorAll(`.track[data-id="${CSS.escape(songId)}"] .like-btn`)
      .forEach((button) => paintLikeButton(button, liked, song.title));
  }

  if (state.currentSong?.id === songId) {
    paintLikeButton(els.playerLike, liked, state.currentSong.title);
  }
}

// Atualização otimista: o coração muda na hora e só volta atrás se o servidor recusar.
async function toggleLike(song) {
  const shouldLike = !state.likedIds.has(song.id);
  setLiked(song.id, shouldLike);

  try {
    await api(`/api/likes/${encodeURIComponent(song.id)}`, { method: shouldLike ? 'PUT' : 'DELETE' });
  } catch (error) {
    setLiked(song.id, !shouldLike);
    if (error.status !== 401) showToast('Não foi possível atualizar suas curtidas. Tente novamente.');
  }
}

/* ---------- 6. Player ---------- */

// --- Fila e navegação entre faixas ---

// Define a ordem de reprodução mantendo a faixa atual como ponto de partida.
function applyOrder(currentSong) {
  if (state.shuffle) {
    const rest = queue.original.filter((song) => song.id !== currentSong.id);
    queue.order = [currentSong, ...shuffled(rest)];
    queue.position = 0;
  } else {
    queue.order = [...queue.original];
    queue.position = queue.order.findIndex((song) => song.id === currentSong.id);
  }
}

// Começa a tocar `song`; a fila passa a ser a lista que estava na tela (como no Spotify).
function startPlayback(song, contextSongs) {
  queue.original = [...contextSongs];
  applyOrder(song);
  playSong(song);
}

function playSong(song) {
  loadSong(song);
  playAudio();
}

function goTo(position) {
  queue.position = position;
  playSong(queue.order[position]);
}

function playNext({ auto = false } = {}) {
  if (!queue.order.length) return;

  const isLast = queue.position === queue.order.length - 1;

  // A música terminou sozinha, era a última da fila e não há repetição: para por aqui.
  if (isLast && auto && state.repeat === 'off') {
    audio.currentTime = 0;
    audio.pause();
    syncPlayState();
    return;
  }

  goTo(isLast ? 0 : queue.position + 1);
}

function playPrevious() {
  if (!queue.order.length) return;

  // Como no Spotify: depois dos primeiros segundos, "anterior" só reinicia a faixa.
  if (audio.currentTime > RESTART_THRESHOLD_SECONDS) {
    audio.currentTime = 0;
  } else if (queue.position > 0) {
    goTo(queue.position - 1);
  } else if (state.repeat === 'all') {
    goTo(queue.order.length - 1);
  } else {
    audio.currentTime = 0;
  }
}

// --- Carregar e tocar ---

function loadSong(song) {
  state.currentSong = song;
  audio.src = song.src;

  els.playerTitle.textContent = song.title;
  els.playerArtist.textContent = song.artist;
  setCover(els.playerCover, song.img);
  paintLikeButton(els.playerLike, state.likedIds.has(song.id), song.title);
  els.playerLike.disabled = false;
  els.progress.disabled = false;
  document.title = `${song.title} • ${song.artist}`;

  renderProgress();
  syncNowPlaying();
}

async function playAudio() {
  try {
    await audio.play();
  } catch (error) {
    // AbortError: o usuário trocou de faixa antes de a anterior começar. Não é um erro de verdade.
    if (error.name === 'AbortError') return;

    if (error.name === 'NotSupportedError') handleAudioError(); // arquivo ausente ou formato inválido
    else if (error.name === 'NotAllowedError') showToast('O navegador bloqueou a reprodução. Toque em play para continuar.');
  }
}

function togglePlay() {
  if (!state.currentSong) {
    // Nada selecionado ainda: começa pela primeira faixa da lista visível.
    const visible = getVisibleSongs();
    if (visible.length) startPlayback(visible[0], visible);
    return;
  }

  if (audio.paused) playAudio();
  else audio.pause();
}

// Clique numa linha da lista: outra faixa começa a tocar; a faixa atual alterna play/pause.
function handleTrackClick(song) {
  const visibleSongs = getVisibleSongs();

  if (state.currentSong?.id !== song.id) {
    startPlayback(song, visibleSongs);
    return;
  }

  // Mesma faixa, mas talvez em outra aba ou busca: a fila passa a seguir a lista que está na tela.
  queue.original = [...visibleSongs];
  applyOrder(song);
  togglePlay();
}

function syncPlayState() {
  const playing = !audio.paused;

  setIcon(els.playBtn, playing ? 'pause' : 'play');
  els.playBtn.setAttribute('aria-label', playing ? 'Pausar' : 'Tocar');
  els.playBtn.title = playing ? 'Pausar' : 'Tocar';
  syncNowPlaying();
}

function handleAudioError() {
  if (!state.currentSong) return; // acontece ao limpar o src no logout

  showToast(`Não foi possível carregar “${state.currentSong.title}”. O arquivo de áudio pode estar indisponível.`);
  syncPlayState();
}

function resetPlayer() {
  audio.pause();
  state.currentSong = null;
  audio.removeAttribute('src');
  audio.load();

  queue.original = [];
  queue.order = [];
  queue.position = -1;

  els.playerTitle.textContent = 'Nenhuma música tocando';
  els.playerArtist.textContent = 'Escolha uma faixa na lista';
  setCover(els.playerCover, null);
  paintLikeButton(els.playerLike, false, '');
  els.playerLike.disabled = true;
  els.progress.disabled = true;
  document.title = APP_TITLE;

  renderProgress();
  syncPlayState();
}

// --- Aleatório e repetir ---

function toggleShuffle() {
  state.shuffle = !state.shuffle;

  // Refaz a ordem da fila sem interromper a faixa que está tocando.
  if (state.currentSong && queue.original.length) applyOrder(state.currentSong);
  syncModeButtons();
}

function cycleRepeat() {
  state.repeat = REPEAT_MODES[(REPEAT_MODES.indexOf(state.repeat) + 1) % REPEAT_MODES.length];
  audio.loop = state.repeat === 'one'; // o próprio <audio> cuida de repetir uma faixa só
  syncModeButtons();
}

function syncModeButtons() {
  els.shuffleBtn.classList.toggle('is-active', state.shuffle);
  els.shuffleBtn.setAttribute('aria-pressed', state.shuffle);
  els.shuffleBtn.title = state.shuffle ? 'Desativar modo aleatório' : 'Ativar modo aleatório';

  els.repeatBtn.classList.toggle('is-active', state.repeat !== 'off');
  els.repeatBtn.setAttribute('aria-label', REPEAT_LABELS[state.repeat]);
  els.repeatBtn.title = REPEAT_LABELS[state.repeat];
  setIcon(els.repeatBtn, state.repeat === 'one' ? 'repeat-one' : 'repeat');
}

// --- Barra de progresso ---

function renderProgress() {
  if (state.isSeeking) return; // enquanto o usuário arrasta, a barra obedece o dedo e não o áudio

  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;

  els.progress.max = duration;
  els.progress.value = audio.currentTime;
  setSliderFill(els.progress);
  els.currentTime.textContent = formatTime(audio.currentTime);
  els.duration.textContent = formatTime(duration);
}

// Durante o arraste só atualizamos a tela; a música pula uma vez só, quando o usuário solta.
function handleSeekInput() {
  state.isSeeking = true;
  setSliderFill(els.progress);
  els.currentTime.textContent = formatTime(Number(els.progress.value));
}

function handleSeekCommit() {
  audio.currentTime = Number(els.progress.value);
  state.isSeeking = false;
  renderProgress();
}

// --- Volume ---

function saveVolume() {
  localStorage.setItem(VOLUME_KEY, audio.volume);
}

function initVolume() {
  const saved = parseFloat(localStorage.getItem(VOLUME_KEY));
  const volume = Number.isFinite(saved) ? Math.min(Math.max(saved, 0), 1) : DEFAULT_VOLUME;

  audio.volume = volume;
  if (volume > 0) state.lastVolume = volume;
  syncVolumeUI();
}

function handleVolumeInput() {
  const volume = Number(els.volume.value) / 100;

  audio.volume = volume;
  audio.muted = volume === 0;
  if (volume > 0) state.lastVolume = volume;

  saveVolume();
  syncVolumeUI();
}

function toggleMute() {
  const isSilent = audio.muted || audio.volume === 0;

  if (isSilent) {
    audio.muted = false;
    if (audio.volume === 0) audio.volume = state.lastVolume; // estava no zero: volta ao último volume
  } else {
    audio.muted = true;
  }

  saveVolume();
  syncVolumeUI();
}

function syncVolumeUI() {
  const isSilent = audio.muted || audio.volume === 0;

  els.volume.value = isSilent ? 0 : Math.round(audio.volume * 100);
  setSliderFill(els.volume);

  setIcon(els.muteBtn, isSilent ? 'volume-off' : audio.volume < 0.5 ? 'volume-low' : 'volume-high');
  els.muteBtn.setAttribute('aria-label', isSilent ? 'Reativar o som' : 'Silenciar');
  els.muteBtn.title = isSilent ? 'Reativar o som' : 'Silenciar';
}

/* ---------- 7. Eventos e inicialização ---------- */

function bindEvents() {
  // Login e cadastro
  els.showRegister.addEventListener('click', () => switchAuthForm('register'));
  els.showLogin.addEventListener('click', () => switchAuthForm('login'));
  els.loginForm.addEventListener('submit', (event) =>
    submitAuthForm(event, { endpoint: '/api/auth/login', errorEl: els.loginError, busyLabel: 'Entrando...' })
  );
  els.registerForm.addEventListener('submit', (event) =>
    submitAuthForm(event, { endpoint: '/api/auth/register', errorEl: els.registerError, busyLabel: 'Criando conta...' })
  );
  els.logoutBtn.addEventListener('click', logout);

  // Navegação, busca e lista
  document.querySelectorAll('.view-link').forEach((link) => {
    link.addEventListener('click', () => setView(link.dataset.target));
  });

  els.searchInput.addEventListener('input', () => {
    state.query = els.searchInput.value;
    renderTrackList();
  });

  els.listRetryBtn.addEventListener('click', loadLibrary);

  // Um único listener para a lista inteira (as linhas são recriadas a cada filtro).
  els.trackList.addEventListener('click', (event) => {
    const row = event.target.closest('.track');
    if (!row) return;

    const song = findSong(row.dataset.id);
    if (!song) return;

    if (event.target.closest('.like-btn')) toggleLike(song);
    else handleTrackClick(song);
  });

  // A barra do topo ganha fundo sólido quando a página rola.
  els.main.addEventListener(
    'scroll',
    () => els.topbar.classList.toggle('is-scrolled', els.main.scrollTop > 40),
    { passive: true }
  );

  // Controles do player
  els.playBtn.addEventListener('click', togglePlay);
  els.nextBtn.addEventListener('click', () => playNext());
  els.prevBtn.addEventListener('click', playPrevious);
  els.shuffleBtn.addEventListener('click', toggleShuffle);
  els.repeatBtn.addEventListener('click', cycleRepeat);
  els.playerLike.addEventListener('click', () => {
    if (state.currentSong) toggleLike(state.currentSong);
  });
  els.progress.addEventListener('input', handleSeekInput);
  els.progress.addEventListener('change', handleSeekCommit);
  els.volume.addEventListener('input', handleVolumeInput);
  els.muteBtn.addEventListener('click', toggleMute);

  // Eventos do elemento <audio>
  audio.addEventListener('play', syncPlayState);
  audio.addEventListener('pause', syncPlayState);
  audio.addEventListener('ended', () => playNext({ auto: true }));
  audio.addEventListener('error', handleAudioError);
  ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied'].forEach((name) => {
    audio.addEventListener(name, renderProgress);
  });

  // Barra de espaço toca/pausa, exceto quando o foco está em um campo ou botão.
  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || els.appView.hidden) return;
    if (event.target.closest('input, textarea, select, button, a')) return;

    event.preventDefault();
    togglePlay();
  });
}

// Ao abrir a página: se há token salvo, confirma com o servidor e entra direto no app.
async function boot() {
  bindEvents();
  initVolume();
  syncModeButtons();
  resetApp();

  if (!localStorage.getItem(TOKEN_KEY)) {
    showAuthView();
    return;
  }

  try {
    const { user } = await api('/api/auth/me');
    const token = localStorage.getItem(TOKEN_KEY);
    await beginSession({ token, user });
  } catch (error) {
    if (error.status === 401) return; // sessão inválida: o login já está na tela
    showAuthView(error.message); // servidor fora do ar, por exemplo; o token continua salvo
  }
}

boot();
