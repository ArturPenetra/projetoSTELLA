# Vozes mais naturais: candidatos a substituir o Kokoro

Pedido: "as vozes estão muito robóticas, queria algo mais fluido". Avaliado em 21/11/2026 na máquina de referência (i5-4440, 4 núcleos, Haswell). **Outros agentes rodavam síntese e reconhecimento ao mesmo tempo**: os tempos absolutos estão ~1,4x acima do normal (o Kokoro, que leva 1,3 s com a máquina livre, levou 1,8 s). Por isso Kokoro e Supertonic foram medidos **no mesmo processo, alternados**, e a comparação entre eles vale. Scripts, modelos e áudios em `models/voz/_tts2/` (fora do git).

## Decisão (21/11/2026)

O usuário ouviu as amostras e escolheu o **Supertonic 3 fp32** (vector estimator e vocoder fp32, 5 passos). Vozes: Leo M1 (1,15), Corni F3 (1,0), Aqua F1 (1,05), Pixi F2 (0,9). No app, com a máquina livre (`npm run voice:review`, duas rodadas): primeira palavra em **1,7 a 2,5 s, mediana 2,2 a 2,5 s** (com o Kokoro eram 2,3 a 3,4 s, mediana ~2,9 s). RAM do app com a voz ligada: 1,8 GB; depois de desligar, volta a ~530 MB. O espeak-ng deixou de ser baixado.

**Antes da escolha, ninguém tinha ouvido os áudios.** As medidas abaixo (reconhecimento de volta, pausas, variação de altura) só apontavam a direção.

## Recomendação

1. **Supertonic 3** (Supertone, 99M, OpenRAIL-M). Roda **na mesma `sherpa-onnx-node@2.0.2`** que o app já usa: nenhuma dependência nova, nada de onnxruntime-node, e já testado dentro do Electron 45. Lê o texto direto (sem espeak-ng), tem 10 vozes (5 F, 5 M), põe pausas nas vírgulas e pontos (o Kokoro fala tudo emendado) e é **~2x mais rápido** que o Kokoro fp32 nesta CPU. Protótipo pronto: `packages/core/src/voice/supertonic.ts`.
2. **Ficar no Kokoro fp32** (o atual), se ao ouvir o Supertonic não convencer.
3. Nenhum outro candidato serve hoje (tabela abaixo).

## Candidatos

| Candidato                               | Licença                                           | Uso comercial                           | Vozes pt                           | Como roda                                          | Resultado                                                                                                                          |
| --------------------------------------- | ------------------------------------------------- | --------------------------------------- | ---------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Supertonic 3** (2026-04-29)           | Pesos **OpenRAIL-M**; código MIT                  | **Sim**, com restrições de uso (abaixo) | 10 (F1–F5, M1–M5), 31 línguas      | sherpa-onnx (já no app) ou onnxruntime-node        | **Testado. Recomendado**                                                                                                           |
| Kokoro v1.0 fp32 (atual)                | Apache-2.0                                        | Sim                                     | vozes de várias línguas com IPA pt | sherpa-onnx + espeak-ng (GPL, programa à parte)    | Testado (referência)                                                                                                               |
| Pocket TTS pt (Kyutai, export KevinAHM) | CC-BY-4.0                                         | Sim, com atribuição                     | clonagem por áudio de referência   | sherpa-onnx (só o export em inglês)                | **Testado, falhou**: com os arquivos pt na sherpa, áudio sem fala (o Parakeet não reconheceu nada), 35–44 s por frase e 1,5 GB     |
| Kitsune-TTS V1 (VITS2, 39M, 5 vozes)    | **GPL-3.0 nos pesos**                             | Sim, mas copyleft                       | 5 (nomes de personagens de anime)  | ONNX próprio + espeak-ng; precisa onnxruntime-node | Não testado: pesos GPL e vozes com nomes de personagens (Emilia, Frieren, Zero Two...) sugerem dados de dublagem sem licença clara |
| Rápido TTS (edwixx, 21M)                | Apache-2.0                                        | Sim                                     | 1                                  | só PyTorch/Python                                  | Fora: precisa de Python e tem uma voz só                                                                                           |
| phonon-40m-pt (Gradium)                 | **CC BY-NC 4.0**                                  | **Não**                                 | ~100                               | Rust/GGUF                                          | Fora: não comercial                                                                                                                |
| Razo (voz Piper pt-BR)                  | MIT (dados e modelo base sem origem declarada)    | Incerto                                 | 1 masculina                        | sherpa-onnx (VITS)                                 | Fora: só uma voz masculina; mesma família do Piper                                                                                 |
| Piper pt_BR (dii, miro, faber)          | **CC BY-NC-SA 4.0**                               | **Não**                                 | 1 F, 1–2 M                         | sherpa-onnx                                        | Já descartado na Fase 7                                                                                                            |
| XTTS v2, F5-TTS pt-br, Chatterbox       | CPML (XTTS) e CC-BY-NC (F5 pt-br): não comerciais | Não (XTTS, F5)                          | clonagem                           | PyTorch, GPU                                       | Fora: pesados, precisam de Python/GPU (a GPU é do LLM) e licenças não comerciais                                                   |

