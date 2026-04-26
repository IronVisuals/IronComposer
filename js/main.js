/**
 * main.js — IronComposer (Versão com Subpastas)
 */

'use strict';

const isCEP = typeof window.__adobe_cep__ !== 'undefined';
let fs = null, pathModule = null, csInterface = null, shell = null;

// Arquivo de configuração persistente
let CONFIG_PATH = '';

const SUPPORTED_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.mxf', '.r3d', 
  '.wav', '.mp3', '.aac', '.aif', '.aiff', '.flac', 
  '.jpg', '.jpeg', '.png', '.tiff', '.psd', '.ai',  
  '.mogrt'
]);

let myFolders = []; // Lista de caminhos de pastas selecionadas
let selectedFilePath = null;
let currentFolderFiles = [];

// Elementos DOM
const folderTree = document.getElementById('folder-tree');
const fileList = document.getElementById('file-list');
const statusText = document.getElementById('status-text');
const btnInsert = document.getElementById('btn-insert');
const btnAddFolder = document.getElementById('btn-add-folder');
const searchInput = document.getElementById('search-input');

window.onload = function() {
  if (isCEP) {
    csInterface = new CSInterface();
    fs = require('fs');
    pathModule = require('path');
    
    // Caminho para salvar as pastas do usuário (AppData/Roaming)
    CONFIG_PATH = pathModule.join(csInterface.getSystemPath(SystemPath.USER_DATA), 'ironcomposer_list.json');

    updateTheme(csInterface.hostEnvironment.appSkinInfo);
    loadSavedFolders();
  }
};

function loadSavedFolders() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      myFolders = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      renderFolderSidebar();
    }
  } catch (e) { console.error("Erro ao ler config", e); }
}

function saveFolders() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(myFolders), 'utf8');
  } catch (e) { console.error("Erro ao salvar config", e); }
}

// Botão + ADD FOLDER (Seletor de pasta com atalhos rápidos)
btnAddFolder.onclick = function() {
  if (!isCEP) return;
  
  // Cria um diálogo customizado com atalhos para pastas comuns
  const userDataPath = csInterface.getSystemPath(SystemPath.USER_DATA);
  const documentsPath = csInterface.getSystemPath(SystemPath.DOCUMENTS);
  const videosPath = csInterface.getSystemPath(SystemPath.MY_DOCUMENTS);
  
  // Monta o diálogo com atalhos
  const dialogHtml = `
    <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000;">
      <div style="background:#252525;border:1px solid #3a3a3a;border-radius:8px;padding:20px;width:400px;">
        <h3 style="color:#e0e0e0;margin:0 0 15px 0;">Selecionar Pasta</h3>
        <p style="color:#999;font-size:12px;margin-bottom:15px;">Escolha uma pasta comum ou digite o caminho:</p>
        
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:15px;">
          <button onclick="selectQuickPath('${documentsPath.replace(/\\/g, '\\\\')}')" style="background:#2d2d2d;border:1px solid #3a3a3a;color:#e0e0e0;padding:10px;border-radius:4px;cursor:pointer;text-align:left;">
            📁 Documentos
          </button>
          <button onclick="selectQuickPath('${userDataPath.replace(/\\/g, '\\\\')}')" style="background:#2d2d2d;border:1px solid #3a3a3a;color:#e0e0e0;padding:10px;border-radius:4px;cursor:pointer;text-align:left;">
            📁 AppData
          </button>
          <button onclick="browseFolder()" style="background:#2d8ceb;border:none;color:#fff;padding:10px;border-radius:4px;cursor:pointer;grid-column:span 2;">
            🔍 Procurar...
          </button>
        </div>
        
        <div style="margin-top:10px;">
          <input type="text" id="custom-folder-path" placeholder="Ou digite o caminho aqui..." style="width:100%;background:#1e1e1e;border:1px solid #3a3a3a;color:#e0e0e0;padding:8px;border-radius:4px;">
        </div>
        
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:15px;">
          <button onclick="closeFolderDialog()" style="background:#2d2d2d;border:1px solid #3a3a3a;color:#e0e0e0;padding:8px 16px;border-radius:4px;cursor:pointer;">Cancelar</button>
          <button onclick="confirmFolderPath()" style="background:#2d8ceb;border:none;color:#fff;padding:8px 16px;border-radius:4px;cursor:pointer;">Adicionar</button>
        </div>
      </div>
    </div>
  `;
  
  // Remove diálogos anteriores
  const existing = document.getElementById('folder-dialog-overlay');
  if (existing) existing.remove();
  
  // Cria o diálogo
  const overlay = document.createElement('div');
  overlay.id = 'folder-dialog-overlay';
  overlay.innerHTML = dialogHtml;
  document.body.appendChild(overlay);
  
  // Funções globais para o diálogo
  window.selectQuickPath = function(path) {
    addFolderFromPath(path);
    closeFolderDialog();
  };
  
  window.browseFolder = function() {
    const result = cep.fs.showOpenDialog(false, true, "Selecionar Pasta");
    if (result.err === 0 && result.data.length > 0) {
      addFolderFromPath(result.data[0]);
      closeFolderDialog();
    }
  };
  
  window.confirmFolderPath = function() {
    const input = document.getElementById('custom-folder-path');
    if (input && input.value.trim()) {
      addFolderFromPath(input.value.trim());
      closeFolderDialog();
    }
  };
  
  window.closeFolderDialog = function() {
    const dialog = document.getElementById('folder-dialog-overlay');
    if (dialog) dialog.remove();
  };
};

