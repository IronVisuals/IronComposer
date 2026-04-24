/**
 * main.js — Lógica do painel IronComposer
 *
 * ATENÇÃO: Este arquivo roda num ambiente HÍBRIDO.
 * Graças ao flag --enable-nodejs no manifest.xml, temos acesso
 * ao Node.js (módulo 'fs', 'path') E ao ambiente web (DOM)
 * ao mesmo tempo.
 */

'use strict';

// =====================================================
// 1. SETUP INICIAL E BIBLIOTECAS
// =====================================================

/**
 * csInterface é a nossa "ponte". É como se fosse uma API que chama 
 * funções nativas (semelhante ao JNI em Java para chamar C/C++).
 */
const csInterface = new CSInterface();

/**
 * Importando módulos nativos do Node.js
 * 'fs' lê o disco. 'path' resolve barras invertidas e caminhos (Windows vs Mac).
 */
const fs   = require('fs');
const path = require('path');

// =====================================================
// 2. CONFIGURAÇÃO BASE
// =====================================================

/**
 * __dirname é uma variável mágica do Node que pega o caminho absoluto
 * de onde este script está rodando. O ".." volta uma pasta.
 * Isso garante que o config.local.json seja lido do lugar certo sempre.
 */
const CONFIG_FILE = path.join(__dirname, '..', 'config.local.json');
const DEFAULT_ROOT = 'G:\\'; // Você pode mudar isso depois no modal da UI

// Usar Set (Hash Set em Java/C++) deixa a busca O(1) em vez de O(N) do Array
const SUPPORTED_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.mxf', '.r3d', // Vídeo
  '.wav', '.mp3', '.aac', '.aif', '.aiff', '.flac', // Áudio
  '.jpg', '.jpeg', '.png', '.tiff', '.psd', '.ai',  // Imagem
  '.mogrt',                                          // Motion Graphics
]);

// =====================================================
// 3. VARIÁVEIS DE ESTADO (Globais do nosso painel)
// =====================================================

let currentRootPath   = DEFAULT_ROOT; 
let selectedFilePath  = null;          
let allFilesInFolder  = [];            

// =====================================================
// 4. PONTEIROS PARA O DOM (Interface)
// =====================================================

const folderTree    = document.getElementById('folder-tree');
const fileList      = document.getElementById('file-list');
const statusText    = document.getElementById('status-text');
const btnInsert     = document.getElementById('btn-insert');
const btnConfig     = document.getElementById('btn-config');
const searchInput   = document.getElementById('search-input');
const modalOverlay  = document.getElementById('modal-overlay');
const rootPathInput = document.getElementById('root-path-input');
const btnSaveConfig = document.getElementById('btn-save-config');
const btnCancel     = document.getElementById('btn-cancel-config');

// =====================================================
// 5. FUNÇÕES DE CONFIGURAÇÃO (Lendo/Salvando o JSON)
// =====================================================

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw    = fs.readFileSync(CONFIG_FILE, 'utf8');
      const config = JSON.parse(raw);
      currentRootPath = config.rootPath || DEFAULT_ROOT;
    }
  } catch (err) {
    console.error('[IronComposer] Erro ao carregar config:', err);
    currentRootPath = DEFAULT_ROOT;
  }
  setStatus(`Pasta raiz: ${currentRootPath}`);
}

function saveConfig(rootPath) {
  try {
    const config = { rootPath };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    currentRootPath = rootPath;
    setStatus(`Pasta raiz atualizada: ${rootPath}`);
  } catch (err) {
    setStatus(`ERRO ao salvar configuração: ${err.message}`);
  }
}

// =====================================================
// 6. LEITURA DE PASTAS E ARQUIVOS (Node.js fs)
// =====================================================

function loadFolders(rootPath) {
  folderTree.innerHTML = '<p class="placeholder-text">Lendo pastas...</p>';

  try {
    if (!fs.existsSync(rootPath)) {
      folderTree.innerHTML = `<p class="placeholder-text">Pasta não encontrada: ${rootPath}</p>`;
      return;
    }

    // readdirSync lê tudo que está na pasta de forma síncrona (bloqueia a thread, igual no C)
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });

    // Filtra para pegar apenas pastas (ignora arquivos soltos na raiz)
    const folders = entries.filter(e => e.isDirectory());

    if (folders.length === 0) {
      folderTree.innerHTML = '<p class="placeholder-text">Nenhuma subpasta encontrada.</p>';
      return;
    }

    folderTree.innerHTML = '';
    folders.forEach(folder => {
      const item = document.createElement('div');
      item.className = 'folder-item';
      item.innerHTML = `<span class="icon icon-folder">📁</span><span>${folder.name}</span>`;

      // Evento de clique para carregar os arquivos daquela pasta
      item.addEventListener('click', () => {
        document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');

        const folderPath = path.join(rootPath, folder.name);
        loadFiles(folderPath);
      });

      folderTree.appendChild(item);
    });

  } catch (err) {
    folderTree.innerHTML = `<p class="placeholder-text">Erro: ${err.message}</p>`;
  }
}

