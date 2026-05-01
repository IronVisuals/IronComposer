/**
 * IronComposer v2.1 — main.js (CONSOLIDADO)
 *
 * Todos os módulos estão aqui: Storage, AudioPreview, Favorites e a lógica principal.
 * Motivo: evitar erros de carregamento de múltiplos arquivos JS.
 *
 * Só precisa de CSInterface.js + este arquivo.
 */

'use strict';

// Compatibilidade com --enable-nodejs sem --mixed-context:
// No CEF moderno (Premiere 2025+), Node.js fica em cep_node.require(), não no global.
function _req(mod) {
  if (typeof cep_node !== 'undefined') return cep_node.require(mod);
  if (typeof require !== 'undefined') return require(mod);
  throw new Error('Node.js indisponível (cep_node e require ausentes)');
}

// =====================================================================
// MÓDULO: STORAGE (persistência em JSON no disco)
// =====================================================================
const Storage = (() => {
  let _fs = null, _path = null, _base = '';

  function init(cs) {
    try {
      _fs   = _req('fs');
      _path = _req('path');
      _base = cs.getSystemPath(SystemPath.USER_DATA);
      console.log('[Storage] base:', _base);
    } catch(e) { console.error('[Storage] init falhou:', e); }
  }

  function _file(ns) { return _path.join(_base, 'ironcomposer_' + ns + '.json'); }

  function get(ns, def) {
    if (!_fs) return def;
    try {
      const p = _file(ns);
      if (!_fs.existsSync(p)) return def;
      return JSON.parse(_fs.readFileSync(p, 'utf8'));
    } catch(e) { return def; }
  }

  function set(ns, data) {
    if (!_fs) return;
    try { _fs.writeFileSync(_file(ns), JSON.stringify(data, null, 2), 'utf8'); }
    catch(e) { console.error('[Storage] set error:', e); }
  }

  return { init, get, set };
})();

// =====================================================================
// MÓDULO: FAVORITES
// =====================================================================
const Favorites = (() => {
  let _set = new Set();

  function init() {
    _set = new Set(Storage.get('favorites', []));
  }
  function isFav(p) { return _set.has(p); }
  function toggle(p) {
    if (_set.has(p)) { _set.delete(p); } else { _set.add(p); }
    Storage.set('favorites', Array.from(_set));
    return _set.has(p);
  }
  function list() {
    const _fs = _req('fs');
    const arr = Array.from(_set).filter(p => { try { return _fs.existsSync(p); } catch(e) { return false; } });
    if (arr.length !== _set.size) { _set = new Set(arr); Storage.set('favorites', arr); }
    return arr;
  }
  return { init, isFav, toggle, list };
})();

