/**
 * storage.js — Gerenciador de persistência do IronComposer
 *
 * Salva e carrega configurações em JSON na pasta de dados do usuário
 * (AppData/Roaming no Windows). Cada "namespace" é um arquivo separado:
 *
 *   - ironcomposer_folders.json  → lista de pastas adicionadas
 *   - ironcomposer_favorites.json → lista de arquivos favoritados
 *   - ironcomposer_settings.json  → configurações gerais (volume, etc.)
 *
 * USO:
 *   Storage.set('folders', [...]);
 *   const data = Storage.get('folders', []); // segundo arg = default
 */

'use strict';

window.Storage = (function() {

  // Será preenchido quando o CEP estiver pronto
  let basePath = '';
  let fs = null;
  let pathModule = null;
  let isReady = false;

  /**
   * Inicializa o storage. Chame UMA VEZ no início (em main.js).
   * Precisa do CSInterface já instanciado.
   */
  function init(csInterface) {
    try {
      fs = require('fs');
      pathModule = require('path');
      basePath = csInterface.getSystemPath(SystemPath.USER_DATA);
      isReady = true;
      console.log('[Storage] Inicializado em:', basePath);
    } catch (e) {
      console.error('[Storage] Falha ao inicializar:', e);
      isReady = false;
    }
  }

  /**
   * Monta o caminho do arquivo JSON pra um dado namespace
   */
  function getFilePath(namespace) {
    return pathModule.join(basePath, 'ironcomposer_' + namespace + '.json');
  }

  /**
   * Lê dados de um namespace. Se não existir, retorna defaultValue.
   */
  function get(namespace, defaultValue) {
    if (!isReady) return defaultValue;
    try {
      const filePath = getFilePath(namespace);
      if (!fs.existsSync(filePath)) return defaultValue;
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.error('[Storage] Erro ao ler', namespace, e);
      return defaultValue;
    }
  }

  /**
   * Salva dados num namespace.
   */
  function set(namespace, data) {
    if (!isReady) return false;
    try {
      const filePath = getFilePath(namespace);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('[Storage] Erro ao salvar', namespace, e);
      return false;
    }
  }

  /**
   * Remove um namespace
   */
  function remove(namespace) {
    if (!isReady) return false;
    try {
      const filePath = getFilePath(namespace);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    } catch (e) {
      console.error('[Storage] Erro ao remover', namespace, e);
      return false;
    }
  }

  return { init, get, set, remove };
})();
