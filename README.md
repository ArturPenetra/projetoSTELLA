# projetoSTELLA

**S**elf-hosted **T**welve-persona **E**ngine for **L**ocal **L**anguage **A**gents

A Stella é uma companheira de IA para desktop que roda **100% no seu computador**. Ela aparece como um avatar animado na tela, conversa por texto e voz e lembra do que você contou. São 12 personas inspiradas nos signos do Zodíaco, e 4 delas estão ativas no lançamento: Leo, Corni, Aqua e Pixi. Nada sai da sua máquina: sem nuvem, sem chave de API, sem telemetria.

> Em desenvolvimento. Fase atual: **7 — Voz** (concluída).

## Requisitos

- Windows 10/11 x64
- [Node.js](https://nodejs.org) 22.12 ou mais novo
- [Ollama](https://ollama.com) instalado (roda em `127.0.0.1:11434`)
- Recomendado: 8 GB de RAM ou mais; uma GPU com 4 GB ou mais ajuda

## Como rodar

```bash
npm install
```

Baixe os modelos (uma vez só, cerca de 5 GB; o Ollama precisa estar aberto). Os modelos de voz e o espeak-ng vão para `models/voz`, com o SHA-256 de cada arquivo conferido:

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
- Enquanto responde, ela pensa, fala e fica feliz quando termina. A fala inteira aparece no balão: se for longa, vira várias páginas ("2/4") que passam sozinhas; clique no balão para ir à próxima.
- **Memória:** quando você conta algo sobre você (nome, onde mora, gostos, metas), ela guarda e avisa na conversa ("Guardei na memória: ..."). Nas próximas conversas, ela lembra.
- No botão **Memória** do chat você vê tudo o que ela guardou e pode editar, esquecer um fato ou esquecer tudo (inclusive o histórico de conversas).
- Tudo fica num arquivo no seu computador (`memoria.db`, na pasta de dados do app). Para não guardar nada, use `"memory": { "enabled": false }` no `config.json`.
- **Ferramentas** (botão no chat): ela pode **ler arquivos de texto** das pastas que você escolher e **abrir aplicativos** de uma lista que você monta. Tudo começa desligado.
  - Abrir um app sempre pede sua confirmação, com a ação escrita por extenso. **Esc** cancela na hora, e uma faixa no topo mostra quando ela está agindo.
  - Prefira **"Adicionar do Menu Iniciar…"**: abrir pelo atalho funciona como clicar no Menu Iniciar, inclusive com apps como o Discord e os da Microsoft Store. Ela só diz que abriu quando uma janela do app aparece; se o app já estava aberto (até minimizado), ela traz a janela para a frente. Apps lentos para abrir (como alguns navegadores) têm mais tempo; se a janela ainda não apareceu, ela avisa que o app está carregando.
  - Dê **outros nomes** a cada app no campo "Outros nomes" (por exemplo, "opera" para "Navegador Opera GX"). Parte do nome também serve ("Opera GX"), desde que só um app combine.
  - Arquivos fora das pastas escolhidas e os arquivos do próprio app nunca são lidos. O que está escrito dentro de um arquivo nunca dispara uma ação.
  - Cada pedido (feito, recusado ou bloqueado) fica registrado em "Últimas ações" e no arquivo `acoes.jsonl`.
- **Voz** (botão no chat): converse falando. Começa desligada toda vez que o app abre; ligar carrega os modelos (alguns segundos) e abre o microfone, desligar libera tudo (cerca de 1,3 GB de RAM).
  - Fale normalmente; quando você para, ela entende e responde em voz, frase a frase, enquanto ainda escreve. A boca do avatar acompanha o volume da fala.
  - Enquanto ela fala, o microfone fica surdo (para ela não se ouvir pelas caixas de som). **Esc** interrompe e ela volta a ouvir.
  - Cada persona tem a própria voz. Reconhecimento, síntese e o áudio do microfone nunca saem do computador.

## Créditos dos modelos de voz

- Reconhecimento: [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), da NVIDIA, licença CC-BY-4.0, convertido pelo projeto [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0).
- Síntese: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) v1.0, licença Apache-2.0.
- Detecção de fala: [Silero VAD](https://github.com/snakers4/silero-vad), licença MIT.
- Fonemas: [eSpeak NG](https://github.com/espeak-ng/espeak-ng) 1.52, licença GPL-3.0, usado como programa à parte (o código-fonte está no link).

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