// =====================================================================
// MÓDULO: AUDIO PREVIEW (waveform + player)
// =====================================================================
const AudioPreview = (() => {
  let audioEl   = null;
  let audioCtx  = null;
  let container = null, canvas = null, ctx2d = null;
  let loadingEl = null, playheadEl = null, btnPlay = null;
  let timeEl = null, volSlider = null, volIcon = null, nameEl = null;
  let previewPanel = null;
  let isMuted = false, lastVol = 0.8;
  let _fs = null;
  let toastTimeout = null;

  function init() {
    _fs = _req('fs');
    previewPanel = document.getElementById('audio-preview');
    container    = document.getElementById('waveform-container');
    canvas       = document.getElementById('waveform-canvas');
    ctx2d        = canvas.getContext('2d');
    loadingEl    = document.getElementById('waveform-loading');
    playheadEl   = document.getElementById('playhead');
    btnPlay      = document.getElementById('btn-play');
    timeEl       = document.getElementById('preview-time');
    volSlider    = document.getElementById('volume-slider');
    volIcon      = document.getElementById('volume-icon');
    nameEl       = document.getElementById('preview-name');

    audioEl = new Audio();
    audioEl.preload = 'auto';

    audioEl.addEventListener('play',  () => { btnPlay.textContent = '⏸'; });
    audioEl.addEventListener('pause', () => { btnPlay.textContent = '▶'; });
    audioEl.addEventListener('ended', () => { btnPlay.textContent = '▶'; });
    audioEl.addEventListener('timeupdate', _updateHead);

    btnPlay.addEventListener('click', togglePlay);

    volSlider.addEventListener('input', e => {
      lastVol = e.target.value / 100;
      audioEl.volume = isMuted ? 0 : lastVol;
      volIcon.textContent = lastVol === 0 ? '🔇' : (lastVol < 0.5 ? '🔉' : '🔊');
    });

    volIcon.addEventListener('click', () => {
      isMuted = !isMuted;
      audioEl.volume = isMuted ? 0 : lastVol;
      volIcon.textContent = isMuted ? '🔇' : (lastVol < 0.5 ? '🔉' : '🔊');
    });

    container.addEventListener('click', e => {
      if (!audioEl.duration) return;
      const r = container.getBoundingClientRect();
      audioEl.currentTime = audioEl.duration * ((e.clientX - r.left) / r.width);
    });
  }

  function _pathToUrl(p) {
    return 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
  }

  async function load(filePath) {
    previewPanel.classList.remove('hidden');
    nameEl.textContent = filePath.split(/[\\/]/).pop();
    loadingEl.style.display = 'flex';
    loadingEl.textContent = 'Carregando...';
    playheadEl.style.display = 'none';

    audioEl.pause();
    audioEl.currentTime = 0;
    audioEl.src = _pathToUrl(filePath);
    audioEl.volume = isMuted ? 0 : lastVol;

    try {
      await _drawWaveform(filePath);
      loadingEl.style.display = 'none';
      await audioEl.play().catch(e => console.warn('[Preview] autoplay bloqueado:', e));
    } catch(e) {
      console.error('[Preview] waveform falhou:', e);
      loadingEl.textContent = 'Não foi possível gerar a waveform.';
    }
  }

  async function _drawWaveform(filePath) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const nodeBuffer = _fs.readFileSync(filePath);
    const ab = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
    const decoded = await audioCtx.decodeAudioData(ab);
    const data = decoded.getChannelData(0);

    const dpr = window.devicePixelRatio || 1;
    const W = container.clientWidth  || 300;
    const H = container.clientHeight || 60;
    canvas.width  = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx2d.scale(dpr, dpr);

    const spp = Math.floor(data.length / W);
    ctx2d.clearRect(0, 0, W, H);
    ctx2d.fillStyle = '#2b2b2b';
    ctx2d.fillRect(0, 0, W, H);
    const mid = H / 2;
    for (let x = 0; x < W; x++) {
      let max = 0;
      for (let i = x * spp; i < x * spp + spp; i++) { const a = Math.abs(data[i]); if (a > max) max = a; }
      ctx2d.fillStyle = '#4fa3f7';
      const bh = Math.max(1, max * H * 0.9);
      ctx2d.fillRect(x, mid - bh / 2, 1, bh);
    }
  }

  function _updateHead() {
    if (!audioEl.duration) return;
    const r = audioEl.currentTime / audioEl.duration;
    playheadEl.style.left = (container.clientWidth * r) + 'px';
    playheadEl.style.display = 'block';
    const fmt = s => { const m = Math.floor(s/60); const ss = Math.floor(s%60); return m+':'+(ss<10?'0':'')+ss; };
    timeEl.textContent = fmt(audioEl.currentTime) + ' / ' + fmt(audioEl.duration||0);
  }

  function togglePlay() {
    if (!audioEl.src) return;
    audioEl.paused ? audioEl.play() : audioEl.pause();
  }

  function hide() {
    audioEl.pause(); audioEl.src = '';
    previewPanel.classList.add('hidden');
  }

  function stop() { audioEl.pause(); audioEl.currentTime = 0; }

  return { init, load, hide, stop, togglePlay };
})();

// =====================================================================
// LÓGICA PRINCIPAL
// =====================================================================

const isCEP = typeof window.__adobe_cep__ !== 'undefined';
let csInterface = null, fs = null, pathM = null;

// Dados em memória
let myFolders = [];
let expandedFolders = new Set();
let currentFiles = [];
let selectedFilePath = null;
let currentTab = 'browse';

