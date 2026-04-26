/**
 * main.js — Lógica do painel IronComposer
 */

'use strict';

// =====================================================
// 1. SETUP INICIAL E DETECÇÃO DE AMBIENTE
// =====================================================

// Se window.__adobe_cep__ existir, estamos no Premiere. Senão, estamos no navegador (Mock Mode).
const isCEP = typeof window.__adobe_cep__ !== 'undefined';

const fs = isCEP ? require('fs') : null;
const path = isCEP ? require('path') : null;
let csInterface = null;

if (isCEP) {
  csInterface = new CSInterface();
} else {
  console.warn("⚠️ MODO BROWSER DETECTADO: Usando dados simulados (Mocks).");
  // Criamos um 'path' fake básico só para o código não quebrar no navegador
  path = {
    join: (...args) => args.join('\\'),
    basename: (p) => p.split('\\').pop(),
    extname: (p) => {
      const parts = p.split('.');
      return parts.length > 1 ? '.' + parts.pop() : '';
    }
  };
}

// =====================================================
// 2. CONFIGURAÇÃO BASE
// =====================================================

let CONFIG_FILE = '';
if (isCEP) {
  CONFIG_FILE = path.join(__dirname, '..', 'config.local.json');
}

const DEFAULT_ROOT = 'G:\\'; 

const SUPPORTED_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.mxf', '.r3d', 
  '.wav', '.mp3', '.aac', '.aif', '.aiff', '.flac', 
  '.jpg', '.jpeg', '.png', '.tiff', '.psd', '.ai',  
  '.mogrt',                                          
]);

// =====================================================
// 3. VARIÁVEIS DE ESTADO E REFERÊNCIAS DO DOM
// =====================================================

let currentRootPath   = DEFAULT_ROOT; 
let selectedFilePath  = null;          
let allFilesInFolder  = [];            

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
// 4. FUNÇÕES DE CONFIGURAÇÃO (Lendo/Salvando)
// =====================================================

function loadConfig() {
  if (!isCEP) {
    currentRootPath = DEFAULT_ROOT;
    setStatus(`[Mock] Pasta raiz: ${currentRootPath}`);
    return;
  }

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw    = fs.readFileSync(CONFIG_FILE, 'utf8');
      const config = JSON.parse(raw);
      currentRootPath = config.rootPath || DEFAULT_ROOT;
    }
  } catch (err) {
    currentRootPath = DEFAULT_ROOT;
  }
  setStatus(`Pasta raiz: ${currentRootPath}`);
}

function saveConfig(rootPath) {
  currentRootPath = rootPath;
  if (!isCEP) {
    setStatus(`[Mock] Pasta raiz atualizada: ${rootPath}`);
    return;
  }

  try {
    const config = { rootPath };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    setStatus(`Pasta raiz atualizada: ${rootPath}`);
  } catch (err) {
    setStatus(`ERRO ao salvar: ${err.message}`);
  }
}

// =====================================================
// 5. HELPER: ÍCONES E FORMATAÇÃO
// =====================================================

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

// =====================================================
// 6. LEITURA DE PASTAS E ARQUIVOS (Abstraída)
// =====================================================

function loadFolders(rootPath) {
  folderTree.innerHTML = '<p class="placeholder-text">Lendo pastas...</p>';

  let folders = [];

  if (isCEP) {
    try {
      if (!fs.existsSync(rootPath)) {
        folderTree.innerHTML = `<p class="placeholder-text">Pasta não encontrada: ${rootPath}</p>`;
        return;
      }
      const entries = fs.readdirSync(rootPath, { withFileTypes: true });
      folders = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch (err) {
      folderTree.innerHTML = `<p class="placeholder-text">Erro: ${err.message}</p>`;
      return;
    }
  } else {
    // MOCK DATA: Pastas fictícias para testar no navegador
    folders = ['SFX_Impactos', 'Transicoes_Video', 'Lower_Thirds_Mogrt', 'Trilhas_Sonoras'];
  }

  if (folders.length === 0) {
    folderTree.innerHTML = '<p class="placeholder-text">Nenhuma subpasta encontrada.</p>';
    return;
  }

  folderTree.innerHTML = '';
  folders.forEach(folderName => {
    const item = document.createElement('div');
    item.className = 'folder-item';
    item.innerHTML = `<span class="icon icon-folder">📁</span><span>${folderName}</span>`;

    item.addEventListener('click', () => {
      document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      const folderPath = path.join(rootPath, folderName);
      loadFiles(folderPath, folderName);
    });

    folderTree.appendChild(item);
  });
}

function loadFiles(folderPath, folderName = '') {
  fileList.innerHTML = '<p class="placeholder-text">Lendo arquivos...</p>';
  selectedFilePath = null;
  btnInsert.disabled = true;

  if (isCEP) {
    try {
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      allFilesInFolder = entries
        .filter(e => e.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
        .map(e => {
          const fullPath = path.join(folderPath, e.name);
          let size = 0;
          try { size = fs.statSync(fullPath).size; } catch (_) {}
          return { name: e.name, fullPath, ext: path.extname(e.name).toLowerCase(), size };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      fileList.innerHTML = `<p class="placeholder-text">Erro: ${err.message}</p>`;
      return;
    }
  } else {
    // MOCK DATA: Arquivos fictícios baseados na pasta clicada
    allFilesInFolder = gerarArquivosMock(folderPath, folderName);
  }

  renderFileList(allFilesInFolder);
  setStatus(`${allFilesInFolder.length} arquivo(s) encontrado(s).`);
}

function gerarArquivosMock(folderPath, folderName) {
  // Gera arquivos falsos dependendo da pasta que você clicou no navegador
  if (folderName === 'SFX_Impactos') {
    return [
      { name: 'impacto_pesado_01.wav', fullPath: path.join(folderPath, 'impacto_pesado_01.wav'), ext: '.wav', size: 1540000 },
      { name: 'whoosh_hit_02.wav', fullPath: path.join(folderPath, 'whoosh_hit_02.wav'), ext: '.wav', size: 850000 }
    ];
  } else if (folderName === 'Lower_Thirds_Mogrt') {
    return [
      { name: 'Nome_Entrevistado_Azul.mogrt', fullPath: path.join(folderPath, 'Nome_Entrevistado_Azul.mogrt'), ext: '.mogrt', size: 5540000 },
      { name: 'Redes_Sociais_Pop.mogrt', fullPath: path.join(folderPath, 'Redes_Sociais_Pop.mogrt'), ext: '.mogrt', size: 3100000 }
    ];
  }
  // Padrão
  return [
    { name: 'video_broll_01.mp4', fullPath: path.join(folderPath, 'video_broll_01.mp4'), ext: '.mp4', size: 45000000 },
    { name: 'efeito_sonoro.mp3', fullPath: path.join(folderPath, 'efeito_sonoro.mp3'), ext: '.mp3', size: 3200000 }
  ];
}

function renderFileList(files) {
  if (files.length === 0) {
    fileList.innerHTML = '<p class="placeholder-text">Nenhum arquivo compatível.</p>';
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

  const safePath = selectedFilePath.replace(/\\/g, '\\\\');
  setStatus(`Inserindo: ${path.basename(selectedFilePath)}...`);
  btnInsert.disabled = true;

  if (!isCEP) {
    // Simula a demora de inserção no navegador
    setTimeout(() => {
      setStatus(`[Mock] ✓ Inserido na Timeline: ${path.basename(selectedFilePath)}`);
      btnInsert.disabled = false;
    }, 800);
    return;
  }

  const script = `importAndInsert("${safePath}")`;
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
// 9. EVENTOS DE CLIQUE DOS BOTÕES
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