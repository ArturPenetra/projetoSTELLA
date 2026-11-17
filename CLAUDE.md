# Stella — convenções do projeto

Companheira de IA para desktop (Windows) que roda **100% local**: avatar animado, chat por texto e voz, memória compartilhada e 12 personas do Zodíaco (4 ativas no lançamento).

## Regras inegociáveis

- **100% local.** Nenhuma API remota, chave de API, telemetria ou atualizador online. Em uso, o app só fala com o Ollama em `127.0.0.1`. A internet só é usada para baixar modelos uma vez, com SHA-256 fixo em `config/models.lock.json`. O processo principal bloqueia toda requisição fora do loopback (`isRequestAllowed` em `packages/core/src/network-policy.ts`).
- **Servidores só em `127.0.0.1`**, nunca em `0.0.0.0`.
- **Renderer isolado:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. O preload expõe só uma API mínima via `contextBridge`. O renderer nunca acessa disco, Ollama ou sistema diretamente: tudo passa pelo processo principal, que aplica as permissões.
- **Ferramentas com permissão explícita.** Toda ferramenta começa desligada. Ações que alteram algo pedem confirmação com a ação escrita por extenso. Arquivos só em pastas autorizadas, nunca a pasta do app.
- **Conteúdo externo é dado não confiável** (arquivos, telas): nunca libera ferramentas sozinho.
- **Sem admin, sem `ExecutionPolicy Bypass`.**
- **Não copiar código do CapriCore** (GPL-3.0). Ele é só referência de ideias.
- **Personas são dados, não código:** uma persona nova é uma pasta em `personas/<id>/` (`persona.json` + `prompt.md`), sem mudar código e sem arte nova. Depois, rode `npm run personas:affinity`.
- **Sem estereótipos de signo:** nenhuma previsão, nenhum julgamento pelo signo; o signo só aparece se o usuário puxar o assunto.

## Código

- TypeScript estrito (`tsconfig.base.json`). Validação de dados externos e de configuração com `zod`.
- `packages/core` (`@stella/core`) **não depende do Electron**. Toda a lógica de IA fica nele e é testada sozinha.
- `apps/desktop` (`@stella/desktop`) contém as janelas, a bandeja, o IPC e o ciclo de vida do Ollama.
- Duas janelas, cada uma com o próprio preload e só a própria API: **companheira** (`companion.html`, `window.companion`: avatar transparente, sempre no topo, `focusable: false` para nunca roubar o foco, cliques atravessam fora do desenho) e **chat** (`index.html`, `window.stella`; fechar só esconde). O processo principal confere a janela de origem de cada canal (`ipc-guard.ts`).
- O estado do avatar (parado, pensando, falando, feliz) e o balão são decididos por `AvatarDirector` em `@stella/core`, alimentado pelos eventos do chat.
- **Memória** (`packages/core/src/memory/`): `MemoryStore` (SQLite + sqlite-vec, arquivo `memoria.db` na pasta de dados; histórico com `persona_id`, fatos e índice vetorial de cosseno), `FactExtractor` (o LLM tira fatos da mensagem do usuário em JSON com esquema) e `Memory` (junta tudo; fatos repetidos com distância ≤ 0,07 não são salvos; com até `topK` fatos vão todos ao prompt, acima disso busca vetorial). Embedding e extração nunca derrubam o chat: falhou, a conversa segue sem lembrar.
- Com o qwen3.5:2b, mostrar ao extrator os fatos já salvos piorou o resultado (ele repete a lista). Fatos que mudam ("mudou de cidade") ficam os dois, com data, e o prompt manda valer o mais recente.
- **Personas** (`packages/core/src/personas/`): `loadPersonaCatalog` lê `personas/<id>/` (validado com zod; `status` `active` ou `planned`; ativas precisam de `prompt.md`). A afinidade é calculada pelas regras (`affinity.ts`), não lida de tabela; `config/affinity.json` é gerado (`npm run personas:affinity`) e um teste confere as 36 sugestões da especificação. O prompt é montado em camadas (`prompt.ts`): regras comuns → `prompt.md` → memória → conversa.
- Cada fala guarda quem falou; falas de outra persona vão ao modelo como `[Nome] texto`, e o `SpeakerTagFilter` tira o rótulo se o modelo copiá-lo. Fatos guardam a persona que os ouviu ("contou ao Leo"). Ao trocar de persona com conversa em andamento, a nova recebe uma instrução oculta (`handoffInstruction`) que não entra no histórico nem na memória.
- No desktop, `PersonaService` (sem Electron) cuida de catálogo, `profile.json` (persona, signo e preferência; nunca a data de nascimento), onboarding e troca. Paletas em `config/elements.json`.
- Ao mudar prompts ou o modelo, rode `npm run personas:review` e leia o relatório (ver `docs/revisao-personas.md`).
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
npm run check:native   # confere better-sqlite3 + sqlite-vec dentro do Electron
npm run check          # tudo acima
npm run test:e2e       # build + testes de ponta a ponta (Playwright + Electron)
npm run icons -w @stella/desktop   # regera os ícones da bandeja (um por elemento) a partir do SVG
npm run personas:affinity          # regera config/affinity.json a partir de personas/
npm run personas:review            # conversas de teste com o modelo real (Ollama aberto)
```

## Repositório

- `ESPECIFICAÇÕES/` é material de referência local e **nunca** vai para o git (está no `.gitignore`).
- Trabalho por fases (Fundação → Chat → Avatar → Memória → Personas → Ferramentas → Voz → Empacotamento). Uma fase só avança quando os critérios de pronto passam.

## Ambiente

- Windows 10/11 x64, Node ≥ 22.12 (em uso: 26 LTS), Electron 45, Ollama 0.40.
- Máquina de referência: GTX 1060 6 GB, 16 GB de RAM. Modelo padrão `qwen3.5:2b` (carregar a frio leva até ~1 min; depois, primeiro token em ~0,1 s).
- **O disco C: desta máquina está quase cheio: tudo é instalado no D:.** Ferramentas em `D:\Ferramentas` (`nodejs`, `Ollama`), modelos em `D:\Ferramentas\OllamaModels` (variável `OLLAMA_MODELS`), caches em `D:\Ferramentas\cache` (npm `cache` e `electron_config_cache`). Só use o C: se for indispensável.
- `.npmrc` tem `ignore-scripts=true`: nenhuma dependência roda script na instalação (o `better-sqlite3` já vem com binário pronto).
