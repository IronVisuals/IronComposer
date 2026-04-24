/**
 * host.jsx — ExtendScript para o IronComposer
 *
 * CONTEXTO:
 * Este código roda DENTRO do Adobe Premiere Pro, com acesso direto
 * ao objeto global 'app' — a porta de entrada para tudo no Premiere.
 */

// =====================================================
// FUNÇÃO PRINCIPAL: importAndInsert
// =====================================================

function importAndInsert(filePath) {

  // PASSO 0: Validação
  if (!app.project) {
    return JSON.stringify({ success: false, error: "Nenhum projeto aberto no Premiere." });
  }

  var sequence = app.project.activeSequence;
  if (!sequence) {
    return JSON.stringify({ success: false, error: "Nenhuma sequencia ativa." });
  }

  // PASSO 1: Salvar o projeto preventivamente (Safety First)
  try {
    app.project.save();
  } catch (saveErr) {
    $.writeln("[IronComposer] Aviso: nao foi possivel salvar preventivamente: " + saveErr.toString());
  }

  // PASSO 2: Encontrar ou criar o Bin "IronComposer"
  var targetBin = findOrCreateBin("IronComposer");
  if (!targetBin) {
    return JSON.stringify({ success: false, error: "Erro ao criar o Bin." });
  }

  // PASSO 3: Importar o arquivo para o Bin
  var importSuccess;
  try {
    importSuccess = app.project.importFiles(
      [filePath],   
      true,         // suppressUI
      targetBin,    
      false         
    );
  } catch (importErr) {
    return JSON.stringify({ success: false, error: "Erro ao importar: " + importErr.toString() });
  }

  if (!importSuccess) {
    return JSON.stringify({ success: false, error: "Premiere recusou importar." });
  }

  // Encontra o ProjectItem recém-importado
  var projectItem = findImportedItem(targetBin, filePath);
  if (!projectItem) {
    return JSON.stringify({ success: false, error: "Arquivo importado mas nao encontrado." });
  }

  // PASSO 4: Inserir na Timeline (A Regra de Ouro)
  var ctiPosition = sequence.getPlayerPosition();
  var fileExtension = getExtension(filePath).toLowerCase();
  var isAudioOnly   = isAudioFile(fileExtension);
  var isMogrt       = (fileExtension === ".mogrt");

  try {
    if (isMogrt) {
      return insertMogrt(projectItem, sequence, ctiPosition);
    } else {
      return insertMediaClip(projectItem, sequence, ctiPosition, isAudioOnly);
    }
  } catch (insertErr) {
    return JSON.stringify({ success: false, error: "Erro ao inserir: " + insertErr.toString() });
  }
}

// =====================================================
// FUNÇÕES DE INSERÇÃO (A Regra de Ouro Aplicada)
// =====================================================

function insertMediaClip(projectItem, sequence, ctiPosition, audioOnly) {
  if (!audioOnly && sequence.videoTracks.numTracks === 0) sequence.videoTracks.addTrack();
  if (sequence.audioTracks.numTracks === 0) sequence.audioTracks.addTrack();

  if (!audioOnly && sequence.videoTracks.numTracks > 0) {
    var videoTrack = sequence.videoTracks[0];
    // AQUI ESTÁ A REGRA DE OURO: insertClip empurra, overwriteClip destrói.
    videoTrack.insertClip(projectItem, ctiPosition.seconds);
    return JSON.stringify({ success: true });
  }

  if (sequence.audioTracks.numTracks > 0) {
    var audioTrack = sequence.audioTracks[0];
    audioTrack.insertClip(projectItem, ctiPosition.seconds);
    return JSON.stringify({ success: true });
  }

  return JSON.stringify({ success: false, error: "Nenhuma trilha disponivel." });
}

function insertMogrt(projectItem, sequence, ctiPosition) {
  try {
    if (typeof qe !== "undefined" && qe.project) {
      var qeSequence = qe.project.getActiveSequence();
      if (qeSequence) {
        qeSequence.insertMotionGraphicsTemplate(
          projectItem.treePath,  
          0,                      
          ctiPosition.ticks + "", 
          true                    
        );
        return JSON.stringify({ success: true });
      }
    }
  } catch (qeErr) {
    $.writeln("[IronComposer] QEDom falhou para mogrt: " + qeErr.toString());
  }

  // Fallback
  try {
    if (sequence.videoTracks.numTracks > 0) {
      var videoTrack = sequence.videoTracks[0];
      videoTrack.insertClip(projectItem, ctiPosition.seconds);
      return JSON.stringify({ success: true });
    }
  } catch (fallbackErr) {
    return JSON.stringify({ success: false, error: "Erro ao inserir mogrt: " + fallbackErr.toString() });
  }
  return JSON.stringify({ success: false, error: "Falha final no mogrt." });
}

// =====================================================
// FUNÇÕES AUXILIARES
// =====================================================

function findOrCreateBin(binName) {
  var rootItem = app.project.rootItem;
  for (var i = 0; i < rootItem.children.numItems; i++) {
    var child = rootItem.children[i];
    if (child.type === ProjectItemType.BIN && child.name === binName) {
      return child; 
    }
  }
  return app.project.createBin(binName);
}

function findImportedItem(bin, filePath) {
  var fileNameWithExt = filePath.replace(/^.*[\\/]/, '');       
  var fileNameNoExt   = fileNameWithExt.replace(/\.[^.]+$/, ''); 

  $.sleep(100); 

  for (var i = 0; i < bin.children.numItems; i++) {
    var item = bin.children[i];
    if (item.name === fileNameNoExt || item.name === fileNameWithExt) {
      return item;
    }
  }
  if (bin.children.numItems > 0) {
    return bin.children[bin.children.numItems - 1];
  }
  return null;
}

function getExtension(filePath) {
  var lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filePath.substring(lastDot); 
}

function isAudioFile(ext) {
  var audioExts = [".wav", ".mp3", ".aac", ".aif", ".aiff", ".flac"];
  for (var i = 0; i < audioExts.length; i++) {
    if (audioExts[i] === ext) return true;
  }
  return false;
}

$.writeln("[IronComposer] host.jsx carregado com sucesso.");