// Extensões por tipo
const EXT_VIDEO = new Set(['.mp4','.mov','.avi','.mkv','.mxf','.r3d','.webm','.m4v']);
const EXT_AUDIO = new Set(['.wav','.mp3','.aac','.aif','.aiff','.flac','.ogg','.m4a']);
const EXT_IMAGE = new Set(['.jpg','.jpeg','.png','.tiff','.tif','.psd','.ai','.gif']);
const EXT_MOGRT = new Set(['.mogrt']);
const EXT_ALL   = new Set([...EXT_VIDEO,...EXT_AUDIO,...EXT_IMAGE,...EXT_MOGRT]);

// DOM refs
const byId = id => document.getElementById(id);

// =====================================================================
// INICIALIZAÇÃO
// =====================================================================
window.addEventListener('DOMContentLoaded', () => {
  console.log('[IronComposer] DOMContentLoaded, isCEP:', isCEP);

  if (!isCEP) {
    _setStatus('Rodando fora do Premiere (modo dev/browser).');
    return;
  }

  try {
    csInterface = new CSInterface();
    fs   = _req('fs');
    pathM = _req('path');
  } catch(e) {
    _showError('Falha ao inicializar dependências: ' + e.message);
    return;
  }

  try { Storage.init(csInterface); } catch(e) { console.warn('[IronComposer] Storage init:', e); }
  try { Favorites.init(); }         catch(e) { console.warn('[IronComposer] Favorites init:', e); }
  try { AudioPreview.init(); }      catch(e) { console.warn('[IronComposer] AudioPreview init:', e); }

  // Carrega dados salvos
  myFolders       = Storage.get('folders', []);
  expandedFolders = new Set(Storage.get('expandedFolders', []));

  // Aplica tema do Premiere
  try {
    const skin = csInterface.hostEnvironment.appSkinInfo;
    if (skin && skin.panelBackgroundColor) {
      const c = skin.panelBackgroundColor.color;
      document.body.style.backgroundColor = `rgb(${Math.round(c.red)},${Math.round(c.green)},${Math.round(c.blue)})`;
    }
  } catch(e) {}

  _setupEvents();
  _renderSidebar();
  _setStatus('Pronto. ' + myFolders.length + ' pasta(s) carregada(s).');
  console.log('[IronComposer] Inicializado com sucesso!');
});

// =====================================================================
// SETUP DE EVENTOS
// =====================================================================
function _setupEvents() {
  byId('btn-add-folder').addEventListener('click', _addFolderDialog);
  byId('btn-insert').addEventListener('click', _insertTimeline);

  const si = byId('search-input');
  si.addEventListener('input', _handleSearch);
  byId('search-clear').addEventListener('click', () => {
    si.value = '';
    byId('search-clear').classList.remove('visible');
    if (currentTab === 'favorites') _renderFavoritesList();
    else byId('file-list').innerHTML = '<p class="placeholder-text">Selecione uma pasta na barra lateral.</p>';
  });

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => _switchTab(t.dataset.tab));
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && si.value) { si.value = ''; _handleSearch(); }
    if (e.key === ' ' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); AudioPreview.togglePlay(); }
  });
}

// =====================================================================
// SELETOR DE PASTA (Explorer moderno)
// =====================================================================
function _addFolderDialog() {
  if (!isCEP) return;

  let result;

  // Tenta o seletor moderno primeiro
  try {
    result = window.cep.fs.showOpenDialogEx(false, true, 'Selecionar pasta de mídias', '', [], 'Selecionar', true);
  } catch(e) {
    console.warn('[IronComposer] showOpenDialogEx indisponível, usando fallback');
    try { result = window.cep.fs.showOpenDialog(false, true, 'Selecionar pasta de mídias'); }
    catch(e2) { _showToast('Não foi possível abrir o seletor de pasta.', 'error'); return; }
  }

  if (!result || result.err !== 0 || !result.data || !result.data.length) return;
  _addFolder(result.data[0]);
}

