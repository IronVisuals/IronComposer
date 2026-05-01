/**
 * main.js — IronComposer v2.1
 * Corrige Add Folder, carregamento do host.jsx, busca recursiva, preview e inserção segura.
 */

'use strict';

const isCEP = typeof window.__adobe_cep__ !== 'undefined';
let csInterface = null;
let fs = null;
let pathModule = null;

let hostLoaded = false;
let myFolders = [];
let currentFiles = [];
let selectedFilePath = null;
let selectedFile = null;
let currentTab = 'browse';
let expandedFolders = new Set();
let currentFolderPath = null;
let currentFolderRecursive = false;

const EXT_VIDEO  = new Set(['.mp4', '.mov', '.avi', '.mkv', '.mxf', '.r3d', '.webm', '.m4v', '.mpg', '.mpeg', '.mts', '.m2ts']);
const EXT_AUDIO  = new Set(['.wav', '.mp3', '.aac', '.aif', '.aiff', '.flac', '.ogg', '.m4a', '.wma']);
const EXT_IMAGE  = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.psd', '.ai', '.gif', '.bmp', '.webp', '.heic']);
const EXT_MOGRT  = new Set(['.mogrt']);
const SUPPORTED  = new Set([...EXT_VIDEO, ...EXT_AUDIO, ...EXT_IMAGE, ...EXT_MOGRT]);

const $ = (id) => document.getElementById(id);
const folderTree   = $('folder-tree');
const fileList     = $('file-list');
const statusText   = $('status-text');
const btnInsert    = $('btn-insert');
const btnAddFolder = $('btn-add-folder');
const searchInput  = $('search-input');
const searchClear  = $('search-clear');
const toast        = $('toast');
const mediaPreview = $('media-preview');
const mediaPreviewIcon = $('media-preview-icon');
const mediaPreviewName = $('media-preview-name');
const mediaPreviewBody = $('media-preview-body');
const mediaPreviewMeta = $('media-preview-meta');

function getNodeRequire() {
  if (typeof require === 'function') return require;
  if (window.cep_node && typeof window.cep_node.require === 'function') return window.cep_node.require;
  throw new Error('Node.js não está habilitado no CEP. Confira --enable-nodejs e --mixed-context no manifest.xml.');
}

function showStartupError(err) {
  const msg = (err && (err.stack || err.message || err.toString())) || String(err);
  console.error('[IronComposer] Erro ao iniciar:', err);
  document.body.innerHTML = `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#1e1e1e;color:#eee;padding:18px;height:100vh;box-sizing:border-box;overflow:auto">
      <h2 style="margin:0 0 10px;color:#f85149">IronComposer não carregou</h2>
      <p style="margin:0 0 12px;color:#ccc">Erro de inicialização do painel:</p>
      <pre style="white-space:pre-wrap;background:#2b2b2b;border:1px solid #444;padding:12px;border-radius:4px;color:#fff">${escapeHtml(msg)}</pre>
      <p style="color:#aaa;font-size:12px;margin-top:12px">Abra o DevTools em http://localhost:7778 para ver o console completo.</p>
    </div>`;
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    if (!isCEP) {
      setupEventListeners();
      setStatus('Painel rodando fora do Premiere (modo dev).');
      return;
    }

    csInterface = new CSInterface();
    fs = getNodeRequire()('fs');
    pathModule = getNodeRequire()('path');

    IronStorage.init(csInterface);
    Favorites.init();
    AudioPreview.init();

    myFolders = sanitizeSavedFolders(IronStorage.get('folders', []));
    expandedFolders = new Set(IronStorage.get('expandedFolders', []));

    try { applyTheme(csInterface.hostEnvironment.appSkinInfo); } catch (e) {}

    setupEventListeners();
    renderSidebar();
    loadHostScript();

    setStatus(`Pronto. ${myFolders.length} pasta(s) carregada(s).`);
  } catch (err) {
    showStartupError(err);
  }
});

