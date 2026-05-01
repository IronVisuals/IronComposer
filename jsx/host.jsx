/**
 * host.jsx — IronComposer v2.1
 * Roda dentro do Premiere Pro / ExtendScript. Use ES3 apenas.
 */

function importAndInsert(filePath) {
    try {
        if (!app.project) {
            return makeResponse({success: false, error: "Nenhum projeto aberto."});
        }

        var sequence = app.project.activeSequence;
        if (!sequence) {
            return makeResponse({success: false, error: "Nenhuma sequencia ativa. Abra ou crie uma timeline."});
        }

        var fileObj = new File(filePath);
        if (!fileObj.exists) {
            return makeResponse({success: false, error: "Arquivo nao existe no disco: " + filePath});
        }

        var ext = getExtension(filePath);
        var mediaKind = getMediaKind(ext);
        if (mediaKind === "unknown") {
            return makeResponse({success: false, error: "Tipo de arquivo nao suportado: " + ext});
        }

        try { app.project.save(); } catch (saveErr) {}

        var cti = sequence.getPlayerPosition();
        var ctiSeconds = timeToSeconds(cti);
        var ctiTicks = getTimeTicks(cti);
        var clipDuration = 5;

        var bin = findOrCreateBin("IronComposer");
        if (!bin) {
            return makeResponse({success: false, error: "Falha ao criar ou localizar o Bin IronComposer."});
        }

        if (mediaKind === "mogrt") {
            var mgtDuration = 5;
            var mgtPlacement = findSafePlacement(sequence, "mogrt", ctiSeconds, mgtDuration);
            if (!mgtPlacement.success) return makeResponse(mgtPlacement);

            try {
                var mgtItem = sequence.importMGT(fileObj.fsName, ctiTicks, mgtPlacement.videoTrackIndex, mgtPlacement.audioTrackIndex);
                if (!mgtItem) {
                    return makeResponse({success: false, error: "Premiere recusou inserir o MOGRT."});
                }
                return makeResponse({
                    success: true,
                    mediaKind: mediaKind,
                    method: "importMGT",
                    videoTrackIndex: mgtPlacement.videoTrackIndex,
                    audioTrackIndex: mgtPlacement.audioTrackIndex,
                    duration: mgtDuration
                });
            } catch (mgtErr) {
                return makeResponse({success: false, error: "Falha ao inserir MOGRT: " + mgtErr.toString()});
            }
        }

        var projectItem = findProjectItemByMediaPath(bin, fileObj.fsName);
        if (!projectItem) {
            var imported = app.project.importFiles([fileObj.fsName], true, bin, false);
            if (!imported) {
                return makeResponse({success: false, error: "Premiere recusou importar o arquivo para o Projeto."});
            }

            $.sleep(200);
            projectItem = findProjectItemByMediaPath(bin, fileObj.fsName);

            if (!projectItem) {
                projectItem = findProjectItemByName(bin, fileObj.name);
            }
        }

        if (!projectItem) {
            return makeResponse({success: false, error: "Arquivo importado, mas nao localizado no Bin IronComposer."});
        }

        clipDuration = getClipDurationSeconds(projectItem, mediaKind);
        if (clipDuration <= 0) clipDuration = mediaKind === "image" ? 5 : 1;

        var placement = findSafePlacement(sequence, mediaKind, ctiSeconds, clipDuration);
        if (!placement.success) return makeResponse(placement);

        var inserted = overwriteAtPlacement(sequence, projectItem, ctiSeconds, ctiTicks, placement);
        if (!inserted.success) return makeResponse(inserted);

        return makeResponse({
            success: true,
            mediaKind: mediaKind,
            method: inserted.method,
            videoTrackIndex: placement.videoTrackIndex,
            audioTrackIndex: placement.audioTrackIndex,
            duration: clipDuration
        });

    } catch (err) {
        return makeResponse({success: false, error: "Excecao no host.jsx: " + err.toString()});
    }
}

function overwriteAtPlacement(sequence, projectItem, ctiSeconds, ctiTicks, placement) {
    var vIdx = placement.videoTrackIndex;
    var aIdx = placement.audioTrackIndex;

    // Preferimos Sequence.overwriteClip porque permite definir videoTrackIndex e audioTrackIndex.
    try {
        if (sequence.overwriteClip) {
            var ok = sequence.overwriteClip(projectItem, ctiSeconds, vIdx < 0 ? 0 : vIdx, aIdx < 0 ? 0 : aIdx);
            if (ok || typeof ok === "undefined") return {success: true, method: "sequence.overwriteClip.seconds"};
        }
    } catch (e1) {}

    try {
        if (sequence.overwriteClip) {
            var okTicks = sequence.overwriteClip(projectItem, ctiTicks, vIdx < 0 ? 0 : vIdx, aIdx < 0 ? 0 : aIdx);
            if (okTicks || typeof okTicks === "undefined") return {success: true, method: "sequence.overwriteClip.ticks"};
        }
    } catch (e2) {}

    // Fallback para API Track.overwriteClip. Menos preciso, mas ainda respeita nossa checagem de faixa vazia.
    try {
        if (vIdx >= 0 && sequence.videoTracks && sequence.videoTracks.numTracks > vIdx) {
            sequence.videoTracks[vIdx].overwriteClip(projectItem, ctiSeconds);
            return {success: true, method: "track.video.overwriteClip.seconds"};
        }
        if (aIdx >= 0 && sequence.audioTracks && sequence.audioTracks.numTracks > aIdx) {
            sequence.audioTracks[aIdx].overwriteClip(projectItem, ctiSeconds);
            return {success: true, method: "track.audio.overwriteClip.seconds"};
        }
    } catch (e3) {
        return {success: false, error: "Falha ao inserir na timeline: " + e3.toString()};
    }

    return {success: false, error: "Falha ao inserir: nenhum metodo de overwrite funcionou neste Premiere."};
}