function addFolderFromPath(newPath) {
  // Normaliza o caminho
  newPath = newPath.replace(/\\/g, '/');
  
  if (!fs.existsSync(newPath)) {
    setStatus("❌ Caminho não existe.");
    return;
  }
  
  if (!myFolders.includes(newPath)) {
    myFolders.push(newPath);
    saveFolders();
    renderFolderSidebar();
    setStatus("Pasta adicionada: " + newPath.split('/').pop());
  } else {
    setStatus("Pasta já adicionada.");
  }
}

// Função recursiva para buscar arquivos em subpastas
function getAllFilesRecursive(dirPath, maxDepth = 5, currentDepth = 0) {
  let files = [];
  
  if (currentDepth > maxDepth) return files;
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = pathModule.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        // É uma pasta - adiciona como pasta navegável
        const subFiles = getAllFilesRecursive(fullPath, maxDepth, currentDepth + 1);
        files = files.concat(subFiles);
      } else if (entry.isFile()) {
        const ext = pathModule.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          const stats = fs.statSync(fullPath);
          files.push({
            name: entry.name,
            fullPath: fullPath,
            ext: ext,
            size: stats.size,
            relativePath: pathModule.relative(dirPath, fullPath)
          });
        }
      }
    }
  } catch (e) {
    console.error("Erro ao ler:", dirPath, e);
  }
  
  return files;
}

// Função para obter subpastas de um diretório
function getSubfolders(dirPath) {
  let subfolders = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        subfolders.push({
          name: entry.name,
          fullPath: pathModule.join(dirPath, entry.name)
        });
      }
    }
  } catch (e) {
    console.error("Erro ao ler subpastas:", dirPath, e);
  }
  
  return subfolders.sort((a, b) => a.name.localeCompare(b.name));
}

function renderFolderSidebar() {
  folderTree.innerHTML = '';
  if (myFolders.length === 0) {
    folderTree.innerHTML = '<p class="placeholder-text" style="font-size:9px;">Nenhuma pasta adicionada.</p>';
    return;
  }

  myFolders.forEach((folderPath, index) => {
    const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop();
    
    // Container da pasta principal
    const folderContainer = document.createElement('div');
    folderContainer.className = 'folder-group';
    
    // Item da pasta principal
    const mainItem = document.createElement('div');
    mainItem.className = 'folder-item main-folder';
    mainItem.innerHTML = `<span class="icon-folder">📁</span> <span>${folderName}</span>`;
    mainItem.dataset.path = folderPath;
    mainItem.dataset.type = 'main';
    
    // Clique na pasta principal - mostra todos os arquivos das subpastas
    mainItem.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
      mainItem.classList.add('active');
      loadFilesFromDir(folderPath, true); // true = recursivo
    };
    
    // Botão direito para remover
    mainItem.oncontextmenu = (e) => {
      e.preventDefault();
      if(confirm("Remover esta pasta do atalho?")) {
        myFolders.splice(index, 1);
        saveFolders();
        renderFolderSidebar();
      }
    };
    
    folderContainer.appendChild(mainItem);
    
    // Carrega subpastas e adiciona ao tree
    const subfolders = getSubfolders(folderPath);
    subfolders.forEach(sub => {
      const subItem = document.createElement('div');
      subItem.className = 'folder-item sub-folder';
      subItem.style.paddingLeft = '25px';
      subItem.innerHTML = `<span class="icon-folder">📂</span> <span>${sub.name}</span>`;
      subItem.dataset.path = sub.fullPath;
      subItem.dataset.type = 'sub';
      
      subItem.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
        subItem.classList.add('active');
        loadFilesFromDir(sub.fullPath, false); // false = não recursivo para subpastas
      };
      
      folderContainer.appendChild(subItem);
    });
    
    folderTree.appendChild(folderContainer);
  });
}