function setupEventListeners() {
  btnAddFolder.addEventListener('click', addFolderDialog);
  btnInsert.addEventListener('click', insertIntoTimeline);
  searchInput.addEventListener('input', debounce(handleSearch, 150));
  searchClear.addEventListener('click', clearSearch);

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchInput.value) clearSearch();
    if (e.key === ' ' && document.activeElement && document.activeElement.tagName !== 'INPUT') {
      if (!document.querySelector('#audio-preview.hidden')) {
        e.preventDefault();
        AudioPreview.togglePlay();
      }
    }
  });
}

function loadHostScript() {
  if (!isCEP || !csInterface) return;

  const extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION).replace(/\\/g, '/');
  const hostPath = extensionRoot + '/jsx/host.jsx';
  const script = '$.evalFile(new File("' + escapeForExtendScriptString(hostPath) + '")); ping();';

  csInterface.evalScript(script, (result) => {
    if (!result || result === 'EvalScript error.') {
      hostLoaded = false;
      setStatus('⚠ UI carregada, mas host.jsx não respondeu. Inserção pode falhar.');
      showToast('host.jsx não carregou. Veja o console em localhost:7778.', 'error');
      return;
    }

    try {
      const response = JSON.parse(result);
      hostLoaded = !!response.success;
      if (hostLoaded) setStatus(`Pronto. ${myFolders.length} pasta(s) carregada(s). Host OK.`);
      else setStatus('⚠ host.jsx respondeu, mas com erro.');
    } catch (e) {
      // Se o ping voltar texto puro, ainda consideramos carregado.
      hostLoaded = result.indexOf('IronComposer') !== -1;
      if (!hostLoaded) setStatus('⚠ Resposta inesperada do host.jsx: ' + result);
    }
  });
}

function addFolderDialog() {
  if (!isCEP) {
    showToast('Add Folder só funciona dentro do Premiere/CEP.', 'error');
    return;
  }

  setStatus('Abrindo seletor de pasta...');

  let result = null;
  try {
    // Assinatura CEP: allowMultipleSelection, chooseDirectory, title, initialPath, fileTypes, friendlyFilePrefix, prompt
    // O último parâmetro precisa ser string; a versão anterior passava boolean e podia retornar ERR_INVALID_PARAMS.
    result = window.cep.fs.showOpenDialogEx(
      false,
      true,
      'Selecionar pasta de mídias',
      '',
      [],
      '',
      'Selecionar pasta'
    );
  } catch (e) {
    console.warn('[IronComposer] showOpenDialogEx falhou:', e);
  }

  const selected = extractSelectedPath(result);
  if (selected) {
    addFolder(selected);
    return;
  }

  // Fallback CEP básico. Mantém o painel funcional mesmo se showOpenDialogEx falhar em algum build.
  try {
    result = window.cep.fs.showOpenDialog(false, true, 'Selecionar pasta de mídias', '', []);
  } catch (e2) {
    console.warn('[IronComposer] showOpenDialog falhou:', e2);
  }

  const fallbackSelected = extractSelectedPath(result);
  if (fallbackSelected) {
    addFolder(fallbackSelected);
    return;
  }

  // Último fallback via ExtendScript. Pode ter aparência mais antiga, mas evita deixar o botão quebrado.
  const script = 'selectFolderDialog("Selecionar pasta de mídias")';
  csInterface.evalScript(script, (jsxResult) => {
    if (!jsxResult || jsxResult === 'EvalScript error.' || jsxResult === '__CANCELLED__') {
      setStatus('Seleção de pasta cancelada.');
      return;
    }
    addFolder(jsxResult);
  });
}

function extractSelectedPath(result) {
  if (!result) return '';
  if (typeof result.err !== 'undefined' && Number(result.err) !== 0) {
    console.warn('[IronComposer] Dialog retornou erro:', result.err, result);
    return '';
  }
  if (!result.data) return '';
  if (Array.isArray(result.data)) return result.data[0] || '';
  if (typeof result.data === 'string') return result.data;
  return '';
}