function findSafePlacement(sequence, mediaKind, startSeconds, durationSeconds) {
    if (durationSeconds <= 0) durationSeconds = 1;

    var vTracks = sequence.videoTracks;
    var aTracks = sequence.audioTracks;
    var vCount = vTracks ? vTracks.numTracks : 0;
    var aCount = aTracks ? aTracks.numTracks : 0;

    if (mediaKind === "audio") {
        if (aCount <= 0) return {success: false, error: "A sequencia nao tem trilhas de audio."};
        for (var a = 0; a < aCount; a++) {
            if (isTrackRegionEmpty(aTracks[a], startSeconds, durationSeconds)) {
                return {success: true, videoTrackIndex: 0, audioTrackIndex: a};
            }
        }
        return {success: false, error: "Nao ha trilha de audio vazia no intervalo da agulha. Adicione uma trilha de audio vazia ou mova a agulha."};
    }

    if (vCount <= 0) return {success: false, error: "A sequencia nao tem trilhas de video."};

    if (mediaKind === "image") {
        for (var vi = 0; vi < vCount; vi++) {
            if (isTrackRegionEmpty(vTracks[vi], startSeconds, durationSeconds)) {
                return {success: true, videoTrackIndex: vi, audioTrackIndex: aCount > 0 ? 0 : -1};
            }
        }
        return {success: false, error: "Nao ha trilha de video vazia no intervalo da agulha. Adicione uma trilha de video vazia ou mova a agulha."};
    }

    // Video e MOGRT: escolhe par V/A livre para evitar sobrescrever audio linkado.
    var maxPairs = Math.max(vCount, aCount);
    for (var i = 0; i < maxPairs; i++) {
        if (i < vCount && isTrackRegionEmpty(vTracks[i], startSeconds, durationSeconds)) {
            if (aCount <= 0 || (i < aCount && isTrackRegionEmpty(aTracks[i], startSeconds, durationSeconds))) {
                return {success: true, videoTrackIndex: i, audioTrackIndex: (aCount > 0 && i < aCount) ? i : 0};
            }
        }
    }

    // Fallback: qualquer V livre + qualquer A livre.
    for (var v = 0; v < vCount; v++) {
        if (!isTrackRegionEmpty(vTracks[v], startSeconds, durationSeconds)) continue;
        if (aCount <= 0) return {success: true, videoTrackIndex: v, audioTrackIndex: -1};
        for (var aa = 0; aa < aCount; aa++) {
            if (isTrackRegionEmpty(aTracks[aa], startSeconds, durationSeconds)) {
                return {success: true, videoTrackIndex: v, audioTrackIndex: aa};
            }
        }
    }

    return {success: false, error: "Nao encontrei um par de trilhas V/A vazio no intervalo da agulha. Para proteger sua timeline, nada foi inserido."};
}

function isTrackRegionEmpty(track, startSeconds, durationSeconds) {
    if (!track) return false;

    try {
        if (track.isLocked && track.isLocked()) return false;
    } catch (lockErr) {}

    var endSeconds = startSeconds + durationSeconds;
    var clips = track.clips;
    if (!clips) return true;

    for (var c = 0; c < clips.numItems; c++) {
        var clip = clips[c];
        var cStart = timeToSeconds(clip.start);
        var cEnd = timeToSeconds(clip.end);
        if (startSeconds < (cEnd - 0.001) && endSeconds > (cStart + 0.001)) {
            return false;
        }
    }
    return true;
}

function findOrCreateBin(binName) {
    var rootItem = app.project.rootItem;
    var existing = findBinByName(rootItem, binName);
    if (existing) return existing;
    return rootItem.createBin(binName);
}

function findBinByName(parent, binName) {
    if (!parent || !parent.children) return null;
    for (var i = 0; i < parent.children.numItems; i++) {
        var child = parent.children[i];
        if (child.name === binName && isBin(child)) return child;
    }
    return null;
}

function isBin(item) {
    try {
        if (item.type === 2) return true;
        if (typeof ProjectItemType !== "undefined" && item.type === ProjectItemType.BIN) return true;
    } catch (e) {}
    return false;
}