function getFileIcon(ext) {
  const videoExts = new Set(['.mp4', '.mov', '.avi', '.mkv', '.mxf', '.r3d']);
  const audioExts = new Set(['.wav', '.mp3', '.aac', '.aif', '.aiff', '.flac']);
  const imageExts = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.psd', '.ai']);

  if (ext === '.mogrt')      return { icon: '✦', cls: 'icon-mogrt'  };
  if (videoExts.has(ext))    return { icon: '▶', cls: 'icon-video'  };
  if (audioExts.has(ext))    return { icon: '♪', cls: 'icon-audio'  };
  if (imageExts.has(ext))    return { icon: '🖼', cls: 'icon-image'  };
  return                     { icon: '•', cls: ''             };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function loadFiles(folderPath) {
  fileList.innerHTML = '<p class="placeholder-text">Lendo arquivos...</p>';
  selectedFilePath = null;
  btnInsert.disabled = true;

  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });

    allFilesInFolder = entries
      .filter(e => {
        if (!e.isFile()) return false;
        const ext = path.extname(e.name).toLowerCase();
        return SUPPORTED_EXTENSIONS.has(ext);
      })
      .map(e => {
        const fullPath = path.join(folderPath, e.name);
        const ext      = path.extname(e.name).toLowerCase();
        let size       = 0;
        try {
          size = fs.statSync(fullPath).size; 
        } catch (_) {}

        return { name: e.name, fullPath, ext, size };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    renderFileList(allFilesInFolder);
    setStatus(`${allFilesInFolder.length} arquivo(s) encontrado(s).`);

  } catch (err) {
    fileList.innerHTML = `<p class="placeholder-text">Erro: ${err.message}</p>`;
  }
}

function renderFileList(files) {
  if (files.length === 0) {
    fileList.innerHTML = '<p class="placeholder-text">Nenhum arquivo compatível nesta pasta.</p>';
    return;
  }

  fileList.innerHTML = '';
  files.forEach(file => {
    const { icon, cls } = getFileIcon(file.ext);
    const item = document.createElement('div');
    item.className = 'file-item';
    item.dataset.path = file.fullPath; 

    item.innerHTML = `
      <div class="file-icon ${cls}">${icon}</div>
      <div class="file-info">
        <div class="file-name" title="${file.name}">${file.name}</div>
        <div class="file-meta">${file.ext.toUpperCase().slice(1)} · ${formatBytes(file.size)}</div>
      </div>
    `;

    item.addEventListener('click', () => selectFile(item, file.fullPath));
    item.addEventListener('dblclick', () => {
      selectFile(item, file.fullPath);
      insertIntoTimeline();
    });

    fileList.appendChild(item);
  });
}

function selectFile(itemEl, filePath) {
  document.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
  itemEl.classList.add('selected');
  selectedFilePath = filePath;
  btnInsert.disabled = false;
  setStatus(`Selecionado: ${path.basename(filePath)}`);
}

// =====================================================
// 7. BARRA DE PESQUISA
// =====================================================

searchInput.addEventListener('input', () => {
  const query = searchInput.value.toLowerCase().trim();
  if (!query) {
    renderFileList(allFilesInFolder);
    return;
  }
  const filtered = allFilesInFolder.filter(f => f.name.toLowerCase().includes(query));
  renderFileList(filtered);
  setStatus(`${filtered.length} resultado(s) para "${query}"`);
});

// =====================================================
// 8. O MOTOR: COMUNICAÇÃO COM O PREMIERE
// =====================================================

function insertIntoTimeline() {
  if (!selectedFilePath) return;

  // No Windows, caminhos têm barra invertida (\). Precisamos escapar (\\) 
  // para que o ExtendScript do Premiere não interprete errado.
  const safePath = selectedFilePath.replace(/\\/g, '\\\\');

  setStatus(`Inserindo: ${path.basename(selectedFilePath)}...`);
  btnInsert.disabled = true;

  // Montamos uma string que é examente o código que o Premiere vai rodar lá dentro
  const script = `importAndInsert("${safePath}")`;

  // evalScript manda a instrução para o ExtendScript (host.jsx) e aguarda o callback
  csInterface.evalScript(script, function(result) {
    btnInsert.disabled = false;
    try {
      const response = JSON.parse(result);
      if (response.success) setStatus(`✓ Inserido: ${path.basename(selectedFilePath)}`);
      else setStatus(`✗ Erro: ${response.error}`);
    } catch (e) {
      setStatus(`Resposta do Premiere: ${result}`);
    }
  });
}

// =====================================================
// 9. EVENTOS DE CLIQUE DOS BOTÕES (Modal e Interface)
// =====================================================

btnInsert.addEventListener('click', insertIntoTimeline);

btnConfig.addEventListener('click', () => {
  rootPathInput.value = currentRootPath;
  modalOverlay.classList.remove('hidden');
  rootPathInput.focus();
});

btnCancel.addEventListener('click', () => modalOverlay.classList.add('hidden'));

btnSaveConfig.addEventListener('click', () => {
  const newPath = rootPathInput.value.trim();
  if (!newPath) return;

  saveConfig(newPath);
  modalOverlay.classList.add('hidden');

  selectedFilePath = null;
  btnInsert.disabled = true;
  fileList.innerHTML = '<p class="placeholder-text">Selecione uma pasta.</p>';
  loadFolders(currentRootPath);
});

rootPathInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnSaveConfig.click();
  if (e.key === 'Escape') btnCancel.click();
});

function setStatus(msg) {
  statusText.textContent = msg;
  console.log('[IronComposer]', msg);
}

// =====================================================
// 10. INICIALIZAÇÃO
// =====================================================

function init() {
  loadConfig();
  loadFolders(currentRootPath);
  setStatus('IronComposer carregado. Selecione uma pasta.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}