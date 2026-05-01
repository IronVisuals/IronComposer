/**
 * host.jsx — IronComposer
 * Roda DENTRO do motor do Premiere Pro (ExtendScript ES3).
 * IMPORTANTE: Não use let, const, arrow functions. Use var e function.
 *
 * Fluxo da função importAndInsert:
 *   1. Valida projeto e sequência ativa
 *   2. Cria/acha o Bin "IronComposer" no Painel de Projeto
 *   3. Importa o arquivo no Bin (ou reusa se já existe)
 *   4. Encontra uma TRILHA VAZIA (sem clipes na região do CTI até CTI+duração)
 *   5. Insere com overwriteClip — seguro porque a trilha está vazia ali
 */

// ============================================================
// FUNÇÃO PRINCIPAL (chamada pelo painel via evalScript)
// ============================================================
function importAndInsert(filePath) {
    try {
        if (!app.project) {
            return JSON.stringify({success: false, error: "Nenhum projeto aberto."});
        }

        var sequence = app.project.activeSequence;
        if (!sequence) {
            return JSON.stringify({success: false, error: "Nenhuma sequencia ativa. Abra ou crie uma timeline."});
        }

        var fileObj = new File(filePath);
        if (!fileObj.exists) {
            return JSON.stringify({success: false, error: "Arquivo nao existe no disco: " + filePath});
        }

        // Salva preventivamente (proteção contra crashes)
        try { app.project.save(); } catch (saveErr) { /* ignora */ }

        // 1. Cria/acha Bin "IronComposer"
        var bin = findOrCreateBin("IronComposer");
        if (!bin) {
            return JSON.stringify({success: false, error: "Falha ao criar Bin IronComposer."});
        }

        // 2. Verifica se item já existe no Bin (evita reimportar e duplicar)
        var fileName = fileObj.name;
        var fileNameNoExt = fileName.replace(/\.[^.]+$/, "");
        var projectItem = findItemInBin(bin, fileName, fileNameNoExt);

        // 3. Se não existe, importa
        if (!projectItem) {
            var imported = app.project.importFiles([filePath], true, bin, false);
            if (!imported) {
                return JSON.stringify({success: false, error: "Premiere recusou importar o arquivo."});
            }

            // Pequena pausa para garantir que o item esteja disponível
            $.sleep(150);

            projectItem = findItemInBin(bin, fileName, fileNameNoExt);

            // Fallback: pega o último item adicionado ao Bin
            if (!projectItem && bin.children.numItems > 0) {
                projectItem = bin.children[bin.children.numItems - 1];
            }
        }

        if (!projectItem) {
            return JSON.stringify({success: false, error: "Item importado mas nao localizado no Bin."});
        }

        // 4 + 5. Insere com lógica inteligente
        return insertSmart(projectItem, sequence, filePath);

    } catch (err) {
        return JSON.stringify({success: false, error: "Excecao: " + err.toString()});
    }
}

// ============================================================
// FUNÇÃO: insertSmart — Insere protegendo a timeline existente
// ============================================================
function insertSmart(projectItem, sequence, filePath) {
    try {
        // Pega a posição da agulha (CTI - Current Time Indicator)
        var cti = sequence.getPlayerPosition();
        var ctiSeconds = cti.seconds;

        // Determina se é áudio
        var ext = "";
        var dotIdx = filePath.lastIndexOf(".");
        if (dotIdx > -1) ext = filePath.substring(dotIdx).toLowerCase();
        var isAudio = isAudioExtension(ext);

        // Calcula duração do clipe
        var clipDuration = getClipDurationSeconds(projectItem);
        if (clipDuration <= 0) clipDuration = 5; // fallback de segurança

        // Procura uma trilha que tenha ESPAÇO VAZIO entre CTI e CTI+duração
        var tracks = isAudio ? sequence.audioTracks : sequence.videoTracks;
        var emptyIdx = findEmptyTrackIndex(tracks, ctiSeconds, clipDuration);

        if (emptyIdx === -1) {
            // Todas as trilhas têm conflito — informa ao usuário
            return JSON.stringify({
                success: false,
                error: "Todas as trilhas " + (isAudio ? "de audio" : "de video") +
                       " tem clipes na posicao da agulha. Adicione uma nova trilha manualmente (botao direito > Adicionar trilha) e tente novamente."
            });
        }

        // overwriteClip é seguro aqui porque confirmamos que a região está vazia
        var targetTrack = tracks[emptyIdx];
        targetTrack.overwriteClip(projectItem, ctiSeconds);

        return JSON.stringify({
            success: true,
            trackIndex: emptyIdx,
            trackType: isAudio ? "audio" : "video",
            duration: clipDuration
        });

    } catch (err) {
        return JSON.stringify({success: false, error: "Falha ao inserir: " + err.toString()});
    }
}