function findProjectItemByMediaPath(parent, mediaPath) {
    var target = normalizePathForCompare(mediaPath);
    if (!parent || !parent.children) return null;

    for (var i = 0; i < parent.children.numItems; i++) {
        var child = parent.children[i];
        if (isBin(child)) {
            var foundInBin = findProjectItemByMediaPath(child, mediaPath);
            if (foundInBin) return foundInBin;
        } else {
            try {
                if (child.getMediaPath) {
                    var childPath = child.getMediaPath();
                    if (normalizePathForCompare(childPath) === target) return child;
                }
            } catch (e) {}
        }
    }
    return null;
}

function findProjectItemByName(parent, fileName) {
    var noExt = fileName.replace(/\.[^.]+$/, "");
    if (!parent || !parent.children) return null;

    for (var i = parent.children.numItems - 1; i >= 0; i--) {
        var child = parent.children[i];
        if (isBin(child)) {
            var found = findProjectItemByName(child, fileName);
            if (found) return found;
        } else if (child.name === fileName || child.name === noExt) {
            return child;
        }
    }
    return null;
}

function getClipDurationSeconds(projectItem, mediaKind) {
    if (mediaKind === "image") return 5;

    try {
        if (projectItem.getOutPoint && projectItem.getInPoint) {
            var inP = projectItem.getInPoint();
            var outP = projectItem.getOutPoint();
            var dur = timeToSeconds(outP) - timeToSeconds(inP);
            if (dur > 0) return dur;
        }
    } catch (e1) {}

    try {
        if (projectItem.duration) {
            var d = timeToSeconds(projectItem.duration);
            if (d > 0) return d;
        }
    } catch (e2) {}

    try {
        var meta = projectItem.getProjectMetadata();
        var match = meta.match(/<premierePrivateProjectMetaData:Column.Intrinsic.MediaDuration>([^<]+)/);
        if (match && match[1]) {
            var parsed = parseDurationText(match[1]);
            if (parsed > 0) return parsed;
        }
    } catch (e3) {}

    return mediaKind === "audio" ? 1 : 5;
}

function parseDurationText(value) {
    if (!value) return 0;
    var parts = String(value).split(":");
    if (parts.length >= 3) {
        var h = parseFloat(parts[0]) || 0;
        var m = parseFloat(parts[1]) || 0;
        var s = parseFloat(parts[2]) || 0;
        return (h * 3600) + (m * 60) + s;
    }
    var n = parseFloat(value);
    return isNaN(n) ? 0 : n;
}

function getExtension(filePath) {
    var dot = filePath.lastIndexOf(".");
    if (dot < 0) return "";
    return filePath.substring(dot).toLowerCase();
}

function getMediaKind(ext) {
    if (isInArray(ext, [".wav", ".mp3", ".aac", ".aif", ".aiff", ".flac", ".ogg", ".m4a", ".wma"])) return "audio";
    if (isInArray(ext, [".mp4", ".mov", ".avi", ".mkv", ".mxf", ".r3d", ".webm", ".m4v", ".mpg", ".mpeg", ".mts", ".m2ts"])) return "video";
    if (isInArray(ext, [".jpg", ".jpeg", ".png", ".tiff", ".tif", ".psd", ".ai", ".gif", ".bmp", ".webp", ".heic"])) return "image";
    if (ext === ".mogrt") return "mogrt";
    return "unknown";
}

function isInArray(value, arr) {
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] === value) return true;
    }
    return false;
}

function timeToSeconds(t) {
    try {
        if (t && typeof t.seconds !== "undefined") return Number(t.seconds);
    } catch (e1) {}
    var n = Number(t);
    if (!isNaN(n)) return n;
    return 0;
}

function getTimeTicks(t) {
    try {
        if (t && typeof t.ticks !== "undefined") return String(t.ticks);
    } catch (e1) {}
    return String(timeToSeconds(t));
}

function normalizePathForCompare(p) {
    return String(p || "").replace(/\\/g, "/").replace(/^file:\/\/\//i, "").toLowerCase();
}

function selectFolderDialog(title) {
    try {
        var folder = Folder.selectDialog(title || "Selecionar pasta de midias");
        if (!folder) return "__CANCELLED__";
        return folder.fsName;
    } catch (e) {
        return "__CANCELLED__";
    }
}

function ping() {
    return makeResponse({success: true, message: "IronComposer host.jsx esta vivo"});
}

function makeResponse(obj) {
    try {
        if (typeof JSON !== "undefined" && JSON.stringify) return JSON.stringify(obj);
    } catch (e) {}

    var parts = [];
    for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
            parts.push('"' + jsonEscape(key) + '":' + jsonValue(obj[key]));
        }
    }
    return "{" + parts.join(",") + "}";
}

function jsonValue(value) {
    if (typeof value === "number") return isFinite(value) ? String(value) : "0";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value === null || typeof value === "undefined") return "null";
    return '"' + jsonEscape(String(value)) + '"';
}

function jsonEscape(str) {
    return String(str)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "\\\"")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t");
}

$.writeln("[IronComposer] host.jsx v2.1 carregado.");
