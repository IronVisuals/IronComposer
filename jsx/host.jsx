/**
 * host.jsx — IronComposer (Versão com Inserção Protegida na Timeline)
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
            
            // Determina qual trilha usar
            var targetTrack = isAudio ? sequence.audioTracks[0] : sequence.videoTracks[0];
            
            // Usa insertClip que empurra os clipes existentes (não sobrescreve)
            targetTrack.insertClip(itemToInsert, cti.seconds);
            
            return "Sucesso";
        }
        return "Erro: Falha ao localizar item importado.";
    } catch (err) {
        return "Erro: " + err.toString();
    }
}