### Licença do Supertonic 3 (OpenRAIL-M, BigScience, 2022)

- **Pode** usar, distribuir e vender, sem royalties.
- **Obrigações ao distribuir** (seção 4): incluir uma cópia da licença; incluir as **restrições de uso do Anexo A como cláusula da licença/termos do app** e avisar o usuário que o modelo está sujeito a elas; manter os avisos de copyright ("Copyright (c) 2026 Supertone Inc.").
- **Restrições de uso** (Anexo A): nada ilegal; não prejudicar menores; não gerar desinformação ou dados pessoais para prejudicar; não difamar ou assediar; não se passar por outra pessoa sem consentimento; **não publicar conteúdo gerado sem avisar que foi gerado por máquina** (item e); nada de decisões automáticas que afetem direitos; nada de discriminação. Para uma companheira local isso é natural, mas tem que estar escrito nos termos.
- O repositório da Supertone foi **arquivado** (sem novas versões nem suporte). Os pesos estão fixados por SHA-256 abaixo, então isso não muda nada no app.

## Velocidade e memória (Supertonic x Kokoro, mesmo processo, alternados, 5 rodadas)

"Curta" = "Oi, tudo bem com você?" (primeiro pedaço da resposta). "Típica" = frase de 15 palavras. Mínimo / mediana. O Kokoro inclui o espeak-ng (~0,12 s). O Supertonic é medido **antes** de cortar o silêncio das pontas (ver abaixo).

| Voz (2 threads)                                   | Curta             | Típica            | RTF (típica, áudio já sem silêncio) | Carga     | RAM carregado           | Taxa     |
| ------------------------------------------------- | ----------------- | ----------------- | ----------------------------------- | --------- | ----------------------- | -------- |
| Kokoro fp32 + espeak (atual)                      | 1,79 / 2,18 s     | 4,67 / 5,07 s     | 1,1                                 | 3,0 s     | +380 MB                 | 24000 Hz |
| Supertonic fp32, 3 passos                         | 0,67 / 0,69 s     | 1,55 / 1,78 s     | 0,33                                | 1,8–2,3 s | +420 MB                 | 44100 Hz |
| **Supertonic fp32, 5 passos**                     | **0,81 / 0,94 s** | **2,38 / 2,78 s** | **0,5**                             | 1,8 s     | +420 MB (pico ~510)     | 44100 Hz |
| Supertonic fp32, 8 passos (o padrão da Supertone) | 1,23 / 1,56 s     | 3,06 / 3,70 s     | 0,65                                | 1,9 s     | +420 MB                 | 44100 Hz |
| Supertonic int8, 5 passos                         | 0,97 / 1,08 s     | 2,28 / 2,93 s     | 0,5                                 | 1,6 s     | **+180 MB** (pico ~340) | 44100 Hz |

