/**
 * host.jsx — IronComposer
 */

function importAndInsert(filePath) {
    if (!app.project) return "Erro: Nenhum projeto aberto.";
    var sequence = app.project.activeSequence;
    if (!sequence) return "Erro: Nenhuma sequencia ativa.";

    var fileToImport = new File(filePath);
    if (!fileToImport.exists) return "Erro: Arquivo nao existe no disco.";

    try {
        // 1. Criar ou achar o Bin
        var bin = null;
        for (var i = 0; i < app.project.rootItem.children.numItems; i++) {
            if (app.project.rootItem.children[i].name === "IronComposer") {
                bin = app.project.rootItem.children[i];
                break;
            }
        }
        if (!bin) bin = app.project.rootItem.createBin("IronComposer");

        // 2. Importar
        app.project.importFiles([filePath], true, bin, false);
        
        // 3. Achar o item no bin
        var itemToInsert = null;
        for (var j = 0; j < bin.children.numItems; j++) {
            if (bin.children[j].name === fileToImport.name || bin.children[j].name === fileToImport.name.replace(/\.[^.]+$/, "")) {
                itemToInsert = bin.children[j];
                break;
            }
        }

        if (itemToInsert) {
            var cti = sequence.getPlayerPosition();
            // A REGRA DE OURO: .insertClip()
            if (filePath.toLowerCase().indexOf(".wav") > -1 || filePath.toLowerCase().indexOf(".mp3") > -1) {
                sequence.audioTracks[0].insertClip(itemToInsert, cti.seconds);
            } else {
                sequence.videoTracks[0].insertClip(itemToInsert, cti.seconds);
            }
            return "Sucesso";
        }
        return "Erro: Falha ao localizar item importado.";
    } catch (err) {
        return "Erro: " + err.toString();
    }
}