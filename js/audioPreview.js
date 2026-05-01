/**
 * audioPreview.js — IronComposer v2.1
 * Player de áudio com waveform, autoplay e proteção contra arquivos muito grandes.
 */

'use strict';

window.AudioPreview = (function() {
  var fs = null;
  var audioContext = null;
  var audioElement = null;
  var currentPeaks = null;
  var currentFilePath = null;
  var isMuted = false;
  var lastVolume = 0.8;
  var loadToken = 0;

  var previewPanel, container, canvas, ctx, loading, playhead;
  var btnPlay, timeLabel, volumeSlider, volumeIcon, nameLabel;

  var COLOR_WAVE = '#4fa3f7';
  var COLOR_WAVE_PLAYED = '#2d8ceb';
  var COLOR_BG = '#2b2b2b';
  var MAX_WAVEFORM_BYTES = 180 * 1024 * 1024; // evita travar/crashar com músicas enormes

  function getNodeRequire() {
    if (typeof require === 'function') return require;
    if (window.cep_node && typeof window.cep_node.require === 'function') return window.cep_node.require;
    throw new Error('Node.js não está habilitado no CEP.');
  }

  function init() {
    fs = getNodeRequire()('fs');

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

    audioElement = new Audio();
    audioElement.preload = 'auto';
    audioElement.volume = lastVolume;

    setupEventListeners();
    setupAudioElementEvents();
  }

  function setupEventListeners() {
    btnPlay.addEventListener('click', togglePlay);

    volumeSlider.addEventListener('input', function(e) {
      var vol = e.target.value / 100;
      setVolume(vol);
    });

    volumeIcon.addEventListener('click', toggleMute);

    container.addEventListener('click', function(e) {
      seekFromMouse(e);
    });

    container.addEventListener('mousedown', function() {
      container.dataset.dragging = '1';
    });

    document.addEventListener('mouseup', function() {
      container.dataset.dragging = '0';
    });

    container.addEventListener('mousemove', function(e) {
      if (container.dataset.dragging === '1') seekFromMouse(e);
    });

    window.addEventListener('resize', function() {
      if (currentPeaks) redrawWaveform();
    });
  }

  function setupAudioElementEvents() {
    audioElement.addEventListener('play', function() {
      btnPlay.textContent = '⏸';
      playhead.classList.add('visible');
    });

    audioElement.addEventListener('pause', function() {
      btnPlay.textContent = '▶';
    });

    audioElement.addEventListener('ended', function() {
      btnPlay.textContent = '▶';
      audioElement.currentTime = 0;
      updatePlayhead();
    });

    audioElement.addEventListener('timeupdate', updatePlayhead);
    audioElement.addEventListener('loadedmetadata', updateTimeLabel);
    audioElement.addEventListener('error', function() {
      loading.textContent = 'Não foi possível reproduzir este áudio no preview.';
      loading.classList.remove('hidden');
    });
  }

  async function load(filePath) {
    var token = ++loadToken;
    currentFilePath = filePath;
    currentPeaks = null;

    previewPanel.classList.remove('hidden');
    nameLabel.textContent = filePath.split(/[\\/]/).pop();
    loading.textContent = 'Carregando áudio...';
    loading.classList.remove('hidden');
    playhead.classList.remove('visible');
    clearCanvas();

    audioElement.pause();
    audioElement.currentTime = 0;
    audioElement.src = filePathToUrl(filePath);
    audioElement.volume = isMuted ? 0 : lastVolume;
    audioElement.load();

    // O áudio deve tocar mesmo se a waveform falhar.
    try {
      await audioElement.play();
    } catch (playErr) {
      // Alguns ambientes bloqueiam autoplay; o botão Play continua funcionando.
      console.warn('[AudioPreview] Autoplay bloqueado:', playErr);
    }

    if (token !== loadToken) return;

    try {
      var stat = fs.statSync(filePath);
      if (stat && stat.size > MAX_WAVEFORM_BYTES) {
        loading.textContent = 'Arquivo grande: preview de áudio ativo, waveform desativada.';
        drawPlaceholderWaveform();
        return;
      }

      await drawWaveform(filePath, token);
      if (token !== loadToken) return;
      loading.classList.add('hidden');
    } catch (err) {
      if (token !== loadToken) return;
      console.warn('[AudioPreview] Falha ao desenhar waveform:', err);
      loading.textContent = 'Preview de áudio ativo, mas a waveform não pôde ser gerada.';
      drawPlaceholderWaveform();
    }
  }

  function filePathToUrl(filePath) {
    var normalized = String(filePath).replace(/\\/g, '/');

    // Windows: G:/Pasta/arquivo.mp3 precisa manter o ':' do drive.
    if (/^[a-zA-Z]:\//.test(normalized)) {
      var drive = normalized.slice(0, 2);
      var rest = normalized.slice(3).split('/').map(encodeURIComponent).join('/');
      return 'file:///' + drive + '/' + rest;
    }

    // UNC: //server/share/file.wav
    if (normalized.indexOf('//') === 0) {
      return 'file:' + normalized.split('/').map(function(part, index) {
        return index < 2 ? part : encodeURIComponent(part);
      }).join('/');
    }

    if (normalized.charAt(0) === '/') {
      return 'file://' + normalized.split('/').map(encodeURIComponent).join('/');
    }

    return 'file:///' + normalized.split('/').map(encodeURIComponent).join('/');
  }

  async function drawWaveform(filePath, token) {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    var buffer = fs.readFileSync(filePath);
    if (token !== loadToken) return;

    var arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    var audioBuffer = await decodeAudio(arrayBuffer);
    if (token !== loadToken) return;

    var channelData = audioBuffer.getChannelData(0);
    var width = Math.max(1, container.clientWidth || 300);
    var samplesPerPixel = Math.max(1, Math.floor(channelData.length / width));
    var peaks = new Float32Array(width);

    for (var x = 0; x < width; x++) {
      var max = 0;
      var start = x * samplesPerPixel;
      var end = Math.min(start + samplesPerPixel, channelData.length);
      for (var i = start; i < end; i++) {
        var abs = Math.abs(channelData[i]);
        if (abs > max) max = abs;
      }
      peaks[x] = max;
    }

    currentPeaks = peaks;
    redrawWaveform();
  }

  function decodeAudio(arrayBuffer) {
    return new Promise(function(resolve, reject) {
      var done = false;
      try {
        var maybePromise = audioContext.decodeAudioData(arrayBuffer, function(buffer) {
          if (!done) {
            done = true;
            resolve(buffer);
          }
        }, function(err) {
          if (!done) {
            done = true;
            reject(err);
          }
        });

        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(function(buffer) {
            if (!done) {
              done = true;
              resolve(buffer);
            }
          }).catch(function(err) {
            if (!done) {
              done = true;
              reject(err);
            }
          });
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  function redrawWaveform() {
    var width = Math.max(1, container.clientWidth || 300);
    var height = Math.max(1, container.clientHeight || 60);
    var dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!currentPeaks) {
      drawPlaceholderWaveform();
      return;
    }

    var ratio = audioElement && audioElement.duration ? audioElement.currentTime / audioElement.duration : 0;
    drawPeaks(currentPeaks, width, height, ratio);
  }

  function drawPeaks(peaks, width, height, playedRatio) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, width, height);

    var middle = height / 2;
    var playedX = width * playedRatio;
    var step = peaks.length / width;

    for (var x = 0; x < width; x++) {
      var peak = peaks[Math.min(peaks.length - 1, Math.floor(x * step))] || 0;
      var barHeight = Math.max(1, peak * (height * 0.9));
      ctx.fillStyle = (x < playedX) ? COLOR_WAVE_PLAYED : COLOR_WAVE;
      ctx.fillRect(x, middle - barHeight / 2, 1, barHeight);
    }
  }

  function drawPlaceholderWaveform() {
    var width = Math.max(1, container.clientWidth || 300);
    var height = Math.max(1, container.clientHeight || 60);
    var dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = COLOR_WAVE;
    for (var x = 0; x < width; x += 8) {
      var h = 8 + Math.abs(Math.sin(x * 0.05)) * (height * 0.55);
      ctx.fillRect(x, (height - h) / 2, 2, h);
    }
  }

  function clearCanvas() {
    if (!ctx || !container) return;
    var width = Math.max(1, container.clientWidth || 300);
    var height = Math.max(1, container.clientHeight || 60);
    ctx.clearRect(0, 0, width, height);
  }

  function seekFromMouse(e) {
    if (!audioElement || !audioElement.duration) return;
    var rect = container.getBoundingClientRect();
    var ratio = (e.clientX - rect.left) / rect.width;
    ratio = Math.max(0, Math.min(1, ratio));
    audioElement.currentTime = audioElement.duration * ratio;
    updatePlayhead();
  }

  function togglePlay() {
    if (!audioElement || !audioElement.src) return;
    if (audioElement.paused) {
      audioElement.play().catch(function(err) {
        console.warn('[AudioPreview] play falhou:', err);
      });
    } else {
      audioElement.pause();
    }
  }

  function setVolume(vol) {
    lastVolume = Math.max(0, Math.min(1, vol));
    if (lastVolume > 0) isMuted = false;
    else isMuted = true;
    audioElement.volume = isMuted ? 0 : lastVolume;
    volumeIcon.textContent = isMuted || lastVolume === 0 ? '🔇' : (lastVolume < 0.5 ? '🔉' : '🔊');
  }

  function toggleMute() {
    isMuted = !isMuted;
    audioElement.volume = isMuted ? 0 : lastVolume;
    volumeIcon.textContent = isMuted ? '🔇' : (lastVolume < 0.5 ? '🔉' : '🔊');
  }

  function updatePlayhead() {
    if (!audioElement || !audioElement.duration) {
      updateTimeLabel();
      return;
    }
    var ratio = audioElement.currentTime / audioElement.duration;
    var width = container.clientWidth || 1;
    playhead.style.left = (width * ratio) + 'px';
    playhead.classList.add('visible');
    updateTimeLabel();
    if (currentPeaks) redrawWaveform();
  }

  function updateTimeLabel() {
    if (!audioElement) return;
    var cur = formatTime(audioElement.currentTime || 0);
    var dur = formatTime(audioElement.duration || 0);
    timeLabel.textContent = cur + ' / ' + dur;
  }

  function formatTime(seconds) {
    if (!isFinite(seconds)) return '0:00';
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  function hide() {
    loadToken++;
    if (audioElement) {
      audioElement.pause();
      audioElement.removeAttribute('src');
      audioElement.load();
    }
    if (previewPanel) previewPanel.classList.add('hidden');
    if (playhead) playhead.classList.remove('visible');
    currentFilePath = null;
    currentPeaks = null;
  }

  function stop() {
    if (!audioElement) return;
    audioElement.pause();
    try { audioElement.currentTime = 0; } catch (e) {}
    updatePlayhead();
  }

  return { init: init, load: load, hide: hide, stop: stop, togglePlay: togglePlay, filePathToUrl: filePathToUrl };
})();