function loadFilesFromDir(dirPath, recursive = false) {
  fileList.innerHTML = '<p class="placeholder-text">Lendo arquivos...</p>';
  
  try {
    let files;
    
    if (recursive) {
      // Mode: mostra todos os arquivos de todas as subpastas
      files = getAllFilesRecursive(dirPath);
    } else {
      // Mode: mostra apenas arquivos da pasta atual
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      files = entries
        .filter(e => e.isFile() && SUPPORTED_EXTENSIONS.has(pathModule.extname(e.name).toLowerCase()))
        .map(e => {
          const fullPath = pathModule.join(dirPath, e.name);
          const stats = fs.statSync(fullPath);
          return { 
            name: e.name, 
            fullPath: fullPath, 
            ext: pathModule.extname(e.name).toLowerCase(), 
            size: stats.size,
            relativePath: e.name
          };
        });
    }
    
    currentFolderFiles = files;
    renderFileList(files);
    setStatus(`${files.length} arquivos encontrados.`);
  } catch (e) {
    fileList.innerHTML = `<p class="placeholder-text">Erro ao ler: ${e.message}</p>`;
  }
}

function renderFileList(files) {
  fileList.innerHTML = '';
  if (files.length === 0) {
    fileList.innerHTML = '<p class="placeholder-text">Nenhum arquivo compatível encontrado.</p>';
    return;
  }

  // Ícones por tipo de arquivo
  const iconMap = {
    '.mp4': '🎬', '.mov': '🎬', '.avi': '🎬', '.mkv': '🎬', '.mxf': '🎬', '.r3d': '🎬',
    '.wav': '🎵', '.mp3': '🎵', '.aac': '🎵', '.aif': '🎵', '.aiff': '🎵', '.flac': '🎵',
    '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.tiff': '🖼️', '.psd': '🎨', '.ai': '✏️',
    '.mogrt': '📊'
  };

  files.forEach(file => {
    const item = document.createElement('div');
    item.className = 'file-item';
    const icon = iconMap[file.ext] || '📄';
    item.innerHTML = `
      <div class="file-icon">${icon}</div>
      <div class="file-info">
        <div class="file-name" title="${file.relativePath}">${file.name}</div>
        <div class="file-meta">${file.ext.toUpperCase()}</div>
      </div>
    `;
    item.onclick = () => {
      document.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      selectedFilePath = file.fullPath;
      btnInsert.disabled = false;
    };
    item.ondblclick = insertIntoTimeline;
    fileList.appendChild(item);
  });
}

// Busca Instantânea - pesquisa em todas as pastas adicionadas
searchInput.oninput = function() {
  const query = searchInput.value.toLowerCase();
  
  if (query.length < 2) {
    // Se a busca estiver vazia, mostra o último estado
    return;
  }
  
  // Busca em todas as pastas
  let allFiles = [];
  myFolders.forEach(folder => {
    const files = getAllFilesRecursive(folder);
    const filtered = files.filter(f => f.name.toLowerCase().includes(query));
    allFiles = allFiles.concat(filtered);
  });
  
  renderFileList(allFiles);
  setStatus(`${allFiles.length} arquivos encontrados para "${query}".`);
};

function insertIntoTimeline() {
  if (!selectedFilePath || !isCEP) return;

  // Resolve as barras para o ExtendScript (Windows \ para /)
  const safePath = selectedFilePath.replace(/\\/g, '/');
  setStatus("Enviando para o Premiere...");
  
  // Chamada direta para o host.jsx
  const script = 'importAndInsert("' + safePath + '")';
  csInterface.evalScript(script, function(result) {
    if (result.indexOf("Erro") > -1 || result === "EvalScript error.") {
      setStatus("❌ Falha na inserção.");
    } else {
      setStatus("✅ Inserido com sucesso!");
    }
    btnInsert.disabled = false;
  });
}

btnInsert.onclick = insertIntoTimeline;

function setStatus(msg) {
  statusText.textContent = msg;
}

function updateTheme(skinInfo) {
  const color = skinInfo.panelBackgroundColor.color;
  document.body.style.backgroundColor = `rgb(${Math.round(color.red)},${Math.round(color.green)},${Math.round(color.blue)})`;
}