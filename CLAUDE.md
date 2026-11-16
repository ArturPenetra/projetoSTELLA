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
- **Personas são dados, não código:** uma persona nova é uma pasta em `personas/<id>/` (`persona.json` + `prompt.md`), sem mudar código e sem arte nova.
- **Sem estereótipos de signo:** nenhuma previsão, nenhum julgamento pelo signo; o signo só aparece se o usuário puxar o assunto.

## Código

- TypeScript estrito (`tsconfig.base.json`). Validação de dados externos e de configuração com `zod`.
- `packages/core` (`@stella/core`) **não depende do Electron**. Toda a lógica de IA fica nele e é testada sozinha.
- `apps/desktop` (`@stella/desktop`) contém a janela, a bandeja, o IPC e o ciclo de vida do Ollama.
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
```

## Repositório

- `ESPECIFICAÇÕES/` é material de referência local e **nunca** vai para o git (está no `.gitignore`).
- Trabalho por fases (Fundação → Chat → Avatar → Memória → Personas → Ferramentas → Voz → Empacotamento). Uma fase só avança quando os critérios de pronto passam.

## Ambiente

- Windows 10/11 x64, Node ≥ 22.12 (em uso: 24 LTS), Electron 45, Ollama 0.40.
- Máquina de referência: GTX 1060 6 GB, 16 GB de RAM. Modelo padrão `qwen3.5:2b`.