- Com a máquina livre, o Kokoro faz a curta em 1,3 s; na mesma proporção, o **Supertonic fp32 com 5 passos fica em ~0,6 s**. Isso tira ~0,7 s da latência até a primeira palavra (hoje ~2,9 s → estimado **~2,2 s**). Não foi medido com o `voice:review`.
- **Silêncio nas pontas:** o Supertonic devolve ~0,55 s de zeros no começo e ~0,4 s no fim de toda frase (média de 50 áudios; o Kokoro, 0,05 s). Sem cortar, a primeira palavra atrasa meio segundo e fica um buraco de ~1 s entre frases. O protótipo corta (`trimSilence`, folga de 20 ms antes e 60 ms depois). As pausas do meio da frase ficam.
- **Passos:** 2 passos estraga (o Parakeet entendeu metade); 3 passos já entende tudo, mas o áudio bate no pico (1,0, risco de chiado); 5 e 8 ficam limpos (pico ~0,35). **5 é o padrão do protótipo**; se 5 soar áspero, 8 custa +0,4 s na curta.
- **int8 x fp32:** na sherpa, só o vector estimator e o vocoder do pacote "int8" são quantizados (os outros dois são idênticos ao fp32, mesmo SHA-256). Nesta CPU a velocidade empatou; o int8 usa 240 MB a menos de RAM e é 250 MB menor para baixar. Qualidade não comparável sem ouvir (ida e volta: 5,1% x 4,2%, quase tudo nomes).
- 4 threads ficou mais lento (como o Kokoro e o Parakeet): use 2.
- Dentro do Electron 45.3.3 (`ELECTRON_RUN_AS_NODE`, como o `check:native`): carregou e sintetizou normalmente.

## Inteligibilidade e "naturalidade" medidas

Ida e volta pelo Parakeet (o reconhecimento do app). WER bruto conta nomes ("Corni" → "Corne", "Pixi" → "Pixie", "Stella" → "Estela") como erro. "Pausas" = silêncios ≥ 150 ms no meio da frase. "Saltos" = quadros com a altura pulando mais de 4 semitons de um para o outro (estalo, voz "quebrando"; quanto menos, melhor).

| Conjunto                                | Áudios | WER bruto | Pausas por frase | Variação de altura (desvio, semitons) | Saltos |
| --------------------------------------- | ------ | --------- | ---------------- | ------------------------------------- | ------ |
| Kokoro fp32 (vozes atuais das personas) | 16     | 5,5%      | **0,1** (0,02 s) | 3,9                                   | 5,2%   |
| Supertonic, 10 vozes, 8 passos          | 50     | 6,9%      | **1,4** (0,50 s) | 3,2                                   | 2,2%   |
| Supertonic, personas, fp32, 5 passos    | 16     | 4,2%      | 1,6 (0,54 s)     | 3,7                                   | 3,1%   |
| Supertonic, personas, int8, 5 passos    | 16     | 5,1%      | 1,6 (0,54 s)     | 3,6                                   | 2,8%   |

- Tirando os nomes, o Supertonic quase não erra palavras. O Kokoro trocou "sem pressa" por "ser impressa"/"sem impressa" em 3 de 4 vozes e "Bora" por "Ora".
- A maior diferença objetiva é a **pausa**: o Kokoro não para nas vírgulas nem nos pontos; o Supertonic para ~0,25 s em cada uma, como uma pessoa. Também tem menos "saltos" de altura. É o indício mais forte de que vai soar menos robótico, mas **precisa ser ouvido**.
- **Números:** com dígitos, duas vozes leram "40" como "4" ("3 horas e 4 minutos"). O protótipo escreve os números por extenso antes (`supertonicText`: "3h40" → "três horas e quarenta"); por extenso, todas as vozes acertaram.
- **Nomes:** "Corni" sai como "Corne/Corny" em quase todas as vozes (o "i" final fica fraco) e "Stella" como "Estela" (o mesmo de antes). "Córni" e "Kórni" não resolveram de forma estável (`nome-supertonic3-*.wav`). Combine com o trabalho de pronúncia de nomes em andamento.
- "tô" e "pra" às vezes viraram "estou" e "para" no reconhecimento; pode ser o Parakeet normalizando. Ouvir.

## Vozes por persona (Supertonic 3)

Altura medida (mediana). `speed` muda o andamento sem mudar a altura (0,85 → +18% de duração, 1,3 → −23%).

