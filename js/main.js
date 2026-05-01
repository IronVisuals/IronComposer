/**
 * main.js — IronComposer v2.0
 *
 * Orquestra todos os módulos: Storage, AudioPreview, Favorites
 * + comunicação com o host.jsx via CSInterface.
 *
 * Funcionalidades:
 *   - Adicionar pastas via Explorer moderno do Windows
 *   - Árvore de pastas com subpastas expansíveis
 *   - Lista de arquivos com favoritos (estrela)
 *   - Busca inteligente em todas as pastas
 *   - Tabs: Browse / Favoritos
 *   - Preview de áudio automático ao selecionar
 *   - Duplo clique = inserir direto na timeline
 *   - Inserção segura em trilha vazia (host.jsx)
 */

'use strict';

// =====================================================
// ESTADO GLOBAL
// =====================================================
const isCEP = typeof window.__adobe_cep__ !== 'undefined';
let csInterface = null;
let fs = null;
let pathModule = null;

let myFolders = [];           // pastas raiz adicionadas pelo usuário
let currentFiles = [];        // arquivos atualmente exibidos
let selectedFilePath = null;  // arquivo atualmente selecionado
let currentTab = 'browse';    // 'browse' ou 'favorites'
let expandedFolders = new Set(); // caminhos das pastas expandidas

// Extensões suportadas
const EXT_VIDEO  = new Set(['.mp4', '.mov', '.avi', '.mkv', '.mxf', '.r3d', '.webm', '.m4v']);
const EXT_AUDIO  = new Set(['.wav', '.mp3', '.aac', '.aif', '.aiff', '.flac', '.ogg', '.m4a']);
const EXT_IMAGE  = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.psd', '.ai', '.gif', '.bmp', '.webp']);
const EXT_MOGRT  = new Set(['.mogrt']);
const SUPPORTED  = new Set([...EXT_VIDEO, ...EXT_AUDIO, ...EXT_IMAGE, ...EXT_MOGRT]);

// =====================================================
// REFERÊNCIAS DOM
// =====================================================
const $ = (id) => document.getElementById(id);
const folderTree   = $('folder-tree');
const fileList     = $('file-list');
const statusText   = $('status-text');
const btnInsert    = $('btn-insert');
const btnAddFolder = $('btn-add-folder');
const searchInput  = $('search-input');
const searchClear  = $('search-clear');
const toast        = $('toast');

// =====================================================
// INICIALIZAÇÃO
// =====================================================
window.addEventListener('DOMContentLoaded', () => {
  if (!isCEP) {
    setStatus('Painel rodando fora do Premiere (modo dev).');
    return;
  }

  csInterface  = new CSInterface();
  fs           = require('fs');
  pathModule   = require('path');

  // Inicializa módulos auxiliares
  Storage.init(csInterface);
  Favorites.init();
  AudioPreview.init();

  // Carrega dados salvos
  myFolders = Storage.get('folders', []);
  expandedFolders = new Set(Storage.get('expandedFolders', []));

  // Aplica tema do Premiere
  applyTheme(csInterface.hostEnvironment.appSkinInfo);

  // Setup de eventos
  setupEventListeners();

  // Render inicial
  renderSidebar();

  setStatus(`Pronto. ${myFolders.length} pasta(s) carregada(s).`);
});

// =====================================================
// EVENT LISTENERS
// =====================================================
function setupEventListeners() {
  btnAddFolder.addEventListener('click', addFolderDialog);
  btnInsert.addEventListener('click', insertIntoTimeline);
  searchInput.addEventListener('input', handleSearch);
  searchClear.addEventListener('click', clearSearch);

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Atalho: Esc fecha modal/limpa busca
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (searchInput.value) clearSearch();
    }
    // Espaço = toggle play do preview (se foco não estiver num input)
    if (e.key === ' ' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      AudioPreview.togglePlay();
    }
  });
}

// =====================================================
// EXPLORER MODERNO PARA SELECIONAR PASTA
// =====================================================
function addFolderDialog() {
  if (!isCEP) return;

  // showOpenDialogEx é a versão moderna que usa o Explorer nativo do Windows
  // (CEP 7+). Argumentos:
  //   1. allowMultipleSelection
  //   2. chooseDirectory (true = só pastas)
  //   3. title
  //   4. initialPath (string vazia = última usada)
  //   5. fileTypes (array - vazio porque é pasta)
  //   6. friendlyFilePrefix
  //   7. prompt label
  let result;
  try {
    result = window.cep.fs.showOpenDialogEx(
      false,
      true,
      'Selecionar pasta de mídias',
      '',
      [],
      'Selecionar',
      true
    );
  } catch (e) {
    // Fallback para o método antigo se showOpenDialogEx falhar
    console.warn('[IronComposer] showOpenDialogEx falhou, usando fallback:', e);
    result = window.cep.fs.showOpenDialog(false, true, 'Selecionar pasta', '');
  }

  if (!result || result.err !== 0) return;
  if (!result.data || result.data.length === 0) return;

  const folderPath = result.data[0];
  addFolder(folderPath);
}

