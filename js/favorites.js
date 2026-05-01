/**
 * favorites.js — Gerenciador de favoritos
 *
 * Estrutura salva no disco (ironcomposer_favorites.json):
 *   [
 *     "G:\\Audios\\track1.wav",
 *     "G:\\Videos\\intro.mp4",
 *     ...
 *   ]
 *
 * É só uma lista de caminhos completos. Simples e direto.
 */

'use strict';

window.Favorites = (function() {

  let favoriteSet = new Set(); // usar Set é mais rápido pra checar (.has())

  function getNodeRequire() {
    if (typeof require === 'function') return require;
    if (window.cep_node && typeof window.cep_node.require === 'function') return window.cep_node.require;
    throw new Error('Node.js não está habilitado no CEP.');
  }


  function init() {
    const saved = window.IronStorage.get('favorites', []);
    favoriteSet = new Set(saved);
    console.log('[Favorites] Carregados:', favoriteSet.size);
  }

  function isFavorite(filePath) {
    return favoriteSet.has(filePath);
  }

  function add(filePath) {
    favoriteSet.add(filePath);
    save();
  }

  function remove(filePath) {
    favoriteSet.delete(filePath);
    save();
  }

  function toggle(filePath) {
    if (isFavorite(filePath)) {
      remove(filePath);
      return false;
    } else {
      add(filePath);
      return true;
    }
  }

  /**
   * Retorna a lista de favoritos.
   * Filtra os que ainda existem no disco (remove "fantasmas").
   */
  function list(filterByExisting = true) {
    const fs = getNodeRequire()('fs');
    const items = Array.from(favoriteSet);
    if (!filterByExisting) return items;

    const valid = items.filter(p => {
      try { return fs.existsSync(p); } catch (e) { return false; }
    });

    // Se algum sumiu, atualiza o Set
    if (valid.length !== items.length) {
      favoriteSet = new Set(valid);
      save();
    }
    return valid;
  }

  function save() {
    window.IronStorage.set('favorites', Array.from(favoriteSet));
  }

  function clear() {
    favoriteSet.clear();
    save();
  }

  return { init, isFavorite, add, remove, toggle, list, clear };
})();
