# Stella — convenções do projeto

Companheira de IA para desktop (Windows) que roda **100% local**: avatar animado, chat por texto e voz, memória compartilhada e 12 personas do Zodíaco (4 ativas no lançamento).

## Regras inegociáveis

- **100% local.** Nenhuma API remota, chave de API, telemetria ou atualizador online. Em uso, o app só fala com o Ollama em `127.0.0.1`. A internet só é usada para baixar modelos uma vez, com SHA-256 fixo em `config/models.lock.json`. O processo principal bloqueia toda requisição fora do loopback (`isRequestAllowed` em `packages/core/src/network-policy.ts`).
- **Servidores só em `127.0.0.1`**, nunca em `0.0.0.0`.
- **Renderer isolado:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. O preload expõe só uma API mínima via `contextBridge`. O renderer nunca acessa disco, Ollama ou sistema diretamente: tudo passa pelo processo principal, que aplica as permissões.
- **Ferramentas com permissão explícita.** Toda ferramenta começa desligada. Ações que alteram algo pedem confirmação com a ação escrita por extenso. Arquivos só em pastas autorizadas, nunca a pasta do app. Esc cancela qualquer ação em andamento.
- **Conteúdo externo é dado não confiável** (arquivos, telas): nunca libera ferramentas sozinho.
- **Sem admin, sem `ExecutionPolicy Bypass`.**
- **Não copiar código do CapriCore** (GPL-3.0). Ele é só referência de ideias.
- **Personas são dados, não código:** uma persona nova é uma pasta em `personas/<id>/` (`persona.json` + `prompt.md`), sem mudar código e sem arte nova. Depois, rode `npm run personas:affinity`.
- **Sem estereótipos de signo:** nenhuma previsão, nenhum julgamento pelo signo; o signo só aparece se o usuário puxar o assunto.

## Código