function _addFolder(p) {
  if (!fs.existsSync(p)) { _showToast('Caminho não existe: ' + p, 'error'); return; }
  if (myFolders.includes(p)) { _showToast('Pasta já adicionada.', 'error'); return; }
  myFolders.push(p);
  Storage.set('folders', myFolders);
  _renderSidebar();
  _showToast('✅ Pasta adicionada: ' + pathM.basename(p), 'success');
}

function _removeFolder(p) {
  const idx = myFolders.indexOf(p);
  if (idx < 0) return;
  myFolders.splice(idx, 1);
  Storage.set('folders', myFolders);
  expandedFolders = new Set([...expandedFolders].filter(x => !x.startsWith(p)));
  Storage.set('expandedFolders', [...expandedFolders]);
  _renderSidebar();
  byId('file-list').innerHTML = '<p class="placeholder-text">Selecione uma pasta na barra lateral.</p>';
  _showToast('Pasta removida.', 'success');
}

// =====================================================================
// LEITURA DE ARQUIVOS E PASTAS
// =====================================================================
function _getSubfolders(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, fullPath: pathM.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch(e) { return []; }
}

function _getFilesInDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && EXT_ALL.has(pathM.extname(e.name).toLowerCase()))
      .map(e => _makeEntry(dir, e.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch(e) { return []; }
}

function _getFilesRecursive(dir, depth = 0) {
  if (depth > 8) return [];
  let out = [];
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const fp = pathM.join(dir, e.name);
      if (e.isDirectory()) out = out.concat(_getFilesRecursive(fp, depth + 1));
      else if (e.isFile() && EXT_ALL.has(pathM.extname(e.name).toLowerCase())) out.push(_makeEntry(dir, e.name));
    }
  } catch(e) {}
  return out;
}

function _makeEntry(dir, name) {
  const fp  = pathM.join(dir, name);
  const ext = pathM.extname(name).toLowerCase();
  let sz = 0; try { sz = fs.statSync(fp).size; } catch(e) {}
  return { name, fullPath: fp, ext, size: sz, dir };
}

// =====================================================================
// RENDER DA SIDEBAR
// =====================================================================
function _renderSidebar() {
  const tree = byId('folder-tree');
  tree.innerHTML = '';

  if (currentTab === 'favorites') {
    tree.innerHTML = '<p class="placeholder-text" style="font-size:10px;">Os favoritos aparecem à direita →</p>';
    return;
  }

  if (!myFolders.length) {
    tree.innerHTML = '<p class="placeholder-text">Clique em <strong>+ Add Folder</strong> para começar.</p>';
    return;
  }

  myFolders.forEach(fp => tree.appendChild(_makeFolderNode(fp, pathM.basename(fp), true)));
}

function _makeFolderNode(fp, name, isMain) {
  const wrap = document.createElement('div');
  wrap.className = 'folder-group';

  const item = document.createElement('div');
  item.className = 'folder-item' + (isMain ? ' main-folder' : '');
  item.dataset.path = fp;

  const subs = _getSubfolders(fp);
  const expanded = expandedFolders.has(fp);

  item.innerHTML =
    `<span class="folder-arrow${subs.length ? (expanded ? ' expanded' : '') : ''}">${subs.length ? '▶' : ''}</span>` +
    `<span class="folder-icon">📁</span>` +
    `<span class="folder-name" title="${_esc(fp)}">${_esc(name)}</span>`;

  if (isMain) {
    const rm = document.createElement('button');
    rm.className = 'folder-remove';
    rm.title = 'Remover pasta';
    rm.innerHTML = '✕';
    rm.addEventListener('click', e => {
      e.stopPropagation();
      if (confirm('Remover "' + name + '" do IronComposer?\n(não apaga nada do disco)')) _removeFolder(fp);
    });
    item.appendChild(rm);
  }

  item.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
    if (subs.length) _toggleExpand(fp);
    _loadFiles(fp, isMain);
  });

  wrap.appendChild(item);

  if (subs.length) {
    const ch = document.createElement('div');
    ch.className = 'folder-children' + (expanded ? ' expanded' : '');
    subs.forEach(s => ch.appendChild(_makeFolderNode(s.fullPath, s.name, false)));
    wrap.appendChild(ch);
  }

  return wrap;
}

