# ⚙️ IronComposer

Um painel customizado (CEP - Common Extensibility Platform) para **Adobe Premiere Pro 2024-2026+** que atua como um Asset Manager local ágil e seguro. 

O IronComposer foi desenvolvido para substituir gerenciadores de assets pesados de terceiros, permitindo a leitura imutável de bibliotecas locais de SFX, VFX, gráficos e templates `.mogrt`, com foco total na proteção da timeline do editor.

## ✨ Destaques e Funcionalidades

* **Leitura Direta do Disco:** Utiliza a integração do Node.js (`fs`) nativa do CEP para mapear pastas locais instantaneamente, sem precisar reimportar arquivos para o projeto.
* **A Regra de Ouro (Proteção de Timeline):** A inserção de mídia no Premiere utiliza estritamente lógicas de "Push/Insert" (`insertClip`), garantindo que a edição existente nunca seja sobrescrita acidentalmente por novos assets.
* **Suporte a Múltiplos Formatos:** Filtro inteligente para vídeos (`.mp4`, `.mov`, `.mxf`), áudio (`.wav`, `.mp3`), imagens (`.png`, `.psd`) e Motion Graphics Templates (`.mogrt`).
* **Configuração Persistente:** O caminho da biblioteca raiz (ex: `G:\`) é salvo localmente em um `.json` não versionado, adaptando-se a diferentes máquinas sem quebrar o repositório.

## 🏗️ Arquitetura Técnica

O projeto segue um padrão de separação de responsabilidades dividido em três camadas:

1. **Front-end (UI/UX):** HTML5 e CSS3 desenhados para espelhar o tema escuro nativo do Adobe Premiere Pro.
2. **Core (JavaScript/Node.js):** Gerencia o estado da aplicação, lê o sistema de arquivos local de forma síncrona/assíncrona e constrói a árvore de navegação usando o DOM.
3. **Engine (ExtendScript):** Código legado (`host.jsx`) que interage diretamente com a API do Premiere para salvar projetos preventivamente, organizar Bins e manipular a *Current Time Indicator* (CTI) e as trilhas de vídeo/áudio.

## 🚀 Como Rodar Localmente (Modo Desenvolvedor)

Como o IronComposer é um painel não-assinado em fase de desenvolvimento, você precisará habilitar o `PlayerDebugMode` no registro do Windows.

### 1. Habilitar Debug Mode
Abra o PowerShell ou Git Bash como Administrador e rode:
```bash
reg add "HKEY_CURRENT_USER\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f

2. Instalar a Extensão
Clone este repositório diretamente na pasta de extensões do Adobe Premiere:
C:\Users\SEU_USUARIO\AppData\Roaming\Adobe\CEP\extensions\

A estrutura final deve ficar como ...\extensions\com.henrique.ironcomposer\

Reinicie o Adobe Premiere Pro.

Abra o painel acessando: Window > Extensions > IronComposer.

3. Depuração
Para debugar a interface HTML/JS, abra o navegador Chrome e acesse http://localhost:7778 enquanto o painel estiver aberto no Premiere.

🛠️ Próximos Passos (Roadmap)
[x] Estruturação base do CEP e permissões Node.js.

[x] Interface de navegação de pastas e modal de configuração.

[x] Lógica de importação segura (ExtendScript).

[ ] Adicionar preview de áudio ao clicar nos itens .wav / .mp3.

[ ] Criar ícones customizados para o manifest do plugin.

Desenvolvido por Henrique.