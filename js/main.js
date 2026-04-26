/**
 * main.js — IronComposer (Versão Atalhos de Pastas)
 */

'use strict';

const isCEP = typeof window.__adobe_cep__ !== 'undefined';
let fs = null, path = null, csInterface = null;

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
    path = require('path');
    
    // Caminho para salvar as pastas do usuário (AppData/Roaming)
    CONFIG_PATH = path.join(csInterface.getSystemPath(SystemPath.USER_DATA), 'ironcomposer_list.json');

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

// Botão + ADD FOLDER (Explorer Nativo)
btnAddFolder.onclick = function() {
  if (!isCEP) return;
  
  // Abre o seletor de pastas nativo do Windows
  const result = cep.fs.showOpenDialog(false, true, "Selecionar Pasta para o IronComposer");
  
  if (result.err === 0 && result.data.length > 0) {
    const newPath = result.data[0];
    if (!myFolders.includes(newPath)) {
      myFolders.push(newPath);
      saveFolders();
      renderFolderSidebar();
      setStatus("Pasta adicionada com sucesso.");
    }
  }
};

function renderFolderSidebar() {
  folderTree.innerHTML = '';
  if (myFolders.length === 0) {
    folderTree.innerHTML = '<p class="placeholder-text" style="font-size:9px;">Nenhuma pasta adicionada.</p>';
    return;
  }

  myFolders.forEach((folderPath, index) => {
    const item = document.createElement('div');
    item.className = 'folder-item';
    const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop();
    item.innerHTML = `<span class="icon-folder">📁</span> <span>${folderName}</span>`;
    
    // Clique com o botão direito para remover
    item.oncontextmenu = (e) => {
      e.preventDefault();
      if(confirm("Remover esta pasta do atalho?")) {
        myFolders.splice(index, 1);
        saveFolders();
        renderFolderSidebar();
      }
    };

    item.onclick = () => {
      document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      loadFilesFromDir(folderPath);
    };
    folderTree.appendChild(item);
  });
}

function loadFilesFromDir(dirPath) {
  fileList.innerHTML = '<p class="placeholder-text">Lendo arquivos...</p>';
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    currentFolderFiles = entries
      .filter(e => e.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
      .map(e => {
        const fullPath = path.join(dirPath, e.name);
        const stats = fs.statSync(fullPath);
        return { name: e.name, fullPath, ext: path.extname(e.name).toLowerCase(), size: stats.size };
      });
    renderFileList(currentFolderFiles);
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

  files.forEach(file => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <div class="file-icon">📄</div>
      <div class="file-info">
        <div class="file-name">${file.name}</div>
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

// Busca Instantânea
searchInput.oninput = function() {
  const query = searchInput.value.toLowerCase();
  const filtered = currentFolderFiles.filter(f => f.name.toLowerCase().includes(query));
  renderFileList(filtered);
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