function addFolder(folderPath) {
  if (!fs.existsSync(folderPath)) {
    showToast('Caminho inválido.', 'error');
    return;
  }
  if (myFolders.includes(folderPath)) {
    showToast('Pasta já adicionada.', 'error');
    return;
  }

  myFolders.push(folderPath);
  Storage.set('folders', myFolders);
  renderSidebar();
  showToast(`Pasta adicionada: ${pathModule.basename(folderPath)}`, 'success');
}

function removeFolder(folderPath) {
  const idx = myFolders.indexOf(folderPath);
  if (idx === -1) return;

  myFolders.splice(idx, 1);
  Storage.set('folders', myFolders);

  // Limpa pastas expandidas que estavam dentro
  expandedFolders = new Set(
    [...expandedFolders].filter(p => !p.startsWith(folderPath))
  );
  Storage.set('expandedFolders', [...expandedFolders]);

  renderSidebar();
  fileList.innerHTML = '<p class="placeholder-text">Selecione uma pasta na barra lateral.</p>';
  showToast('Pasta removida.', 'success');
}

// =====================================================
// LEITURA DE PASTAS E ARQUIVOS
// =====================================================

/**
 * Lê subpastas de um diretório (não recursivo, só nível direto)
 */
function getSubfolders(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        fullPath: pathModule.join(dirPath, e.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    console.error('[IronComposer] Erro ao ler subpastas:', dirPath, e);
    return [];
  }
}

/**
 * Lê arquivos diretos de um diretório (não recursivo)
 */
function getFilesInFolder(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && SUPPORTED.has(pathModule.extname(e.name).toLowerCase()))
      .map(e => fileEntryFromName(dirPath, e.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    console.error('[IronComposer] Erro ao ler arquivos:', dirPath, e);
    return [];
  }
}

/**
 * Lê arquivos recursivamente (todas as subpastas)
 */
function getFilesRecursive(dirPath, depth = 0, maxDepth = 8) {
  if (depth > maxDepth) return [];

  let result = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = pathModule.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        result = result.concat(getFilesRecursive(fullPath, depth + 1, maxDepth));
      } else if (entry.isFile()) {
        const ext = pathModule.extname(entry.name).toLowerCase();
        if (SUPPORTED.has(ext)) {
          result.push(fileEntryFromName(dirPath, entry.name));
        }
      }
    }
  } catch (e) {
    console.error('[IronComposer] Erro recursivo em:', dirPath, e);
  }
  return result;
}

function fileEntryFromName(dirPath, fileName) {
  const fullPath = pathModule.join(dirPath, fileName);
  const ext = pathModule.extname(fileName).toLowerCase();
  let size = 0;
  try { size = fs.statSync(fullPath).size; } catch (e) {}
  return { name: fileName, fullPath, ext, size, dir: dirPath };
}

// =====================================================
// RENDER DA SIDEBAR (árvore de pastas)
// =====================================================
function renderSidebar() {
  folderTree.innerHTML = '';

  // Aba Favoritos
  if (currentTab === 'favorites') {
    folderTree.innerHTML = '<p class="placeholder-text">Os arquivos favoritados aparecem na lista à direita →</p>';
    renderFavoritesList();
    return;
  }

  if (myFolders.length === 0) {
    folderTree.innerHTML = '<p class="placeholder-text">Clique em <strong>+ Add Folder</strong> para começar.</p>';
    return;
  }

  myFolders.forEach((folderPath, index) => {
    const folderName = pathModule.basename(folderPath);
    const groupEl = createFolderNode(folderPath, folderName, true, 0);
    folderTree.appendChild(groupEl);
  });
}

/**
 * Cria recursivamente um nó da árvore de pastas.
 * isMain: true se é uma pasta raiz adicionada pelo usuário
 */