- TypeScript estrito (`tsconfig.base.json`). Validação de dados externos e de configuração com `zod`.
- `packages/core` (`@stella/core`) **não depende do Electron**. Toda a lógica de IA fica nele e é testada sozinha.
- `apps/desktop` (`@stella/desktop`) contém as janelas, a bandeja, o IPC e o ciclo de vida do Ollama.
- Duas janelas visíveis (mais a de áudio, oculta, só com a voz ligada), cada uma com o próprio preload e só a própria API: **companheira** (`companion.html`, `window.companion`: avatar transparente, sempre no topo, `focusable: false` para nunca roubar o foco, cliques atravessam fora do desenho) e **chat** (`index.html`, `window.stella`; fechar só esconde). O processo principal confere a janela de origem de cada canal (`ipc-guard.ts`).
- O estado do avatar (parado, pensando, falando, feliz) e o balão são decididos por `AvatarDirector` em `@stella/core`, alimentado pelos eventos do chat. **A fala inteira sempre aparece no balão**: `paginate` divide em páginas de até 150 caracteres (cortando em fim de frase), mostradas em sequência pelo tempo de leitura; clicar no balão passa a página e, na última, abre o chat. Nunca corte texto com "…".
- A janela do avatar usa o nível "screen-saver" de sempre no topo e o reaplica se o Windows tirar: com um jogo aberto, o nível padrão era ignorado.
- **Ferramentas** (`packages/core/src/tools/`). Fluxo de cada mensagem: `IntentRouter` (JSON com esquema, temperatura 0, vê **só a mensagem do usuário**) → `ToolRunner` (existe → ligada → argumentos zod → escopo → confirmação para `risk: 'action'` → executa → log) → a persona responde com o resultado (mensagem `tool`), sem receber ferramentas. Medido com o qwen3.5:2b: dar as ferramentas direto à persona (tool calling nativo) fazia ela chamar em 0 a 5 de 18 pedidos e fingir ações; o classificador acertou 21 de 22. Como o classificador nunca vê arquivos, injeção de prompt não dispara ação por construção.
- Quando nada do pedido foi feito (desligada, fora do escopo, recusada), a resposta é montada pelo código (`refusalReply`), não pelo modelo: ele contava recusas como "erro do sistema". Resultados para o modelo usam `notDone()` ("Diga ao usuário: ..."), em segunda pessoa.
- `read_file` resolve o caminho de verdade (`realpath`) antes de conferir o escopo e recusa rede, dispositivos, fluxos alternativos, binários e a pasta do app/dados. O conteúdo vai embrulhado como "dado não confiável", com marcadores de fim neutralizados. `open_app` só abre programas (`.exe`) e atalhos (`.lnk`) da lista, sem argumentos do modelo e sem shell.
- No app, abrir é como um duplo clique (`shell.openPath`, ShellExecute), não um processo filho: assim funciona com atalhos, iniciadores (Discord) e apps da Store, e o app aberto não fica preso à Stella. Um vigia em PowerShell (`windows-launcher.ts`, preparado enquanto a confirmação está na tela) confere se apareceu janela nova ou se outra janela veio para a frente; se o app já estava aberto, restaura e traz a janela dele. Só então a resposta é "Abri"; senão, "nenhuma janela apareceu". Achado em 17/11/2026: como processo filho, o `calc.exe` saía sem abrir nada e a Stella dizia "Abri". Se um processo novo do app apareceu, o vigia espera até 25 s pela janela e, sem ela, responde "ainda carregando" (o Opera GX a frio passava dos 6 s).
- Apps têm `aliases` ("Outros nomes" na tela). `findApp` acha pelo nome ou apelido e, senão, pelas palavras, só se um único app combinar; nunca escolhe entre dois. `setAppAliases` recusa apelido que já é nome de outro app.
- Atalhos entram pelo "Adicionar do Menu Iniciar" (lista de `.lnk` lida no processo principal; o diálogo de arquivos do Windows troca o atalho pelo destino). A confirmação mostra para onde o atalho aponta, com argumentos.
- Pastas e apps só entram pelo diálogo nativo aberto no processo principal: o renderer nunca envia caminhos para autorizar. Confirmação (`ConfirmBroker`): só um "permitir" explícito vale; tempo esgotado, Esc ou janela fechada = não.
- Nunca ponha mensagens `system` no fim da conversa: o 2B às vezes as lê em voz alta. Orientações vão no fim do prompt de sistema.
- **Memória** (`packages/core/src/memory/`): `MemoryStore` (SQLite + sqlite-vec, arquivo `memoria.db` na pasta de dados; histórico com `persona_id`, fatos e índice vetorial de cosseno), `FactExtractor` (o LLM tira fatos da mensagem do usuário em JSON com esquema) e `Memory` (junta tudo; fatos repetidos com distância ≤ 0,07 não são salvos; com até `topK` fatos vão todos ao prompt, acima disso busca vetorial). Embedding e extração nunca derrubam o chat: falhou, a conversa segue sem lembrar.
- Com o qwen3.5:2b, mostrar ao extrator os fatos já salvos piorou o resultado (ele repete a lista). Fatos que mudam ("mudou de cidade") ficam os dois, com data, e o prompt manda valer o mais recente.
- **Personas** (`packages/core/src/personas/`): `loadPersonaCatalog` lê `personas/<id>/` (validado com zod; `status` `active` ou `planned`; ativas precisam de `prompt.md`). A afinidade é calculada pelas regras (`affinity.ts`), não lida de tabela; `config/affinity.json` é gerado (`npm run personas:affinity`) e um teste confere as 36 sugestões da especificação. O prompt é montado em camadas (`prompt.ts`): regras comuns → `prompt.md` → memória → conversa.
- Cada fala guarda quem falou. **Nunca mande falas de outra persona como mensagens de assistente**: tudo até a última fala de outra persona vai como transcrição ("Usuário: ... / Leo: ...") no prompt de sistema, e só as falas da persona atual vão como mensagens. Com o 2B, o formato de mensagens (mesmo rotulado) fazia ele repetir falas antigas. O `SpeakerTagFilter` tira "[Nome]" ou "Nome:" do começo da resposta. Fatos guardam a persona que os ouviu ("contou ao Leo").
- Troca de persona: a nova recebe uma instrução oculta (`handoffInstruction`) com as últimas mensagens do usuário citadas e "você é X e mais ninguém"; ela não entra no histórico nem na memória. Falas por conta própria (cumprimento, troca) ficam marcadas `handoff`: se o usuário trocar de novo antes de responder, a anterior sai do histórico (`dropPendingHandoffs`) e da tela (evento `retract`). Isso mantém o assunto estável em trocas seguidas (`tests/review/switch.review.ts`).
- No desktop, `PersonaService` (sem Electron) cuida de catálogo, `profile.json` (persona, signo e preferência; nunca a data de nascimento), onboarding e troca. Paletas em `config/elements.json`.
- Ao mudar prompts ou o modelo, rode `npm run personas:review` e leia o relatório (ver `docs/revisao-personas.md`).
- **Voz** (`packages/core/src/voice/`, `apps/desktop/src/main/voice-*.ts`, `apps/desktop/src/voice-worker/`): Silero VAD → Parakeet TDT 0.6b v3 int8 → chat → `SentenceSplitter` → Kokoro v1.0 **fp32** (o int8 era 3x mais lento no i5-4440), via sherpa-onnx-node 2.0.2. Escolhas medidas em `docs/voz-modelos.md`.
- A sherpa-onnx 2.x não traz o espeak-ng: os fonemas vêm do `espeak-ng.exe` (GPL-3), chamado como programa à parte (`espeak.ts`: texto pela entrada padrão, sem shell) e passados em `phonemeCodepoints` (NFD). Não corrija a saída do espeak (`æ`, `y`): os modelos foram treinados com ela.
- Os modelos rodam num `utilityProcess` (`voice-worker`) encerrado ao desligar a voz: os objetos da sherpa não têm `free()`, e encerrar o processo devolve toda a RAM. A janela de áudio (`voice.html`, oculta; só ela pode usar o microfone, e só áudio) também só existe com a voz ligada. Três janelas, então: companheira, chat e áudio.
- `VoiceController` (sem Electron): meio-duplex (microfone surdo enquanto a persona fala), fala também as respostas a texto digitado, Esc cala e volta a ouvir. O Parakeet ouve "Stella" como "Estela": `fixNames` corrige.
- Voz de cada persona em `persona.json` (`voice.voiceId` = voz do Kokoro; ids em `KOKORO_VOICES`, `voice-config.ts`). Vozes de outras línguas falam com os fonemas do português (o reconhecimento entendeu todas).
- Latência até a primeira palavra no i5-4440: ~2,3 a 3,4 s (`npm run voice:review`), aceito em 21/11/2026 no lugar da meta de ~2 s (Piper seria ~2,2 s, mas tem licença não comercial). O primeiro pedaço da resposta para na primeira vírgula ou é cortado numa palavra depois de ~36 letras, para a voz começar antes.
- Preloads rodam em sandbox e não podem dar `require` em arquivos vizinhos: o build usa `isolatedEntries` para cada preload sair num arquivo só.
- Testes obrigatórios para toda lógica nova. Arquivos de teste ficam ao lado do código: `*.test.ts`.
- Textos de interface e mensagens de commit em **pt-BR**.