| Persona                           | Voz            | speed | Altura  | Por quê                                                       | Alternativa                         |
| --------------------------------- | -------------- | ----- | ------- | ------------------------------------------------------------- | ----------------------------------- |
| Leo (masculino, enérgico, rápido) | **M1** (sid 5) | 1,15  | ~135 Hz | a voz masculina com mais variação de altura (mais expressiva) | M4 (sid 8), mais contida            |
| Corni (feminina, firme, média)    | **F3** (sid 2) | 1,0   | ~170 Hz | feminina mais grave, estável, boa variação                    | F5 (sid 4), mais grave e mais plana |
| Aqua (feminina, clara)            | **F1** (sid 0) | 1,05  | ~190 Hz | média, articulada, poucos saltos                              | F4 (sid 3), mais plana              |
| Pixi (feminina, suave, lenta)     | **F2** (sid 1) | 0,9   | ~210 Hz | a mais aguda e expressiva; mais lenta, pausas mais longas     | F5 (sid 4) a 0,9                    |

M2, M3 e M5 são graves (~90–105 Hz), boas para personas masculinas futuras.

## Plano de integração

**Dependências:** nenhuma nova. `sherpa-onnx-node@2.0.2` (já no app) traz o Supertonic. Não há risco de conflito de `onnxruntime.dll` (que haveria com onnxruntime-node no mesmo processo que a sherpa: o Windows reaproveita a DLL de mesmo nome já carregada). O espeak-ng deixa de ser necessário para a síntese (continua no pacote só se o Kokoro ficar como opção).

**Arquivos para o `models:pull` / `config/models.lock.json`** (variante recomendada: fp32 nos dois modelos grandes, ~418 MB):