function addFolder(folderPath) {
  if (!folderPath) return;
  folderPath = normalizeFsPath(folderPath);

  try {
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      showToast('Caminho inválido ou não é uma pasta.', 'error');
      setStatus('Caminho inválido.');
      return;
    }
  } catch (e) {
    showToast('Não consegui acessar essa pasta.', 'error');
    setStatus('Falha ao acessar pasta.');
    return;
  }

  if (myFolders.some(p => samePath(p, folderPath))) {
    showToast('Pasta já adicionada.', 'error');
    setStatus('Pasta já adicionada.');
    return;
  }

  myFolders.push(folderPath);
  IronStorage.set('folders', myFolders);
  expandedFolders.add(folderPath);
  IronStorage.set('expandedFolders', [...expandedFolders]);
  renderSidebar();
  loadFiles(folderPath, true);
  showToast(`Pasta adicionada: ${pathModule.basename(folderPath)}`, 'success');
}

function removeFolder(folderPath) {
  myFolders = myFolders.filter(p => !samePath(p, folderPath));
  IronStorage.set('folders', myFolders);
  expandedFolders = new Set([...expandedFolders].filter(p => !isPathInsideOrSame(p, folderPath)));
  IronStorage.set('expandedFolders', [...expandedFolders]);
  if (currentFolderPath && isPathInsideOrSame(currentFolderPath, folderPath)) {
    currentFolderPath = null;
    currentFiles = [];
    selectedFilePath = null;
    selectedFile = null;
    btnInsert.disabled = true;
    hideAllPreviews();
    fileList.innerHTML = '<p class="placeholder-text">Selecione uma pasta na barra lateral.</p>';
  }
  renderSidebar();
  showToast('Pasta removida do IronComposer. Nada foi apagado do disco.', 'success');
}

function getSubfolders(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !shouldSkipName(e.name))
      .map(e => ({ name: e.name, fullPath: pathModule.join(dirPath, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  } catch (e) {
    console.warn('[IronComposer] Erro ao ler subpastas:', dirPath, e);
    return [];
  }
}

function getFilesInFolder(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && SUPPORTED.has(pathModule.extname(e.name).toLowerCase()))
      .map(e => fileEntryFromPath(pathModule.join(dirPath, e.name)))
      .sort(sortFilesNatural);
  } catch (e) {
    console.warn('[IronComposer] Erro ao ler arquivos:', dirPath, e);
    return [];
  }
}

function getFilesRecursive(dirPath, depth = 0, maxDepth = 12, accumulator = []) {
  if (depth > maxDepth) return accumulator;

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    console.warn('[IronComposer] Erro recursivo em:', dirPath, e);
    return accumulator;
  }

  for (const entry of entries) {
    if (shouldSkipName(entry.name)) continue;
    const fullPath = pathModule.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        getFilesRecursive(fullPath, depth + 1, maxDepth, accumulator);
      } else if (entry.isFile()) {
        const ext = pathModule.extname(entry.name).toLowerCase();
        if (SUPPORTED.has(ext)) accumulator.push(fileEntryFromPath(fullPath));
      }
    } catch (e) {
      console.warn('[IronComposer] Ignorando item inacessível:', fullPath, e);
    }
  }

  if (depth === 0) accumulator.sort(sortFilesNatural);
  return accumulator;
}

function fileEntryFromPath(fullPath) {
  const name = pathModule.basename(fullPath);
  const dir = pathModule.dirname(fullPath);
  const ext = pathModule.extname(name).toLowerCase();
  let size = 0;
  let modified = 0;
  try {
    const stat = fs.statSync(fullPath);
    size = stat.size || 0;
    modified = stat.mtime ? stat.mtime.getTime() : 0;
  } catch (e) {}
  return { name, fullPath, ext, size, dir, modified };
}

function renderSidebar() {
  folderTree.innerHTML = '';

  if (currentTab === 'favorites') {
    folderTree.innerHTML = '<p class="placeholder-text">Os arquivos favoritados aparecem na lista à direita →</p>';
    return;
  }

  if (myFolders.length === 0) {
    folderTree.innerHTML = '<p class="placeholder-text">Clique em <strong>+ Add Folder</strong><br>para começar.</p>';
    return;
  }

  myFolders.forEach(folderPath => {
    const folderName = pathModule.basename(folderPath) || folderPath;
    folderTree.appendChild(createFolderNode(folderPath, folderName, true, 0));
  });
}