## Comandos

```bash
npm install            # instala dependências
npm run dev            # abre o app em modo desenvolvimento
npm test               # testes (Vitest)
npm run typecheck      # checagem de tipos
npm run lint           # ESLint
npm run format         # Prettier
npm run check:native   # confere better-sqlite3 + sqlite-vec + sherpa-onnx dentro do Electron
npm run check          # tudo acima
npm run test:e2e       # build + testes de ponta a ponta (Playwright + Electron)
npm run icons -w @stella/desktop   # regera os ícones da bandeja (um por elemento) a partir do SVG
npm run personas:affinity          # regera config/affinity.json a partir de personas/
npm run personas:review            # conversas de teste com o modelo real (Ollama aberto)
npm run voice:review               # latência da conversa falada com os modelos reais
```

## Repositório

- `ESPECIFICAÇÕES/` é material de referência local e **nunca** vai para o git (está no `.gitignore`).
- Trabalho por fases (Fundação → Chat → Avatar → Memória → Personas → Ferramentas → Voz → Empacotamento). Uma fase só avança quando os critérios de pronto passam.

## Ambiente

- Windows 10/11 x64, Node ≥ 22.12 (em uso: 26 LTS), Electron 45, Ollama 0.40.
- Máquina de referência: GTX 1060 6 GB, 16 GB de RAM. Modelo padrão `qwen3.5:2b` (carregar a frio leva até ~1 min; depois, primeiro token em ~0,1 s).
- **O disco C: desta máquina está quase cheio: tudo é instalado no D:.** Ferramentas em `D:\Ferramentas` (`nodejs`, `Ollama`), modelos em `D:\Ferramentas\OllamaModels` (variável `OLLAMA_MODELS`), caches em `D:\Ferramentas\cache` (npm `cache` e `electron_config_cache`). Só use o C: se for indispensável.
- `.npmrc` tem `ignore-scripts=true`: nenhuma dependência roda script na instalação (o `better-sqlite3` já vem com binário pronto).