| Arquivo (pasta em `models/voz/`)                                                                                                               | Origem                                                                                                                  | Tamanho     | SHA-256                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2` (duration predictor, text encoder, tts.json, unicode_indexer.bin, voice.bin, e os int8) | https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2 | 128.774.318 | `82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427` |
| `supertonic-3/onnx/vector_estimator.onnx` (fp32)                                                                                               | https://huggingface.co/Supertone/supertonic-3/resolve/main/onnx/vector_estimator.onnx                                   | 256.534.781 | `883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c` |
| `supertonic-3/onnx/vocoder.onnx` (fp32)                                                                                                        | https://huggingface.co/Supertone/supertonic-3/resolve/main/onnx/vocoder.onnx                                            | 101.424.195 | `085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba` |
| `supertonic-3/LICENSE` (OpenRAIL-M, distribuir junto)                                                                                          | https://huggingface.co/Supertone/supertonic-3/resolve/main/LICENSE                                                      | 15.007      | `0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f` |

Dentro do tar: `vector_estimator.int8.onnx` `20cd86fa…db3fd`, `vocoder.int8.onnx` `e923d60f…6152`, `voice.bin` `67d5209b…a93ce8`, `unicode_indexer.bin` `8402ca48…b30`, `tts.json` `42078d3a…0d09` (igual ao do Hugging Face), `duration_predictor.int8.onnx` `c3eb9141…25db` e `text_encoder.int8.onnx` `c7befd5e…02ff` (iguais aos fp32 do Hugging Face). Para a variante int8, basta o tar (~139 MB extraído). Os hashes completos estão em `models/voz/_tts2/` (`sha256sum`).

**Passos depois da decisão** (fora deste protótipo, porque outro agente mexe nesses arquivos):

1. `config.ts`: um terceiro `kind: 'supertonic'` no `ttsConfigSchema` com os 7 arquivos, `lang`, `numSteps`, `sid` e `speed`, reaproveitando `supertonicConfigSchema`; preset `VOICE_PRESETS.tts.supertonic` a partir de `SUPERTONIC_PRESET`.
2. `sherpa.ts`/`createVoiceEngine`: com `kind === 'supertonic'`, criar com `createSupertonicTts` (sem fonetizador).
3. `voice-config.ts` e o worker: não exigir o espeak-ng quando a voz for Supertonic.
4. Persona: trocar `sid`/`speed` pelos da tabela acima (`F1`…`M5` em `SUPERTONIC_VOICES`).
5. `models:pull` + lock com os arquivos acima; créditos: "Supertonic 3 by Supertone Inc., OpenRAIL-M" e as restrições de uso nos termos do app.
6. Rodar `npm run voice:review` e medir a latência real.

**Riscos:**

- Qualidade percebida: só ouvindo. Se 5 passos soar áspero, use 8 (+0,4 s).
- 44,1 kHz: ~1,8x mais amostras pelo IPC que o Kokoro (24 kHz); o renderer já toca qualquer taxa. Se pesar, reamostrar para 24 kHz no worker.
- Nomes próprios ("Corni") e números com dígitos: tratar no texto antes (o protótipo já trata números).
- Upstream arquivado: sem correções futuras da Supertone; a sherpa continua mantendo o runtime.
- A frase inteira é gerada de uma vez (não há streaming por pedaço dentro da frase), igual ao Kokoro hoje.

## Protótipo

- `packages/core/src/voice/supertonic.ts`: `createSupertonicTts(config)` implementa `TtsBackend` (`sampleRate` 44100; `generate(text, { sid, speed })`), com `supertonicConfigSchema` (zod), `resolveSupertonicConfig`, `SUPERTONIC_PRESET`, `SUPERTONIC_VOICES`, `supertonicText` (números por extenso) e `trimSilence`. Ainda não está ligado ao app.
- `supertonic.test.ts`: testes com sherpa falsa (29). `supertonic.models.test.ts`: modelo real, pulado se os arquivos não existirem (procura em `models/voz`, depois `models/voz/_tts2`); com o Parakeet presente, faz a ida e volta.

## Áudios para ouvir (`D:\ProjetoSTELLA\models\voz\_tts2\amostras\`)

Frases: (a) "Oi! Que bom que você voltou...", (b) "Eu acho que você consegue terminar isso...", (c) "Bora! Hoje é dia de fazer acontecer...", (d) "A Corni e a Pixi disseram que são três horas e quarenta minutos.", (e, só no Supertonic) "São 3 horas e 40 minutos, tá? A Stella já chegou."

**Comece por aqui** (Kokoro atual x Supertonic proposto, mesma persona):

| Persona | Kokoro atual                    | Supertonic proposto (fp32, 5 passos, sem silêncio nas pontas) | Mesmo, int8                                    |
| ------- | ------------------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| Leo     | `kokoro-leo-43-{a,b,c,d}.wav`   | `persona-supertonic3-leo-M1-x1.15-{a,b,c,d}.wav`              | `persona-int8-supertonic3-leo-M1-x1.15-*.wav`  |
| Corni   | `kokoro-corni-42-{a,b,c,d}.wav` | `persona-supertonic3-corni-F3-x1-{a,b,c,d}.wav`               | `persona-int8-supertonic3-corni-F3-x1-*.wav`   |
| Aqua    | `kokoro-aqua-35-{a,b,c,d}.wav`  | `persona-supertonic3-aqua-F1-x1.05-{a,b,c,d}.wav`             | `persona-int8-supertonic3-aqua-F1-x1.05-*.wav` |
| Pixi    | `kokoro-pixi-28-{a,b,c,d}.wav`  | `persona-supertonic3-pixi-F2-x0.9-{a,b,c,d}.wav`              | `persona-int8-supertonic3-pixi-F2-x0.9-*.wav`  |

Alternativas por persona: `persona-supertonic3-{leo-alt-M4-x1.15, corni-alt-F5-x1, aqua-alt-F4-x1.05, pixi-alt-F5-x0.9}-{a,b,c,d}.wav`.

Todas as 10 vozes (fp32, 8 passos, sem cortar o silêncio): `supertonic3-{F1..F5,M1..M5}-{a,b,c,d,e}.wav`.

Passos (F2, frase b): `passos-supertonic3-F2-b-{2,3,5,8,12}passos.wav`. Velocidade (M1, frase c): `velocidade-supertonic3-M1-c-x{0.85,1,1.15,1.3}.wav`. Nomes: `nome-supertonic3-{F3,M1}-{Corni,Córni,Kórni,Stella,Stéla,Pixi,Leo,Léo,Aqua,Áqua}.wav`.

Pocket TTS (falhou, só para registro): `pocketpt-ref_{bria,ptbr}-*.wav`.