function _toggleExpand(fp) {
  if (expandedFolders.has(fp)) expandedFolders.delete(fp);
  else expandedFolders.add(fp);
  Storage.set('expandedFolders', [...expandedFolders]);

  document.querySelectorAll(`.folder-item[data-path]`).forEach(el => {
    if (el.dataset.path !== fp) return;
    const arrow = el.querySelector('.folder-arrow');
    const children = el.parentElement.querySelector(':scope > .folder-children');
    if (expandedFolders.has(fp)) {
      arrow?.classList.add('expanded');
      children?.classList.add('expanded');
    } else {
      arrow?.classList.remove('expanded');
      children?.classList.remove('expanded');
    }
  });
}

// =====================================================================
// CARREGAMENTO E RENDER DE ARQUIVOS
// =====================================================================
function _loadFiles(dir, recursive) {
  const fl = byId('file-list');
  fl.innerHTML = '<p class="placeholder-text">Lendo arquivos...</p>';

  setTimeout(() => {
    const files = recursive ? _getFilesRecursive(dir) : _getFilesInDir(dir);
    currentFiles = files;
    _renderFileList(files);
    _setStatus(files.length + ' arquivo(s) em "' + pathM.basename(dir) + '".');
  }, 10);
}

function _renderFileList(files) {
  const fl = byId('file-list');
  fl.innerHTML = '';
  if (!files || !files.length) {
    fl.innerHTML = '<p class="placeholder-text">Nenhum arquivo compatível encontrado.</p>';
    return;
  }
  files.forEach(f => fl.appendChild(_makeFileItem(f)));
}

function _makeFileItem(file) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.dataset.path = file.fullPath;

  const isFav = Favorites.isFav(file.fullPath);
  const star = document.createElement('span');
  star.className = 'file-favorite' + (isFav ? ' active' : '');
  star.textContent = isFav ? '★' : '☆';
  star.title = isFav ? 'Remover dos favoritos' : 'Favoritar';
  star.addEventListener('click', e => {
    e.stopPropagation();
    const now = Favorites.toggle(file.fullPath);
    star.classList.toggle('active', now);
    star.textContent = now ? '★' : '☆';
    _showToast(now ? '★ Adicionado aos favoritos' : '☆ Removido dos favoritos');
    if (currentTab === 'favorites') _renderFavoritesList();
  });

  const { icon, cls } = _typeInfo(file.ext);
  const iconEl = document.createElement('div');
  iconEl.className = 'file-icon ' + cls;
  iconEl.textContent = icon;

  const info = document.createElement('div');
  info.className = 'file-info';
  info.innerHTML =
    `<div class="file-name" title="${_esc(file.fullPath)}">${_esc(file.name)}</div>` +
    `<div class="file-meta">${file.ext.toUpperCase().slice(1)} · ${_fmtBytes(file.size)}</div>`;

  item.append(star, iconEl, info);
  item.addEventListener('click', () => _selectFile(item, file));
  item.addEventListener('dblclick', () => { _selectFile(item, file); _insertTimeline(); });
  return item;
}

function _selectFile(el, file) {
  document.querySelectorAll('.file-item').forEach(x => x.classList.remove('selected'));
  el.classList.add('selected');
  selectedFilePath = file.fullPath;
  byId('btn-insert').disabled = false;
  _setStatus('Selecionado: ' + file.name);
  if (EXT_AUDIO.has(file.ext)) AudioPreview.load(file.fullPath);
  else AudioPreview.hide();
}

// =====================================================================
// TABS
// =====================================================================
function _switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  _renderSidebar();
  if (tab === 'favorites') _renderFavoritesList();
  else byId('file-list').innerHTML = '<p class="placeholder-text">Selecione uma pasta na barra lateral.</p>';
}

