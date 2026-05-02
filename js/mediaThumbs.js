/**
 * mediaThumbs.js - Inline waveform/thumbnail previews for the asset grid.
 */

'use strict';

window.MediaThumbs = (function() {
  var fs = null;
  var audioContext = null;
  var observer = null;
  var rootEl = null;

  var audioQueue = [];
  var videoQueue = [];
  var audioBusy = false;
  var videoBusy = 0;

  var audioCache = new Map();
  var videoCache = new Map();
  var previewVersion = 0;

  var MAX_AUDIO_BYTES = 55 * 1024 * 1024;
  var MAX_CACHE_ITEMS = 260;
  var AUDIO_PEAKS = 120;
  var MAX_VIDEO_WORKERS = 2;

  var AUDIO_EXT = new Set(['.wav', '.mp3', '.aac', '.aif', '.aiff', '.flac', '.ogg', '.m4a', '.wma']);
  var VIDEO_EXT = new Set(['.mp4', '.mov', '.avi', '.mkv', '.mxf', '.r3d', '.webm', '.m4v', '.mpg', '.mpeg', '.mts', '.m2ts']);
  var IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.gif', '.bmp', '.webp']);

  function getNodeRequire() {
    if (typeof require === 'function') return require;
    if (window.cep_node && typeof window.cep_node.require === 'function') return window.cep_node.require;
    throw new Error('Node.js nao esta habilitado no CEP.');
  }

  function init() {
    try {
      fs = getNodeRequire()('fs');
    } catch (e) {
      fs = null;
    }

    rootEl = document.getElementById('file-list-container');
    reset();
  }

  function reset() {
    previewVersion += 1;
    audioQueue = [];
    videoQueue = [];

    if (observer) observer.disconnect();
    stopVisibleVideos();

    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(handleIntersection, {
        root: rootEl || null,
        rootMargin: '180px',
        threshold: 0.01
      });
    } else {
      observer = null;
    }
  }

  function observe(item, file) {
    if (!item || !file) return;

    item.__ironThumbFile = file;
    drawInitialPreview(item, file);
    setupVideoHover(item, file);

    if (observer) observer.observe(item);
    else loadPreview(item);
  }

  function handleIntersection(entries) {
    entries.forEach(function(entry) {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      loadPreview(entry.target);
    });
  }

  function loadPreview(item) {
    if (!item || !item.__ironThumbFile || !item.isConnected) return;
    var file = item.__ironThumbFile;

    if (AUDIO_EXT.has(file.ext)) {
      enqueueAudio(item, file);
      return;
    }

    if (VIDEO_EXT.has(file.ext)) {
      enqueueVideo(item, file);
      return;
    }

    if (IMAGE_EXT.has(file.ext)) {
      loadImage(item, file);
      return;
    }

    drawGenericPreview(getCanvas(item), file);
  }

  function drawInitialPreview(item, file) {
    var canvas = getCanvas(item);
    if (!canvas) return;

    if (AUDIO_EXT.has(file.ext)) drawSeededWaveform(canvas, file.fullPath);
    else if (VIDEO_EXT.has(file.ext)) drawVideoPlaceholder(canvas, file);
    else if (IMAGE_EXT.has(file.ext)) drawImagePlaceholder(canvas, file);
    else drawGenericPreview(canvas, file);
  }

  function enqueueAudio(item, file) {
    var canvas = getCanvas(item);
    if (!canvas) return;

    var key = cacheKey(file.fullPath);
    if (audioCache.has(key)) {
      drawAudioPeaks(canvas, audioCache.get(key));
      item.classList.add('thumb-ready');
      return;
    }

    audioQueue.push({ item: item, file: file, canvas: canvas, key: key, version: previewVersion });
    pumpAudioQueue();
  }

  function pumpAudioQueue() {
    if (audioBusy || audioQueue.length === 0) return;
    audioBusy = true;

    var job = audioQueue.shift();
    buildAudioPreview(job).then(function(peaks) {
      if (peaks && job.version === previewVersion) {
        setCache(audioCache, job.key, peaks);
        if (job.item.isConnected) {
          drawAudioPeaks(job.canvas, peaks);
          job.item.classList.add('thumb-ready');
        }
      }
    }).catch(function(err) {
      console.warn('[MediaThumbs] Waveform inline falhou:', job.file.fullPath, err);
      if (job.version === previewVersion && job.item.isConnected) drawSeededWaveform(job.canvas, job.file.fullPath);
    }).then(function() {
      audioBusy = false;
      setTimeout(pumpAudioQueue, 0);
    });
  }

  async function buildAudioPreview(job) {
    if (!fs || !job.item.isConnected || job.version !== previewVersion) return null;

    var stat = fs.statSync(job.file.fullPath);
    if (stat && stat.size > MAX_AUDIO_BYTES) return seededPeaks(job.file.fullPath);

    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();

    var buffer = await readFile(job.file.fullPath);
    if (!job.item.isConnected || job.version !== previewVersion) return null;

    var arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    var audioBuffer = await decodeAudio(arrayBuffer);
    if (!job.item.isConnected || job.version !== previewVersion) return null;

    return makePeaks(audioBuffer);
  }

  function readFile(filePath) {
    return new Promise(function(resolve, reject) {
      fs.readFile(filePath, function(err, data) {
        if (err) reject(err);
        else resolve(data);
      });
    });
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

  function makePeaks(audioBuffer) {
    var data = audioBuffer.getChannelData(0);
    var peaks = [];
    var samplesPerPeak = Math.max(1, Math.floor(data.length / AUDIO_PEAKS));

    for (var i = 0; i < AUDIO_PEAKS; i++) {
      var start = i * samplesPerPeak;
      var end = Math.min(start + samplesPerPeak, data.length);
      var max = 0;

      for (var j = start; j < end; j++) {
        var abs = Math.abs(data[j]);
        if (abs > max) max = abs;
      }

      peaks.push(max);
    }

    return peaks;
  }

  function enqueueVideo(item, file) {
    var canvas = getCanvas(item);
    if (!canvas) return;

    var key = cacheKey(file.fullPath);
    if (videoCache.has(key)) {
      drawCachedImage(canvas, videoCache.get(key), function() {
        drawVideoPlaceholder(canvas, file);
      });
      item.classList.add('thumb-ready');
      return;
    }

    videoQueue.push({ item: item, file: file, canvas: canvas, key: key, version: previewVersion });
    pumpVideoQueue();
  }

  function pumpVideoQueue() {
    while (videoBusy < MAX_VIDEO_WORKERS && videoQueue.length > 0) {
      let job = videoQueue.shift();
      videoBusy += 1;

      buildVideoPreview(job).then(function(result) {
        if (result && result.version === previewVersion) {
          if (result.dataUrl) setCache(videoCache, result.key, result.dataUrl);
          if (result.item.isConnected) {
            if (result.dataUrl) {
              drawCachedImage(result.canvas, result.dataUrl, function() {
                drawVideoPlaceholder(result.canvas, result.file);
              });
            } else if (result.frameCanvas) {
              drawCanvasFrame(result.canvas, result.frameCanvas, function() {
                drawVideoPlaceholder(result.canvas, result.file);
              });
            }
            result.item.classList.add('thumb-ready');
          }
        }
      }).catch(function(err) {
        console.warn('[MediaThumbs] Thumbnail de video falhou:', job.file.fullPath, err);
        if (job.version === previewVersion && job.item.isConnected) drawVideoPlaceholder(job.canvas, job.file);
      }).then(function() {
        videoBusy -= 1;
        setTimeout(pumpVideoQueue, 0);
      });
    }
  }

  function buildVideoPreview(job) {
    return new Promise(function(resolve, reject) {
      if (!job.item.isConnected) {
        resolve(null);
        return;
      }

      var video = document.createElement('video');
      var finished = false;
      var timeout = setTimeout(function() {
        fail(new Error('timeout'));
      }, 4500);

      video.muted = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.setAttribute('playsinline', '');

      function cleanup() {
        clearTimeout(timeout);
        video.removeAttribute('src');
        try { video.load(); } catch (e) {}
      }

      function finish(dataUrl, frameCanvas) {
        if (finished) return;
        finished = true;
        cleanup();
        resolve({
          dataUrl: dataUrl,
          key: job.key,
          item: job.item,
          canvas: job.canvas,
          file: job.file,
          version: job.version,
          frameCanvas: frameCanvas || null
        });
      }

      function fail(err) {
        if (finished) return;
        finished = true;
        cleanup();
        reject(err);
      }

      video.addEventListener('loadedmetadata', function() {
        try {
          var duration = isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
          video.currentTime = Math.min(Math.max(duration * 0.15, 0.15), Math.max(duration - 0.1, 0.1));
        } catch (e) {
          fail(e);
        }
      });

      video.addEventListener('seeked', function() {
        try {
          var scratch = document.createElement('canvas');
          var width = 320;
          var height = Math.max(180, Math.round(width / ((video.videoWidth || 16) / (video.videoHeight || 9))));
          scratch.width = width;
          scratch.height = height;
          var ctx = scratch.getContext('2d');
          ctx.drawImage(video, 0, 0, width, height);
          var dataUrl = '';
          try {
            dataUrl = scratch.toDataURL('image/jpeg', 0.72);
          } catch (securityErr) {
            dataUrl = '';
          }
          finish(dataUrl, dataUrl ? null : scratch);
        } catch (e) {
          fail(e);
        }
      });

      video.addEventListener('error', function() {
        fail(new Error('video load error'));
      });

      video.src = filePathToUrl(job.file.fullPath);
      video.load();
    });
  }

  function loadImage(item, file) {
    var img = item.querySelector('.file-preview-image');
    var canvas = getCanvas(item);
    if (!img) return;

    img.onload = function() {
      item.classList.add('thumb-ready');
    };
    img.onerror = function() {
      drawImagePlaceholder(canvas, file);
    };
    img.src = filePathToUrl(file.fullPath);
  }

  function setupVideoHover(item, file) {
    if (!VIDEO_EXT.has(file.ext) || item.__ironHoverReady) return;
    item.__ironHoverReady = true;

    item.addEventListener('mouseenter', function() {
      startVideoHover(item, file);
    });

    item.addEventListener('mouseleave', function() {
      stopVideoHover(item);
    });
  }

  function startVideoHover(item, file) {
    var video = item.querySelector('.file-preview-video');
    if (!video || !item.isConnected) return;

    if (!video.src) {
      video.src = filePathToUrl(file.fullPath);
      video.preload = 'auto';
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.onerror = function() {
        item.classList.remove('video-previewing');
      };
    }

    item.classList.add('video-previewing');
    var playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(function() {
        item.classList.remove('video-previewing');
      });
    }
  }

  function stopVideoHover(item) {
    var video = item.querySelector('.file-preview-video');
    if (video) video.pause();
    item.classList.remove('video-previewing');
  }

  function stopVisibleVideos() {
    document.querySelectorAll('.file-preview-video').forEach(function(video) {
      try { video.pause(); } catch (e) {}
    });
  }

  function drawAudioPeaks(canvas, peaks) {
    var metrics = prepareCanvas(canvas);
    var ctx = metrics.ctx;
    var width = metrics.width;
    var height = metrics.height;
    var middle = height / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#101010';
    ctx.fillRect(0, 0, width, height);
    drawGrid(ctx, width, height);

    var count = peaks.length || 1;
    var barWidth = Math.max(1, Math.floor(width / count));
    var gap = barWidth > 2 ? 1 : 0;

    ctx.fillStyle = '#28d8a0';
    for (var i = 0; i < count; i++) {
      var x = Math.round(i * width / count);
      var peak = Math.max(0.04, Math.min(1, peaks[i] || 0));
      var barHeight = Math.max(2, peak * height * 0.86);
      ctx.fillRect(x, middle - barHeight / 2, Math.max(1, barWidth - gap), barHeight);
    }
  }

  function drawSeededWaveform(canvas, seed) {
    drawAudioPeaks(canvas, seededPeaks(seed));
  }

  function seededPeaks(seed) {
    var peaks = [];
    var n = 0;
    var str = String(seed || 'ironcomposer');

    for (var i = 0; i < str.length; i++) {
      n = (n * 31 + str.charCodeAt(i)) >>> 0;
    }

    for (var j = 0; j < AUDIO_PEAKS; j++) {
      n = (1664525 * n + 1013904223) >>> 0;
      var wave = 0.2 + (n / 4294967295) * 0.72;
      peaks.push(wave);
    }

    return peaks;
  }

  function drawVideoPlaceholder(canvas, file) {
    var metrics = prepareCanvas(canvas);
    var ctx = metrics.ctx;
    var width = metrics.width;
    var height = metrics.height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#101010';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#1f2f38';
    ctx.fillRect(0, height - 18, width, 18);

    ctx.fillStyle = '#4fc3f7';
    ctx.beginPath();
    ctx.moveTo(width / 2 - 9, height / 2 - 12);
    ctx.lineTo(width / 2 - 9, height / 2 + 12);
    ctx.lineTo(width / 2 + 13, height / 2);
    ctx.closePath();
    ctx.fill();

    drawExtLabel(ctx, file, width, height);
  }

  function drawImagePlaceholder(canvas, file) {
    var metrics = prepareCanvas(canvas);
    var ctx = metrics.ctx;
    var width = metrics.width;
    var height = metrics.height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#151515';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#d29922';
    ctx.strokeRect(14, 14, width - 28, height - 28);
    ctx.beginPath();
    ctx.moveTo(18, height - 18);
    ctx.lineTo(width * 0.42, height * 0.48);
    ctx.lineTo(width * 0.6, height * 0.66);
    ctx.lineTo(width - 18, height * 0.35);
    ctx.stroke();
    drawExtLabel(ctx, file, width, height);
  }

  function drawGenericPreview(canvas, file) {
    var metrics = prepareCanvas(canvas);
    var ctx = metrics.ctx;
    var width = metrics.width;
    var height = metrics.height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#161616';
    ctx.fillRect(0, 0, width, height);
    drawExtLabel(ctx, file, width, height);
  }

  function drawCanvasFrame(canvas, sourceCanvas, fallback) {
    try {
      var metrics = prepareCanvas(canvas);
      var ctx = metrics.ctx;
      var width = metrics.width;
      var height = metrics.height;
      var scale = Math.max(width / sourceCanvas.width, height / sourceCanvas.height);
      var drawW = sourceCanvas.width * scale;
      var drawH = sourceCanvas.height * scale;
      var dx = (width - drawW) / 2;
      var dy = (height - drawH) / 2;

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(sourceCanvas, dx, dy, drawW, drawH);
      drawPlayGlyph(ctx, width, height);
    } catch (e) {
      if (fallback) fallback();
    }
  }

  function drawCachedImage(canvas, dataUrl, fallback) {
    var img = new Image();
    img.onload = function() {
      var metrics = prepareCanvas(canvas);
      var ctx = metrics.ctx;
      var width = metrics.width;
      var height = metrics.height;
      var scale = Math.max(width / img.width, height / img.height);
      var drawW = img.width * scale;
      var drawH = img.height * scale;
      var dx = (width - drawW) / 2;
      var dy = (height - drawH) / 2;

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, dx, dy, drawW, drawH);
      drawPlayGlyph(ctx, width, height);
    };
    img.onerror = fallback;
    img.src = dataUrl;
  }

  function drawPlayGlyph(ctx, width, height) {
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 17, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(width / 2 - 5, height / 2 - 8);
    ctx.lineTo(width / 2 - 5, height / 2 + 8);
    ctx.lineTo(width / 2 + 8, height / 2);
    ctx.closePath();
    ctx.fill();
  }

  function drawGrid(ctx, width, height) {
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = 1;
    for (var x = 0; x < width; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }

  function drawExtLabel(ctx, file, width, height) {
    var label = String(file.ext || '').replace('.', '').toUpperCase() || 'FILE';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(6, height - 22, Math.min(54, label.length * 7 + 14), 16);
    ctx.fillStyle = '#cfcfcf';
    ctx.font = '10px Segoe UI, Arial, sans-serif';
    ctx.fillText(label, 13, height - 10);
  }

  function prepareCanvas(canvas) {
    var parent = canvas.parentElement;
    var width = Math.max(96, Math.round((parent && parent.clientWidth) || canvas.clientWidth || 150));
    var height = Math.max(56, Math.round((parent && parent.clientHeight) || canvas.clientHeight || 78));
    var dpr = window.devicePixelRatio || 1;
    var ctx = canvas.getContext('2d');

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return { ctx: ctx, width: width, height: height };
  }

  function getCanvas(item) {
    return item ? item.querySelector('.file-preview-canvas') : null;
  }

  function setCache(cache, key, value) {
    cache.set(key, value);
    if (cache.size <= MAX_CACHE_ITEMS) return;
    var firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }

  function cacheKey(filePath) {
    return String(filePath || '').replace(/\\/g, '/').toLowerCase();
  }

  function filePathToUrl(filePath) {
    if (window.AudioPreview && typeof window.AudioPreview.filePathToUrl === 'function') {
      return window.AudioPreview.filePathToUrl(filePath);
    }

    var normalized = String(filePath).replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(normalized)) {
      var drive = normalized.slice(0, 2);
      var rest = normalized.slice(3).split('/').map(encodeURIComponent).join('/');
      return 'file:///' + drive + '/' + rest;
    }
    return 'file:///' + normalized.split('/').map(encodeURIComponent).join('/');
  }

  return {
    init: init,
    reset: reset,
    observe: observe
  };
})();
