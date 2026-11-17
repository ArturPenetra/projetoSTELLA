# projetoSTELLA

**S**elf-hosted **T**welve-persona **E**ngine for **L**ocal **L**anguage **A**gents

A Stella é uma companheira de IA para desktop que roda **100% no seu computador**. Ela aparece como um avatar animado na tela, conversa por texto e voz e lembra do que você contou. São 12 personas inspiradas nos signos do Zodíaco, e 4 delas estão ativas no lançamento: Leo, Corni, Aqua e Pixi. Nada sai da sua máquina: sem nuvem, sem chave de API, sem telemetria.

> Em desenvolvimento. Fase atual: **5 — Personas do Zodíaco** (concluída).

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

## Como usar

- Na primeira vez, as 4 personas se apresentam e o app pergunta seu signo (ou a data de nascimento, ou nada, se preferir) e que tipo de companhia você quer. Ele sugere uma persona, mas a escolha é sua. A data não fica guardada, só o signo.
- **Personas:** Leo (energia e motivação), Corni (foco e organização), Aqua (ideias e aprendizado) e Pixi (acolhimento e criatividade). As outras 8 aparecem como "em breve". Troque quando quiser no botão **Personas** do chat ou no menu da bandeja. A nova persona retoma o assunto, e todas compartilham a mesma memória.
- Nenhuma persona faz horóscopo ou previsões, nem julga você pelo signo.
- A companheira aparece no canto inferior direito da tela, sempre por cima das outras janelas, sem tirar o foco do que você está fazendo.
- **Clique nela** (ou no ícone da bandeja) para abrir o chat. **Arraste** para mudar de lugar; a posição fica salva.
- **Clique direito** nela ou no ícone da bandeja: abrir o chat, esconder/mostrar a Stella e sair.
- Fechar o chat só esconde a janela; para sair de vez, use **Sair** no menu.
- Cada persona tem a cor do seu elemento (fogo, terra, ar, água), no avatar, no chat e no ícone da bandeja.
- Enquanto responde, ela pensa, fala e fica feliz quando termina; o balão mostra o começo da resposta.
- **Memória:** quando você conta algo sobre você (nome, onde mora, gostos, metas), ela guarda e avisa na conversa ("Guardei na memória: ..."). Nas próximas conversas, ela lembra.
- No botão **Memória** do chat você vê tudo o que ela guardou e pode editar, esquecer um fato ou esquecer tudo (inclusive o histórico de conversas).
- Tudo fica num arquivo no seu computador (`memoria.db`, na pasta de dados do app). Para não guardar nada, use `"memory": { "enabled": false }` no `config.json`.

## Estrutura

```text
apps/desktop/      app Electron (janela, bandeja, IPC)
packages/core/     lógica de IA, independente do Electron
assets/avatar/     avatar único em SVG; a cor muda por elemento
config/            paletas, afinidade e lock dos modelos
personas/          uma pasta por persona: persona.json + prompt.md (sem código, sem arte)
docs/              revisão das personas e outras notas
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