function _renderFavoritesList() {
  const favs = Favorites.list();
  if (!favs.length) {
    byId('file-list').innerHTML = '<p class="placeholder-text">Nenhum favorito.<br>Clique na ☆ para favoritar.</p>';
    _setStatus('0 favoritos.');
    return;
  }
  currentFiles = favs.map(p => { const dir = pathM.dirname(p); return _makeEntry(dir, pathM.basename(p)); });
  _renderFileList(currentFiles);
  _setStatus(favs.length + ' favorito(s).');
}

// =====================================================================
// BUSCA
// =====================================================================
function _handleSearch() {
  const q = byId('search-input').value.toLowerCase().trim();
  byId('search-clear').classList.toggle('visible', q.length > 0);

  if (!q || q.length < 2) {
    if (currentTab === 'favorites') _renderFavoritesList();
    else byId('file-list').innerHTML = '<p class="placeholder-text">Selecione uma pasta na barra lateral.</p>';
    return;
  }

  const seen = new Set();
  let res = [];
  myFolders.forEach(f => {
    _getFilesRecursive(f).filter(x => x.name.toLowerCase().includes(q)).forEach(x => {
      if (!seen.has(x.fullPath)) { seen.add(x.fullPath); res.push(x); }
    });
  });
  currentFiles = res;
  _renderFileList(res);
  _setStatus(res.length + ' resultado(s) para "' + q + '".');
}

// =====================================================================
// INSERÇÃO NA TIMELINE
// =====================================================================
function _insertTimeline() {
  if (!selectedFilePath || !isCEP) return;
  AudioPreview.stop();

  const safe = selectedFilePath.replace(/\\/g, '/').replace(/"/g, '\\"');
  _setStatus('⏳ Enviando para o Premiere...');
  byId('btn-insert').disabled = true;

  csInterface.evalScript('importAndInsert("' + safe + '")', result => {
    byId('btn-insert').disabled = false;

    if (!result || result === 'EvalScript error.') {
      _setStatus('❌ Falha na comunicação com o Premiere.');
      _showToast('EvalScript error — verifique host.jsx', 'error');
      return;
    }

    let resp;
    try { resp = JSON.parse(result); } catch(e) {
      _setStatus('Resposta: ' + result);
      _showToast(result, result.includes('Erro') ? 'error' : 'success');
      return;
    }

    if (resp.success) {
      const t = (resp.trackType === 'audio' ? 'A' : 'V') + (resp.trackIndex + 1);
      _setStatus('✅ Inserido na trilha ' + t);
      _showToast('✅ Inserido na trilha ' + t, 'success');
    } else {
      _setStatus('❌ ' + resp.error);
      _showToast(resp.error, 'error');
    }
  });
}

// =====================================================================
// HELPERS
// =====================================================================
function _typeInfo(ext) {
  if (EXT_VIDEO.has(ext)) return { icon: '🎬', cls: 'icon-video' };
  if (EXT_AUDIO.has(ext)) return { icon: '🎵', cls: 'icon-audio' };
  if (EXT_MOGRT.has(ext)) return { icon: '✦',  cls: 'icon-mogrt' };
  if (EXT_IMAGE.has(ext)) return { icon: '🖼', cls: 'icon-image'  };
  return { icon: '📄', cls: '' };
}

function _fmtBytes(b) {
  if (!b) return '—';
  const k = 1024, s = ['B','KB','MB','GB'], i = Math.floor(Math.log(b)/Math.log(k));
  return parseFloat((b/Math.pow(k,i)).toFixed(1)) + ' ' + s[i];
}

function _setStatus(msg) {
  const el = byId('status-text');
  if (el) el.textContent = msg;
  console.log('[IronComposer]', msg);
}

let _toastTm = null;
function _showToast(msg, type = '') {
  const t = byId('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = type;
  void t.offsetWidth;
  t.classList.add('show');
  if (type) t.classList.add(type);
  clearTimeout(_toastTm);
  _toastTm = setTimeout(() => t.classList.remove('show'), 2500);
}

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _showError(msg) {
  console.error('[IronComposer FATAL]', msg);
  const app = byId('app'); if (app) app.style.display = 'none';
  const err = byId('error-screen'); if (err) err.style.display = 'block';
  const errMsg = byId('error-msg'); if (errMsg) errMsg.textContent = msg;
}
