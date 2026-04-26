/**
 * host.jsx — IronComposer (Versão com Inserção Inteligente na Timeline)
 */

function importAndInsert(filePath) {
    if (!app.project) return "Erro: Nenhum projeto aberto.";
    
    var sequence = app.project.activeSequence;
    if (!sequence) return "Erro: Nenhuma sequencia ativa.";

    var fileToImport = new File(filePath);
    if (!fileToImport.exists) return "Erro: Arquivo nao existe no disco.";

    try {
        // 1. Criar ou achar o Bin "IronComposer" no projeto
        var bin = null;
        for (var i = 0; i < app.project.rootItem.children.numItems; i++) {
            if (app.project.rootItem.children[i].name === "IronComposer") {
                bin = app.project.rootItem.children[i];
                break;
            }
        }
        if (!bin) bin = app.project.rootItem.createBin("IronComposer");

        // 2. Importar o arquivo para o bin
        app.project.importFiles([filePath], true, bin, false);
        
        // 3. Achar o item importado no bin
        var itemToInsert = null;
        var importedName = fileToImport.name.replace(/\.[^.]+$/, "");
        
        for (var j = 0; j < bin.children.numItems; j++) {
            var childName = bin.children[j].name;
            if (childName === fileToImport.name || childName === importedName) {
                itemToInsert = bin.children[j];
                break;
            }
        }

        if (!itemToInsert) {
            // Tenta pegar o último item adicionado
            if (bin.children.numItems > 0) {
                itemToInsert = bin.children[bin.children.numItems - 1];
            }
        }

        if (itemToInsert) {
            var cti = sequence.getPlayerPosition();
            var isAudio = filePath.toLowerCase().match(/\.(wav|mp3|aac|aif|aiff|flac)$/);
            
            // Obtém a duração do clipe
            var clipDuration = itemToInsert.duration.seconds;
            
            // Encontra a melhor trilha para inserção
            var trackResult = findEmptyTrack(sequence, isAudio, cti.seconds, clipDuration);
            
            if (!trackResult.success) {
                return "Erro: Nenhuma trilha vazia disponível.";
            }
            
            // Insere na trilha encontrada
            trackResult.track.insertClip(itemToInsert, trackResult.position);
            
            return "Sucesso";
        }
        return "Erro: Falha ao localizar item importado.";
    } catch (err) {
        return "Erro: " + err.toString();
    }
}

// Função para encontrar uma trilha vazia
function findEmptyTrack(sequence, isAudio, ctiPosition, clipDuration) {
    var tracks = isAudio ? sequence.audioTracks : sequence.videoTracks;
    var numTracks = tracks.numItems;
    
    // Primeiro, verifica se a trilha principal tem espaço vazio
    if (numTracks > 0) {
        var mainTrack = tracks[0];
        var result = checkTrackSpace(mainTrack, ctiPosition, clipDuration);
        
        if (result.hasSpace) {
            return { success: true, track: mainTrack, position: ctiPosition };
        }
    }
    
    // Se não tem espaço na trilha principal, procura outras trilhas
    for (var t = 0; t < numTracks; t++) {
        var track = tracks[t];
        
        // Pula a trilha principal se já verificou
        if (t === 0) continue;
        
        var result = checkTrackSpace(track, ctiPosition, clipDuration);
        
        if (result.hasSpace) {
            return { success: true, track: track, position: ctiPosition };
        }
    }
    
    // Se nenhuma trilha tem espaço vazio, tenta inserir na primeira trilha disponível
    // (isso vai empurrar os clipes existentes)
    if (numTracks > 0) {
        return { success: true, track: tracks[0], position: ctiPosition };
    }
    
    return { success: false };
}

// Função para verificar se há espaço vazio na trilha
function checkTrackSpace(track, position, clipDuration) {
    try {
        var clips = track.clips;
        
        // Se não há clipes, tem espaço
        if (clips.numItems === 0) {
            return { hasSpace: true };
        }
        
        // Verifica cada clipe na trilha
        for (var i = 0; i < clips.numItems; i++) {
            var clip = clips[i];
            var clipStart = clip.start.seconds;
            var clipEnd = clip.end.seconds;
            
            // Verifica se o clipe a ser inserido sobrepõe algum clipe existente
            var newEnd = position + clipDuration;
            
            if (position < clipEnd && newEnd > clipStart) {
                // Há sobreposição - não pode inserir aqui
                return { hasSpace: false, overlapping: true };
            }
        }
        
        // Não há sobreposição
        return { hasSpace: true };
        
    } catch (e) {
        // Em caso de erro, permite inserção
        return { hasSpace: true };
    }
}
        return "Erro: " + err.toString();
    }
}