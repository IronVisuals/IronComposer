/**
 * audioPreview.js — Player de áudio com waveform
 *
 * Como funciona:
 *   1. Quando o usuário clica num arquivo de áudio, chamamos load(filePath)
 *   2. Usamos Node fs.readFileSync para ler o arquivo (já que estamos no CEP)
 *   3. Convertemos os bytes para AudioBuffer via Web Audio API
 *   4. Desenhamos a waveform num <canvas>
 *   5. O <audio> HTML5 toca o arquivo via file:// URL
 *
 * Recursos:
 *   - Play/pause
 *   - Volume com slider e mute
 *   - Click/drag na waveform pra mudar a posição
 *   - Reprodução automática ao selecionar áudio
 */

'use strict';

window.AudioPreview = (function() {

  // ===== Estado =====
  let fs = null;
  let audioContext = null;
  let audioElement = null;       // <audio> HTML5
  let currentBuffer = null;      // AudioBuffer decodificado (pra desenhar)
  let currentFilePath = null;
  let isPlaying = false;
  let isMuted = false;
  let lastVolume = 0.8;

  // ===== DOM refs =====
  let container, canvas, ctx, loading, playhead;
  let btnPlay, timeLabel, volumeSlider, volumeIcon, nameLabel;
  let previewPanel;

  // ===== Cores da waveform (CSS vars) =====
  const COLOR_WAVE = '#4fa3f7';
  const COLOR_WAVE_PLAYED = '#2d8ceb';
  const COLOR_BG = '#2b2b2b';

  /**
   * Inicializa o módulo. Chamar uma vez ao carregar o painel.
   */
  function init() {
    fs = require('fs');

    previewPanel = document.getElementById('audio-preview');
    container    = document.getElementById('waveform-container');
    canvas       = document.getElementById('waveform-canvas');
    ctx          = canvas.getContext('2d');
    loading      = document.getElementById('waveform-loading');
    playhead     = document.getElementById('playhead');
    btnPlay      = document.getElementById('btn-play');
    timeLabel    = document.getElementById('preview-time');
    volumeSlider = document.getElementById('volume-slider');
    volumeIcon   = document.getElementById('volume-icon');
    nameLabel    = document.getElementById('preview-name');

    // <audio> HTML5 oculto que toca o arquivo
    audioElement = new Audio();
    audioElement.preload = 'auto';

    // AudioContext só será criado quando precisar (após interação)
    setupEventListeners();
    setupAudioElementEvents();
  }

  function setupEventListeners() {
    btnPlay.addEventListener('click', togglePlay);

    volumeSlider.addEventListener('input', (e) => {
      const vol = e.target.value / 100;
      setVolume(vol);
    });

    volumeIcon.addEventListener('click', toggleMute);

    // Click na waveform: pula pra essa posição
    container.addEventListener('click', (e) => {
      if (!audioElement.duration) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = x / rect.width;
      audioElement.currentTime = audioElement.duration * ratio;
    });
  }

  function setupAudioElementEvents() {
    audioElement.addEventListener('play',  () => { isPlaying = true;  btnPlay.textContent = '⏸'; });
    audioElement.addEventListener('pause', () => { isPlaying = false; btnPlay.textContent = '▶'; });
    audioElement.addEventListener('ended', () => {
      isPlaying = false;
      btnPlay.textContent = '▶';
      playhead.classList.remove('visible');
    });

    audioElement.addEventListener('timeupdate', updatePlayhead);
    audioElement.addEventListener('loadedmetadata', () => {
      updateTimeLabel();
    });
  }

  /**
   * Carrega um arquivo de áudio para o preview
   */
  async function load(filePath) {
    currentFilePath = filePath;

    // Mostra o painel de preview
    previewPanel.classList.remove('hidden');
    nameLabel.textContent = filePath.split(/[\\/]/).pop();
    loading.classList.remove('hidden');
    playhead.classList.remove('visible');

    // Para o que estiver tocando
    audioElement.pause();
    audioElement.currentTime = 0;

    // Define a fonte do <audio> via file:// URL
    // Importante: caminhos do Windows precisam ser convertidos para URL
    const fileUrl = filePathToUrl(filePath);
    audioElement.src = fileUrl;
    audioElement.volume = isMuted ? 0 : lastVolume;

    // Carrega e desenha a waveform em paralelo
    try {
      await drawWaveform(filePath);
      loading.classList.add('hidden');

      // Auto-play ao selecionar
      try {
        await audioElement.play();
      } catch (playErr) {
        console.warn('[AudioPreview] Autoplay bloqueado:', playErr);
      }
    } catch (err) {
      console.error('[AudioPreview] Falha ao desenhar waveform:', err);
      loading.textContent = 'Não foi possível carregar a waveform';
    }
  }

  /**
   * Converte caminho de arquivo do sistema em URL file://
   * Exemplo:
   *   "G:\Audios\track.wav" → "file:///G:/Audios/track.wav"
   */
  function filePathToUrl(filePath) {
    // Normaliza barras
    let normalized = filePath.replace(/\\/g, '/');
    // Encode caracteres especiais (espaços, acentos, etc.)
    const parts = normalized.split('/');
    const encoded = parts.map(p => encodeURIComponent(p)).join('/');
    return 'file:///' + encoded;
  }

  /**
   * Lê o arquivo de áudio do disco e desenha a waveform.
   *
   * Pipeline:
   *   1. fs.readFileSync(filePath) → Buffer (Node)
   *   2. Buffer → ArrayBuffer
   *   3. ArrayBuffer → AudioBuffer (decodeAudioData)
   *   4. Pega channelData do AudioBuffer (Float32Array com amostras)
   *   5. Faz downsampling pros pixels do canvas
   *   6. Desenha barras verticais
   */
  async function drawWaveform(filePath) {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // 1. Lê o arquivo do disco (Node fs)
    const buffer = fs.readFileSync(filePath);

    // 2. Buffer Node → ArrayBuffer (que a Web Audio API entende)
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );

    // 3. Decodifica para AudioBuffer
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    currentBuffer = audioBuffer;

    // 4. Pega as amostras do canal 0 (mono ou esquerdo)
    const channelData = audioBuffer.getChannelData(0);

    // Ajusta o canvas para a resolução real do dispositivo
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.scale(dpr, dpr);

    // 5. Downsampling: agrupa N amostras por pixel
    const samplesPerPixel = Math.floor(channelData.length / width);
    const peaks = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      let max = 0;
      const start = x * samplesPerPixel;
      const end   = start + samplesPerPixel;
      for (let i = start; i < end; i++) {
        const abs = Math.abs(channelData[i]);
        if (abs > max) max = abs;
      }
      peaks[x] = max;
    }

    // 6. Desenha
    drawPeaks(peaks, width, height, 0);
  }

  /**
   * Desenha as barras da waveform.
   * playedRatio = 0..1 indica até onde já foi tocado (cor diferente)
   */
  function drawPeaks(peaks, width, height, playedRatio) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, width, height);

    const middle = height / 2;
    const playedX = width * playedRatio;

    for (let x = 0; x < width; x++) {
      const peak = peaks[x];
      const barHeight = Math.max(1, peak * (height * 0.9));
      ctx.fillStyle = (x < playedX) ? COLOR_WAVE_PLAYED : COLOR_WAVE;
      ctx.fillRect(x, middle - barHeight / 2, 1, barHeight);
    }
  }

  function togglePlay() {
    if (!audioElement.src) return;
    if (audioElement.paused) {
      audioElement.play();
    } else {
      audioElement.pause();
    }
  }

  function setVolume(vol) {
    lastVolume = vol;
    audioElement.volume = isMuted ? 0 : vol;
    volumeIcon.textContent = vol === 0 ? '🔇' : (vol < 0.5 ? '🔉' : '🔊');
  }

  function toggleMute() {
    isMuted = !isMuted;
    audioElement.volume = isMuted ? 0 : lastVolume;
    volumeIcon.textContent = isMuted ? '🔇' : (lastVolume < 0.5 ? '🔉' : '🔊');
  }

  function updatePlayhead() {
    if (!audioElement.duration) return;
    const ratio = audioElement.currentTime / audioElement.duration;
    const width = container.clientWidth;
    playhead.style.left = (width * ratio) + 'px';
    playhead.classList.add('visible');
    updateTimeLabel();
  }

  function updateTimeLabel() {
    const cur = formatTime(audioElement.currentTime || 0);
    const dur = formatTime(audioElement.duration || 0);
    timeLabel.textContent = cur + ' / ' + dur;
  }

  function formatTime(seconds) {
    if (!isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  /**
   * Esconde o painel de preview e para a reprodução
   */
  function hide() {
    audioElement.pause();
    audioElement.src = '';
    previewPanel.classList.add('hidden');
    currentFilePath = null;
  }

  /**
   * Para a reprodução sem esconder o painel
   */
  function stop() {
    audioElement.pause();
    audioElement.currentTime = 0;
  }

  return { init, load, hide, stop, togglePlay };
})();