function createFolderNode(folderPath, folderName, isMain, depth) {
  const wrapper = document.createElement('div');
  wrapper.className = 'folder-group';

  const item = document.createElement('div');
  item.className = 'folder-item' + (isMain ? ' main-folder' : '');
  item.dataset.path = folderPath;
  item.title = folderPath;

  const isExpanded = expandedFolders.has(folderPath);
  const subfolders = getSubfolders(folderPath);
  const hasChildren = subfolders.length > 0;

  const arrow = document.createElement('span');
  arrow.className = 'folder-arrow' + (isExpanded ? ' expanded' : '');
  arrow.textContent = hasChildren ? '▶' : '';

  const icon = document.createElement('span');
  icon.className = 'folder-icon icon-folder';
  icon.textContent = '📁';

  const name = document.createElement('span');
  name.className = 'folder-name';
  name.textContent = folderName;

  item.appendChild(arrow);
  item.appendChild(icon);
  item.appendChild(name);

  if (isMain) {
    const remove = document.createElement('button');
    remove.className = 'folder-remove';
    remove.innerHTML = '✕';
    remove.title = 'Remover esta pasta do IronComposer';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Remover "${folderName}" do IronComposer?\nIsso não apaga nada do disco.`)) removeFolder(folderPath);
    });
    item.appendChild(remove);
  }

  item.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');

    if (hasChildren) toggleFolderExpansion(folderPath);
    loadFiles(folderPath, isMain);
  });

  wrapper.appendChild(item);

  if (hasChildren) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'folder-children' + (isExpanded ? ' expanded' : '');
    subfolders.forEach(sub => childrenContainer.appendChild(createFolderNode(sub.fullPath, sub.name, false, depth + 1)));
    wrapper.appendChild(childrenContainer);
  }

  return wrapper;
}

function toggleFolderExpansion(folderPath) {
  if (expandedFolders.has(folderPath)) expandedFolders.delete(folderPath);
  else expandedFolders.add(folderPath);
  IronStorage.set('expandedFolders', [...expandedFolders]);

  document.querySelectorAll('.folder-item').forEach(item => {
    if (item.dataset.path !== folderPath) return;
    const arrow = item.querySelector('.folder-arrow');
    const wrapper = item.parentElement;
    const children = wrapper ? wrapper.querySelector(':scope > .folder-children') : null;
    const expanded = expandedFolders.has(folderPath);
    if (arrow) arrow.classList.toggle('expanded', expanded);
    if (children) children.classList.toggle('expanded', expanded);
  });
}

function loadFiles(folderPath, recursive = false) {
  currentFolderPath = folderPath;
  currentFolderRecursive = recursive;
  selectedFilePath = null;
  selectedFile = null;
  btnInsert.disabled = true;
  hideAllPreviews();
  fileList.innerHTML = '<p class="placeholder-text">Lendo arquivos...</p>';

  setTimeout(() => {
    const files = recursive ? getFilesRecursive(folderPath) : getFilesInFolder(folderPath);
    currentFiles = files;
    renderFileList(files);
    setStatus(`${files.length} arquivo(s) em "${pathModule.basename(folderPath)}".`);
  }, 10);
}

function renderFileList(files) {
  fileList.innerHTML = '';

  if (!files || files.length === 0) {
    fileList.innerHTML = '<p class="placeholder-text">Nenhum arquivo compatível encontrado.</p>';
    return;
  }

  files.forEach(file => fileList.appendChild(createFileListItem(file)));
}

function createFileListItem(file) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.dataset.path = file.fullPath;
  item.title = file.fullPath;

  const star = document.createElement('span');
  const isFav = Favorites.isFavorite(file.fullPath);
  star.className = 'file-favorite' + (isFav ? ' active' : '');
  star.textContent = isFav ? '★' : '☆';
  star.title = isFav ? 'Remover dos favoritos' : 'Marcar como favorito';
  star.addEventListener('click', (e) => {
    e.stopPropagation();
    const nowFav = Favorites.toggle(file.fullPath);
    star.classList.toggle('active', nowFav);
    star.textContent = nowFav ? '★' : '☆';
    showToast(nowFav ? '★ Adicionado aos favoritos' : '☆ Removido dos favoritos');
    if (currentTab === 'favorites') renderFavoritesList();
  });

  const typeInfo = getFileTypeInfo(file.ext);
  const icon = document.createElement('div');
  icon.className = `file-icon ${typeInfo.cls}`;
  icon.textContent = typeInfo.icon;

  const info = document.createElement('div');
  info.className = 'file-info';
  const relativeDir = getRelativeLibraryPath(file.fullPath);
  info.innerHTML = `
    <div class="file-name" title="${escapeHtml(file.fullPath)}">${escapeHtml(file.name)}</div>
    <div class="file-meta">${file.ext.toUpperCase().slice(1)} · ${formatBytes(file.size)}${relativeDir ? ' · ' + escapeHtml(relativeDir) : ''}</div>
  `;

  item.appendChild(star);
  item.appendChild(icon);
  item.appendChild(info);

  item.addEventListener('click', () => selectFile(item, file));
  item.addEventListener('dblclick', () => {
    selectFile(item, file);
    insertIntoTimeline();
  });

  return item;
}

function selectFile(itemEl, file) {
  document.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
  itemEl.classList.add('selected');
  selectedFilePath = file.fullPath;
  selectedFile = file;
  btnInsert.disabled = false;
  setStatus(`Selecionado: ${file.name}`);

  if (EXT_AUDIO.has(file.ext)) {
    hideMediaPreview();
    AudioPreview.load(file.fullPath);
  } else {
    AudioPreview.hide();
    showMediaPreview(file);
  }
}

function showMediaPreview(file) {
  const typeInfo = getFileTypeInfo(file.ext);
  mediaPreview.classList.remove('hidden');
  mediaPreviewIcon.textContent = typeInfo.icon;
  mediaPreviewName.textContent = file.name;
  mediaPreviewMeta.textContent = `${file.ext.toUpperCase().slice(1)} · ${formatBytes(file.size)} · ${file.dir}`;
  mediaPreviewBody.innerHTML = '';

  if (EXT_IMAGE.has(file.ext)) {
    const img = document.createElement('img');
    img.className = 'media-preview-image';
    img.src = AudioPreview.filePathToUrl(file.fullPath);
    img.alt = file.name;
    mediaPreviewBody.appendChild(img);
    return;
  }

  if (EXT_VIDEO.has(file.ext)) {
    const video = document.createElement('video');
    video.className = 'media-preview-video';
    video.src = AudioPreview.filePathToUrl(file.fullPath);
    video.controls = true;
    video.muted = true;
    video.preload = 'metadata';
    video.title = 'Preview de vídeo: não toca automaticamente.';
    mediaPreviewBody.appendChild(video);
    return;
  }

  if (EXT_MOGRT.has(file.ext)) {
    const box = document.createElement('div');
    box.className = 'media-preview-placeholder mogrt';
    box.innerHTML = '<div class="preview-big-icon">✦</div><div>MOGRT selecionado</div><small>Duplo clique ou Inserir na Timeline</small>';
    mediaPreviewBody.appendChild(box);
    return;
  }

  const box = document.createElement('div');
  box.className = 'media-preview-placeholder';
  box.textContent = 'Preview indisponível para este tipo.';
  mediaPreviewBody.appendChild(box);
}

function hideMediaPreview() {
  if (mediaPreview) mediaPreview.classList.add('hidden');
  if (mediaPreviewBody) mediaPreviewBody.innerHTML = '';
}

function hideAllPreviews() {
  AudioPreview.hide();
  hideMediaPreview();
}

function switchTab(tabName) {
  currentTab = tabName;
  selectedFilePath = null;
  selectedFile = null;
  btnInsert.disabled = true;
  hideAllPreviews();
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));

  if (tabName === 'favorites') {
    renderSidebar();
    renderFavoritesList();
  } else {
    renderSidebar();
    if (currentFolderPath) loadFiles(currentFolderPath, currentFolderRecursive);
    else fileList.innerHTML = '<p class="placeholder-text">Selecione uma pasta na barra lateral.</p>';
  }
}

function renderFavoritesList() {
  const favPaths = Favorites.list(true);
  const files = favPaths
    .filter(p => {
      try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch (e) { return false; }
    })
    .map(p => fileEntryFromPath(p))
    .sort(sortFilesNatural);

  currentFiles = files;

  if (files.length === 0) {
    fileList.innerHTML = '<p class="placeholder-text">Nenhum favorito ainda.<br>Clique na ☆ ao lado de um arquivo para favoritar.</p>';
    setStatus('0 favoritos.');
    return;
  }

  renderFileList(files);
  setStatus(`${files.length} favorito(s).`);
}

function handleSearch() {
  const query = searchInput.value.toLowerCase().trim();
  searchClear.classList.toggle('visible', query.length > 0);
  selectedFilePath = null;
  selectedFile = null;
  btnInsert.disabled = true;
  hideAllPreviews();

  if (!query) {
    if (currentTab === 'favorites') renderFavoritesList();
    else if (currentFolderPath) loadFiles(currentFolderPath, currentFolderRecursive);
    else fileList.innerHTML = '<p class="placeholder-text">Selecione uma pasta na barra lateral.</p>';
    return;
  }

  if (query.length < 2) {
    fileList.innerHTML = '<p class="placeholder-text">Digite pelo menos 2 caracteres para buscar.</p>';
    return;
  }

  fileList.innerHTML = '<p class="placeholder-text">Buscando...</p>';
  setTimeout(() => {
    let searchPool = [];

    if (currentTab === 'favorites') {
      searchPool = Favorites.list(true).map(p => fileEntryFromPath(p));
    } else {
      myFolders.forEach(folder => {
        searchPool = searchPool.concat(getFilesRecursive(folder));
      });
    }

    const results = uniqueFiles(searchPool)
      .filter(f => {
        const rel = getRelativeLibraryPath(f.fullPath).toLowerCase();
        return f.name.toLowerCase().includes(query) || rel.includes(query) || f.ext.toLowerCase().includes(query);
      })
      .sort(sortFilesNatural);

    currentFiles = results;
    renderFileList(results);
    setStatus(`${results.length} resultado(s) para "${query}".`);
  }, 10);
}

function clearSearch() {
  searchInput.value = '';
  searchClear.classList.remove('visible');
  if (currentTab === 'favorites') renderFavoritesList();
  else if (currentFolderPath) loadFiles(currentFolderPath, currentFolderRecursive);
  else fileList.innerHTML = '<p class="placeholder-text">Selecione uma pasta na barra lateral.</p>';
}

function insertIntoTimeline() {
  if (!selectedFilePath || !isCEP) return;
  if (!hostLoaded) loadHostScript();

  AudioPreview.stop();

  const safePath = selectedFilePath.replace(/\\/g, '/');
  setStatus('⏳ Importando no Projeto e inserindo com segurança...');
  btnInsert.disabled = true;

  const script = 'importAndInsert(' + JSON.stringify(safePath) + ')';

  csInterface.evalScript(script, (result) => {
    btnInsert.disabled = false;

    if (!result || result === 'EvalScript error.') {
      setStatus('❌ Falha de comunicação com o Premiere.');
      showToast('Erro: host.jsx não respondeu. Reabra o painel ou veja o console.', 'error');
      return;
    }

    let response;
    try {
      response = JSON.parse(result);
    } catch (e) {
      setStatus('❌ Resposta inválida do Premiere.');
      showToast('Resposta inesperada do Premiere: ' + result, 'error');
      return;
    }

    if (response.success) {
      const parts = [];
      if (typeof response.videoTrackIndex === 'number' && response.videoTrackIndex >= 0) parts.push('V' + (response.videoTrackIndex + 1));
      if (typeof response.audioTrackIndex === 'number' && response.audioTrackIndex >= 0) parts.push('A' + (response.audioTrackIndex + 1));
      const where = parts.length ? parts.join(' / ') : 'timeline';
      setStatus(`✅ Inserido em ${where}.`);
      showToast(`✅ Inserido em ${where}`, 'success');
    } else {
      setStatus('❌ ' + response.error);
      showToast(response.error || 'Falha ao inserir.', 'error');
    }
  });
}

function getFileTypeInfo(ext) {
  if (EXT_VIDEO.has(ext))  return { icon: '🎬', cls: 'icon-video', label: 'Vídeo' };
  if (EXT_AUDIO.has(ext))  return { icon: '🎵', cls: 'icon-audio', label: 'Áudio' };
  if (EXT_MOGRT.has(ext))  return { icon: '✦',  cls: 'icon-mogrt', label: 'MOGRT' };
  if (EXT_IMAGE.has(ext))  return { icon: '🖼', cls: 'icon-image', label: 'Imagem' };
  return { icon: '📄', cls: '', label: 'Arquivo' };
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function sortFilesNatural(a, b) {
  const typeA = getFileSortRank(a.ext);
  const typeB = getFileSortRank(b.ext);
  if (typeA !== typeB) return typeA - typeB;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function getFileSortRank(ext) {
  if (EXT_AUDIO.has(ext)) return 1;
  if (EXT_VIDEO.has(ext)) return 2;
  if (EXT_MOGRT.has(ext)) return 3;
  if (EXT_IMAGE.has(ext)) return 4;
  return 9;
}

function setStatus(msg) {
  statusText.textContent = msg;
  console.log('[IronComposer]', msg);
}

let toastTimeout = null;
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = type;
  void toast.offsetWidth;
  toast.classList.add('show');
  if (type) toast.classList.add(type);
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 3000);
}

function sanitizeSavedFolders(folders) {
  if (!Array.isArray(folders)) return [];
  const out = [];
  folders.forEach(p => {
    try {
      const normalized = normalizeFsPath(p);
      if (normalized && fs.existsSync(normalized) && fs.statSync(normalized).isDirectory() && !out.some(x => samePath(x, normalized))) {
        out.push(normalized);
      }
    } catch (e) {}
  });
  if (out.length !== folders.length) IronStorage.set('folders', out);
  return out;
}

function normalizeFsPath(p) {
  if (!p) return '';
  let value = String(p).replace(/^file:\/\/\//i, '');
  value = decodeURIComponent(value);
  return pathModule ? pathModule.normalize(value) : value;
}

function normalizeComparePath(p) {
  return normalizeFsPath(p).replace(/\\/g, '/').toLowerCase().replace(/\/$/, '');
}

function samePath(a, b) {
  return normalizeComparePath(a) === normalizeComparePath(b);
}

function isPathInsideOrSame(child, parent) {
  const c = normalizeComparePath(child);
  const p = normalizeComparePath(parent);
  return c === p || c.indexOf(p + '/') === 0;
}

function shouldSkipName(name) {
  if (!name) return true;
  if (name.startsWith('.')) return true;
  const skip = new Set(['$RECYCLE.BIN', 'System Volume Information', 'node_modules', '.git']);
  return skip.has(name);
}

function uniqueFiles(files) {
  const seen = new Set();
  return files.filter(f => {
    const key = normalizeComparePath(f.fullPath);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getRelativeLibraryPath(fullPath) {
  let root = '';
  for (const folder of myFolders) {
    if (isPathInsideOrSame(fullPath, folder)) {
      root = folder;
      break;
    }
  }
  if (!root || !pathModule) return '';
  const rel = pathModule.relative(root, pathModule.dirname(fullPath));
  return rel && rel !== '.' ? rel : '';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeForExtendScriptString(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '').replace(/\n/g, '');
}

function debounce(fn, delay) {
  let timer = null;
  return function() {
    const args = arguments;
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(null, args), delay);
  };
}

function applyTheme(skinInfo) {
  if (!skinInfo || !skinInfo.panelBackgroundColor) return;
  const c = skinInfo.panelBackgroundColor.color;
  document.body.style.backgroundColor = `rgb(${Math.round(c.red)},${Math.round(c.green)},${Math.round(c.blue)})`;
}