// ============================================================
// HELPER: findOrCreateBin
// ============================================================
function findOrCreateBin(binName) {
    var rootItem = app.project.rootItem;
    for (var i = 0; i < rootItem.children.numItems; i++) {
        var child = rootItem.children[i];
        if (child.name === binName && child.type === 2) { // type 2 = Bin
            return child;
        }
    }
    return rootItem.createBin(binName);
}

// ============================================================
// HELPER: findItemInBin
// ============================================================
function findItemInBin(bin, fullName, nameNoExt) {
    for (var i = 0; i < bin.children.numItems; i++) {
        var n = bin.children[i].name;
        if (n === fullName || n === nameNoExt) {
            return bin.children[i];
        }
    }
    return null;
}

// ============================================================
// HELPER: getClipDurationSeconds
// Tenta múltiplas formas de obter a duração (compatibilidade)
// ============================================================
function getClipDurationSeconds(projectItem) {
    try {
        if (projectItem.getOutPoint && projectItem.getInPoint) {
            var inP = projectItem.getInPoint();
            var outP = projectItem.getOutPoint();
            if (inP && outP) {
                var dur = outP.seconds - inP.seconds;
                if (dur > 0) return dur;
            }
        }
    } catch (e) {}

    try {
        if (projectItem.duration && projectItem.duration.seconds) {
            return projectItem.duration.seconds;
        }
    } catch (e) {}

    // Fallback: tenta pegar via metadata
    try {
        var meta = projectItem.getProjectMetadata();
        var match = meta.match(/<premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>([^<]+)/);
        if (match && match[1]) {
            // Vem em formato HH:MM:SS:FF — converte
            var parts = match[1].split(":");
            if (parts.length >= 3) {
                var h = parseFloat(parts[0]) || 0;
                var m = parseFloat(parts[1]) || 0;
                var s = parseFloat(parts[2]) || 0;
                return (h * 3600) + (m * 60) + s;
            }
        }
    } catch (e) {}

    return 5; // default 5 segundos
}

// ============================================================
// HELPER: isAudioExtension
// ============================================================
function isAudioExtension(ext) {
    var audioExts = [".wav", ".mp3", ".aac", ".aif", ".aiff", ".flac", ".ogg", ".m4a"];
    for (var i = 0; i < audioExts.length; i++) {
        if (audioExts[i] === ext) return true;
    }
    return false;
}

// ============================================================
// HELPER: findEmptyTrackIndex
// Retorna o índice da PRIMEIRA trilha que está vazia
// na região [startTime, startTime + duration].
// Retorna -1 se nenhuma trilha tem espaço.
// ============================================================
function findEmptyTrackIndex(tracks, startTime, duration) {
    var endTime = startTime + duration;
    var numTracks = tracks.numTracks;

    for (var t = 0; t < numTracks; t++) {
        var track = tracks[t];

        // Pula trilhas bloqueadas (locked)
        try {
            if (track.isLocked && track.isLocked()) continue;
        } catch (e) {}

        var clips = track.clips;
        var hasOverlap = false;

        for (var c = 0; c < clips.numItems; c++) {
            var clip = clips[c];
            var cStart = clip.start.seconds;
            var cEnd = clip.end.seconds;

            // Sobreposição: o intervalo [startTime,endTime] cruza [cStart,cEnd]
            // Pequena tolerância de 0.001s para evitar erros de ponto flutuante
            if (startTime < (cEnd - 0.001) && endTime > (cStart + 0.001)) {
                hasOverlap = true;
                break;
            }
        }

        if (!hasOverlap) return t;
    }

    return -1; // Nenhuma trilha vazia
}

// ============================================================
// FUNÇÃO AUXILIAR: ping (teste de conexão com o painel)
// ============================================================
function ping() {
    return JSON.stringify({success: true, message: "IronComposer host.jsx esta vivo"});
}

$.writeln("[IronComposer] host.jsx carregado.");
