# projetoSTELLA

**S**elf-hosted **T**welve-persona **E**ngine for **L**ocal **L**anguage **A**gents

A Stella é uma companheira de IA para desktop que roda **100% no seu computador**. Ela aparece como um avatar animado na tela, conversa por texto e voz e lembra do que você contou. São 12 personas inspiradas nos signos do Zodíaco, e 4 delas estão ativas no lançamento: Leo, Corni, Aqua e Pixi. Nada sai da sua máquina: sem nuvem, sem chave de API, sem telemetria.

> Em desenvolvimento. Fase atual: **2 — Chat com LLM local** (concluída).

## Requisitos

- Windows 10/11 x64
- [Node.js](https://nodejs.org) 22.12 ou mais novo
- [Ollama](https://ollama.com) instalado (roda em `127.0.0.1:11434`)
- Recomendado: 8 GB de RAM ou mais; uma GPU com 4 GB ou mais ajuda

## Como rodar

```bash
npm install
```

Baixe os modelos (uma vez só, cerca de 4 GB; o Ollama precisa estar aberto):

```bash
npm run models:pull
```

```bash
npm run dev
```

## Estrutura

```text
apps/desktop/      app Electron (janela, bandeja, IPC)
packages/core/     lógica de IA, independente do Electron
assets/avatar/     avatar único em SVG; a cor muda por elemento
config/            paletas, afinidade e lock dos modelos
personas/          uma pasta por persona (a partir da fase 5)
```

## Roadmap

1. Fundação
2. Chat com LLM local (Ollama)
3. Avatar e janela de companheira
4. Memória de longo prazo
5. Sistema de personas do Zodíaco
6. Ferramentas com permissão
7. Voz (fala → texto e texto → fala, tudo local)
8. Instalador
