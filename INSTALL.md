# 🚀 IronComposer v2.0 — Guia de Atualização

## ✅ O que foi corrigido e adicionado

### Bugs corrigidos
- ❌ **Bug crítico no `host.jsx`**: tinha código órfão depois da função `checkTrackSpace` que causava erro de sintaxe ExtendScript. Por isso a inserção dava erro.
- ❌ Confusão entre `numItems` e `numTracks`.
- ❌ Falta de tratamento de duração da mídia para verificar conflito de trilhas.

### Funcionalidades novas
- ✨ **Seletor de pasta moderno do Windows** (Explorer nativo via `showOpenDialogEx`)
- ✨ **Inserção inteligente em trilha vazia**: detecta CTI + duração da mídia e procura uma trilha sem conflito
- ✨ **Preview de áudio com waveform** desenhada via Web Audio API
- ✨ **Sistema de favoritos** (estrela ★) com persistência
- ✨ **Aba Browse / Favoritos**
- ✨ **Busca recursiva** em todas as pastas adicionadas
- ✨ **Árvore de subpastas expansível** (com persistência do estado expandido/recolhido)
- ✨ **Toast notifications** para feedback rápido
- ✨ **Atalhos de teclado**: `Espaço` toca/pausa preview, `Esc` limpa busca

---

## 📋 Passo a passo para instalar

### 1. Faça backup do projeto atual
No Git Bash, dentro da pasta do plugin:

```bash
cd "C:/Users/$USERNAME/AppData/Roaming/Adobe/CEP/extensions/com.henrique.ironcomposer"
git add -A
git commit -m "backup: versao antes da v2.0"
git checkout -b v2.0
```

### 2. Substitua os arquivos
Sobrescreva os seguintes arquivos pelos novos:

| Arquivo | O que mudou |
|---------|-------------|
| `CSXS/manifest.xml` | Versão 2.0.0, novos parâmetros CEF |
| `index.html` | Layout novo com preview de áudio |
| `css/style.css` | Layout completo Premiere Composer |
| `js/main.js` | Lógica principal reescrita |
| `js/storage.js` | **NOVO** — gerenciador de persistência |
| `js/audioPreview.js` | **NOVO** — waveform + player |
| `js/favorites.js` | **NOVO** — sistema de favoritos |
| `jsx/host.jsx` | **CORRIGIDO** — bug de sintaxe + lógica nova |
| `.debug` | DevTools no Chrome (opcional) |

### 3. Não mexa nestes arquivos
- `lib/CSInterface.js` (mantenha o que você já tem)
- `.gitignore`
- `README.md`

### 4. Reinicie o Premiere Pro
Feche **completamente** o Premiere e abra de novo. Vá em:
**Window → Extensions → IronComposer**

---

## 🔧 Como funciona a inserção segura agora

```
Posição da agulha (CTI) ────► tempo
       │
       │ [Vamos inserir mídia de 3.5s aqui]
       ▼
   ┌──────────────────────────────────────────┐
   │ V3 │  vazio  │██ clipe X ██│   vazio    │  ← procura aqui
   ├──────────────────────────────────────────┤
   │ V2 │██ clipe A ██│   vazio  │██ clipe B │  ← procura aqui
   ├──────────────────────────────────────────┤
   │ V1 │██ clipe Y ██████████│ vazio │      │  ← procura aqui
   └──────────────────────────────────────────┘
       ▲
       CTI (3.5s)
```

**Lógica:**
1. Pega a posição do CTI (ex: 3.5s)
2. Pega a duração da mídia que vai inserir (ex: 4s, então fim em 7.5s)
3. **Para cada trilha**, percorre os clipes existentes e verifica se há sobreposição entre `[3.5s, 7.5s]` e qualquer clipe na trilha
4. **Encontra a primeira trilha sem conflito** → insere lá
5. **Se nenhuma trilha tem espaço**: avisa o usuário (mensagem clara) sem fazer nada

→ **Resultado**: nada na sua timeline é sobrescrito, NUNCA.

---

## 🎵 Como funciona o preview de áudio

1. Você clica num arquivo `.wav`/`.mp3`/etc → painel de preview abre
2. O áudio toca **automaticamente**
3. A waveform é desenhada lendo o arquivo do disco com Node.js (`fs.readFileSync`)
4. As amostras são decodificadas com `AudioContext.decodeAudioData`
5. O canvas desenha barras verticais proporcionais ao volume de cada trecho
6. Click na waveform → pula pra essa posição
7. Slider de volume + botão de mute funcionam normalmente

**Vídeos NÃO tocam automaticamente** (você só vê o nome e ícone) — exatamente como pediu.

---

## 🐛 Como debugar se algo der errado

### Ver erros do painel JavaScript
1. Com o Premiere e o IronComposer abertos
2. Abra o **Chrome** (não Edge!)
3. Vá em: `http://localhost:7778`
4. Você verá o DevTools do painel — Console com todos os erros

### Ver erros do ExtendScript (host.jsx)
Adicione `$.writeln(...)` no `host.jsx` e veja em:
`%APPDATA%/Adobe/CEP/logs/`

### Testar se host.jsx está funcionando
No DevTools do painel (acima), no Console, rode:
```javascript
new CSInterface().evalScript('ping()', console.log);
```
Deve retornar: `{"success":true,"message":"IronComposer host.jsx esta vivo"}`

---

## 📁 Onde os dados são salvos

Os arquivos JSON ficam em `%APPDATA%/Adobe/CEP/extensions/com.henrique.ironcomposer/...` ou no `userData` do CEP:

- `ironcomposer_folders.json` — pastas que você adicionou
- `ironcomposer_favorites.json` — caminhos dos arquivos favoritados
- `ironcomposer_expandedFolders.json` — quais pastas estão expandidas

Eles são pequenos (texto) e não precisam de backup. Se você apagar, o painel volta ao estado inicial.

---

## ⚠️ Coisas importantes pra saber

1. **O autoplay do áudio** depende do flag `--autoplay-policy=no-user-gesture-required` no `manifest.xml`. Se não tocar automaticamente, é porque o flag não foi aplicado — feche e abra o Premiere de novo.

2. **A inserção verifica trilhas existentes**. Se todas estão ocupadas no CTI, ele **não cria trilha nova automaticamente** (criar trilhas via ExtendScript pode quebrar projetos em alguns casos). Em vez disso, mostra: "Adicione uma nova trilha manualmente". É segurança.

3. **Recursão de pastas** está limitada a 8 níveis de profundidade pra evitar travar em estruturas malucas.

4. **Botão direito numa pasta** = remover do IronComposer (não apaga do disco, só do painel).

5. **Duplo clique num arquivo** = inserir direto na timeline (sem precisar apertar o botão).