function createFolderNode(folderPath, folderName, isMain, depth) {
  const wrapper = document.createElement('div');
  wrapper.className = 'folder-group';

  const item = document.createElement('div');
  item.className = 'folder-item' + (isMain ? ' main-folder' : '');
  item.dataset.path = folderPath;

  const isExpanded = expandedFolders.has(folderPath);
  const subfolders = getSubfolders(folderPath);
  const hasChildren = subfolders.length > 0;

  // Ícone de seta (só se tiver subpastas)
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

  // Botão remover (só nas pastas principais)
  if (isMain) {
    const remove = document.createElement('button');
    remove.className = 'folder-remove';
    remove.innerHTML = '✕';
    remove.title = 'Remover esta pasta';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Remover "${folderName}" do IronComposer?\n(Não apaga nada do disco)`)) {
        removeFolder(folderPath);
      }
    });
    item.appendChild(remove);
  }

  // Click no item: carrega arquivos + expande/colapsa
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');

    // Toggle expansão
    if (hasChildren) {
      toggleFolderExpansion(folderPath);
    }

    // Carrega arquivos da pasta (recursivo se for pasta principal)
    loadFiles(folderPath, isMain);
  });

  wrapper.appendChild(item);

  // Subpastas (renderizadas se expandido)
  if (hasChildren) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'folder-children' + (isExpanded ? ' expanded' : '');

    subfolders.forEach(sub => {
      const childNode = createFolderNode(sub.fullPath, sub.name, false, depth + 1);
      childrenContainer.appendChild(childNode);
    });

    wrapper.appendChild(childrenContainer);
  }

  return wrapper;
}

function toggleFolderExpansion(folderPath) {
  if (expandedFolders.has(folderPath)) {
    expandedFolders.delete(folderPath);
  } else {
    expandedFolders.add(folderPath);
  }
  Storage.set('expandedFolders', [...expandedFolders]);

  // Atualiza visual sem re-renderizar tudo
  const items = document.querySelectorAll(`.folder-item[data-path="${cssEscape(folderPath)}"]`);
  items.forEach(item => {
    const arrow = item.querySelector('.folder-arrow');
    const wrapper = item.parentElement;
    const children = wrapper.querySelector(':scope > .folder-children');
    if (expandedFolders.has(folderPath)) {
      arrow?.classList.add('expanded');
      children?.classList.add('expanded');
    } else {
      arrow?.classList.remove('expanded');
      children?.classList.remove('expanded');
    }
  });
}

// =====================================================
// CARREGAMENTO E RENDER DE ARQUIVOS
// =====================================================

/**
 * Carrega arquivos. Se recursive=true, busca em subpastas também.
 */
function loadFiles(folderPath, recursive = false) {
  fileList.innerHTML = '<p class="placeholder-text">Lendo arquivos...</p>';
  setTimeout(() => {
    const files = recursive ? getFilesRecursive(folderPath) : getFilesInFolder(folderPath);
    currentFiles = files;
    renderFileList(files);
    setStatus(`${files.length} arquivo(s) em "${pathModule.basename(folderPath)}".`);
  }, 10); // pequeno delay para mostrar o "lendo..."
}

function renderFileList(files) {
  fileList.innerHTML = '';

  if (!files || files.length === 0) {
    fileList.innerHTML = '<p class="placeholder-text">Nenhum arquivo compatível encontrado.</p>';
    return;
  }

  files.forEach(file => {
    const item = createFileListItem(file);
    fileList.appendChild(item);
  });
}

function createFileListItem(file) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.dataset.path = file.fullPath;

  // Estrela de favorito
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

  // Ícone do tipo
  const icon = document.createElement('div');
  const typeInfo = getFileTypeInfo(file.ext);
  icon.className = `file-icon ${typeInfo.cls}`;
  icon.textContent = typeInfo.icon;

  // Nome + meta
  const info = document.createElement('div');
  info.className = 'file-info';
  info.innerHTML = `
    <div class="file-name" title="${escapeHtml(file.fullPath)}">${escapeHtml(file.name)}</div>
    <div class="file-meta">${file.ext.toUpperCase().slice(1)} · ${formatBytes(file.size)}</div>
  `;

  item.appendChild(star);
  item.appendChild(icon);
  item.appendChild(info);

  // Click simples = selecionar + tocar (se áudio)
  item.addEventListener('click', () => selectFile(item, file));

  // Duplo click = inserir direto na timeline
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
  btnInsert.disabled = false;
  setStatus(`Selecionado: ${file.name}`);

  // Se for áudio, abre o preview
  if (EXT_AUDIO.has(file.ext)) {
    AudioPreview.load(file.fullPath);
  } else {
    AudioPreview.hide();
  }
}

// =====================================================
// TABS (Browse / Favoritos)
// =====================================================
function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));

  if (tabName === 'favorites') {
    renderSidebar();
    renderFavoritesList();
  } else {
    renderSidebar();
    fileList.innerHTML = '<p class="placeholder-text">Selecione uma pasta na barra lateral.</p>';
  }
}

function renderFavoritesList() {
  const favPaths = Favorites.list(true);
  if (favPaths.length === 0) {
    fileList.innerHTML = '<p class="placeholder-text">Nenhum favorito ainda.<br>Clique na ☆ ao lado de um arquivo para favoritar.</p>';
    setStatus('0 favoritos.');
    return;
  }

  const files = favPaths.map(p => {
    const dir = pathModule.dirname(p);
    const name = pathModule.basename(p);
    return fileEntryFromName(dir, name);
  });

  currentFiles = files;
  renderFileList(files);
  setStatus(`${files.length} favorito(s).`);
}

// =====================================================
// BUSCA
// =====================================================
function handleSearch() {
  const query = searchInput.value.toLowerCase().trim();
  searchClear.classList.toggle('visible', query.length > 0);

  if (!query) {
    if (currentTab === 'favorites') renderFavoritesList();
    else fileList.innerHTML = '<p class="placeholder-text">Selecione uma pasta na barra lateral.</p>';
    return;
  }

  if (query.length < 2) return;

  // Busca em todas as pastas adicionadas
  let results = [];
  myFolders.forEach(folder => {
    const all = getFilesRecursive(folder);
    const filtered = all.filter(f => f.name.toLowerCase().includes(query));
    results = results.concat(filtered);
  });

  // Remove duplicatas pelo fullPath
  const seen = new Set();
  results = results.filter(f => {
    if (seen.has(f.fullPath)) return false;
    seen.add(f.fullPath);
    return true;
  });

  currentFiles = results;
  renderFileList(results);
  setStatus(`${results.length} resultado(s) para "${query}".`);
}

function clearSearch() {
  searchInput.value = '';
  searchClear.classList.remove('visible');
  if (currentTab === 'favorites') renderFavoritesList();
  else fileList.innerHTML = '<p class="placeholder-text">Selecione uma pasta na barra lateral.</p>';
}

// =====================================================
// INSERÇÃO NA TIMELINE
// =====================================================
function insertIntoTimeline() {
  if (!selectedFilePath || !isCEP) return;

  // Pausa o preview pra não atrapalhar
  AudioPreview.stop();

  // Caminho com barras forward (mais seguro pro ExtendScript)
  const safePath = selectedFilePath.replace(/\\/g, '/').replace(/"/g, '\\"');

  setStatus('⏳ Enviando para o Premiere...');
  btnInsert.disabled = true;

  const script = `importAndInsert("${safePath}")`;

  csInterface.evalScript(script, (result) => {
    btnInsert.disabled = false;

    if (!result || result === 'EvalScript error.') {
      setStatus('❌ Falha de comunicação com o Premiere.');
      showToast('Erro: ExtendScript falhou. Tente recarregar o painel.', 'error');
      return;
    }

    let response;
    try {
      response = JSON.parse(result);
    } catch (e) {
      setStatus('❌ Resposta inválida.');
      showToast('Resposta inesperada do Premiere: ' + result, 'error');
      return;
    }

    if (response.success) {
      const trackName = response.trackType === 'audio' ? 'A' : 'V';
      const trackNum = response.trackIndex + 1;
      setStatus(`✅ Inserido em ${trackName}${trackNum}.`);
      showToast(`✅ Inserido na trilha ${trackName}${trackNum}`, 'success');
    } else {
      setStatus('❌ ' + response.error);
      showToast(response.error, 'error');
    }
  });
}

// =====================================================
// HELPERS
// =====================================================
function getFileTypeInfo(ext) {
  if (EXT_VIDEO.has(ext))  return { icon: '🎬', cls: 'icon-video' };
  if (EXT_AUDIO.has(ext))  return { icon: '🎵', cls: 'icon-audio' };
  if (EXT_MOGRT.has(ext))  return { icon: '✦',  cls: 'icon-mogrt' };
  if (EXT_IMAGE.has(ext))  return { icon: '🖼', cls: 'icon-image' };
  return { icon: '📄', cls: '' };
}

function formatBytes(bytes) {
  if (!bytes) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function setStatus(msg) {
  statusText.textContent = msg;
  console.log('[IronComposer]', msg);
}

let toastTimeout = null;
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = type;
  // Force reflow
  void toast.offsetWidth;
  toast.classList.add('show');
  if (type) toast.classList.add(type);

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cssEscape(str) {
  // Escapa caracteres especiais pra usar em seletores CSS
  return String(str).replace(/(["\\])/g, '\\$1');
}

function applyTheme(skinInfo) {
  if (!skinInfo || !skinInfo.panelBackgroundColor) return;
  const c = skinInfo.panelBackgroundColor.color;
  document.body.style.backgroundColor =
    `rgb(${Math.round(c.red)},${Math.round(c.green)},${Math.round(c.blue)})`;
}
