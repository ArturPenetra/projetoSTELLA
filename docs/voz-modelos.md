# Modelos de voz: avaliação (Fase 7)

Medido em 21/11/2026 na máquina de referência (i5-4440, 4 núcleos, sem GPU para o sherpa) com `sherpa-onnx-node@2.0.2`, Node 26. Outros agentes rodavam testes ao mesmo tempo, então os tempos têm ruído de ±20%. Os scripts estão em `models/voz/_avaliacao/` e os áudios para ouvir em `models/voz/_avaliacao/wav/`.

## Decisão final (usada no app)

| Parte   | Modelo                                                                 | Configuração                                                                        |
| ------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| VAD     | `silero_vad_v5.onnx`                                                   | 16 kHz, janela de 512, threshold 0,5, **silêncio mínimo 0,4 s**, fala mínima 0,25 s |
| ASR     | **Parakeet TDT 0.6b v3 int8**                                          | `nemo_transducer`, greedy, 2 threads                                                |
| Fonemas | **espeak-ng.exe** (programa separado, GPL-3)                           | `-q --ipa -v pt-br --stdin`                                                         |
| TTS     | **Kokoro v1.0 multilíngue fp32** (`kokoro-multi-lang-v1_0/model.onnx`) | 2 threads, `phonemeCodepoints`                                                      |

A avaliação abaixo recomendava Piper porque só testou o Kokoro **int8**. Depois dela, o Kokoro **fp32** foi medido com a máquina livre e é 3x mais rápido nesta CPU (Haswell não acelera int8):

| Voz (2 threads, com espeak-ng) | Frase curta (5 palavras) | Frase de 15 palavras |
| ------------------------------ | ------------------------ | -------------------- |
| Kokoro int8                    | 3,4 s (RTF 1,8)          | 8,3 s (RTF 2,0)      |
| **Kokoro fp32**                | **1,3 s (RTF 0,7)**      | **3,2 s (RTF 0,8)**  |
| Piper dii                      | 0,7 s (RTF 0,5)          | 1,9 s (RTF 0,4)      |

Ficou o Kokoro fp32: licença Apache-2.0 (as vozes Piper pt_BR são CC BY-NC-SA, sem uso comercial) e vozes diferentes para cada persona. Com 4 threads ficou mais lento (disputa com o resto do app). As vozes de outras línguas falando com fonemas do português foram entendidas sem erro pelo Parakeet:

| Persona | Voz Kokoro     | Velocidade |
| ------- | -------------- | ---------- |
| Leo     | `pm_alex` (43) | 1,1        |
| Corni   | `pf_dora` (42) | 1,0        |
| Aqua    | `if_sara` (35) | 1,0        |
| Pixi    | `ef_dora` (28) | 0,9        |

Latência medida com `npm run voice:review` (do fim da fala do usuário até o áudio da primeira frase pronto, com o qwen3.5:2b): **2,3 a 3,4 s, mediana ~2,9 s**. Ouvir ~1 s (0,4 s de silêncio + reconhecimento), pensar ~0,6 s, falar 0,7 a 1,5 s. Para a primeira palavra sair antes, o primeiro pedaço da resposta para na primeira vírgula ou é cortado numa palavra depois de ~36 letras. **Aceito em 21/11/2026** no lugar da meta de ~2 s: a alternativa mais rápida (Piper, ~2,2 s) tem licença não comercial e uma só voz feminina rápida.

RAM do app (soma dos processos): 425 MB sem voz, 1,8 GB com a voz ligada, 534 MB depois de desligar (o processo de voz é encerrado).

## Avaliação inicial (agente, só com Kokoro int8)

Kokoro (int8) e Whisper ficaram de fora nesta etapa porque são lentos demais nesta CPU (tabelas abaixo).

## Armadilha principal: o sherpa 2.x não tem espeak-ng

A partir da 2.0, o sherpa-onnx não traz mais o espeak-ng. As opções `kokoro.lang` e `dataDir` são **ignoradas** (só aparece um aviso no log de debug).

- Com o Kokoro, palavras em português viram OOV e são **puladas sem erro**. "Você não está sozinha" sai como um silêncio de 1,3 s.
- Com o Piper, a geração falha com `TTS generation produced no audio`.

O caminho que funciona: o texto passa pelo `espeak-ng.exe`, que devolve IPA, e o IPA entra em `generationConfig.phonemeCodepoints`. O IPA desse executável é **idêntico** ao que o espeak embutido no `sherpa-onnx-node@1.13.8` gerava, então é o mesmo formato com que os modelos foram treinados. A comparação foi feita instalando a 1.13.8 numa pasta isolada.

Detalhes do fonemizador (`_avaliacao/espeak.cjs`):

- Separe as orações nas pontuações `, ; : . ! ?` e mande cada uma numa linha, terminada pela própria pontuação. Recoloque a pontuação depois do IPA de cada linha: os modelos têm tokens de pontuação. Se o número de linhas não bater com o de orações, junte tudo.
- Normalize com **NFD**: `ɐ̃` = `ɐ` + U+0303, e os dois tokens.txt têm o til combinante sozinho. Depois tire o que não estiver no tokens.txt. Nos testes, nenhum caractere foi descartado.
- **Não "corrija" o IPA do espeak.** `æ` no `a` final átono (`stˈɛlæ`), `y` no `e` final (`ˈoʒy`, `tʃy`), `ə` epentético (`tˈaɾədʒy`), `x` para o `rr` e os acentos `ˈ ˌ` são do pt-BR do espeak, e os modelos aprenderam com eles. Trocar `æ` por `ɐ` sai do que os modelos conhecem.
- Números já são lidos (`3` → `trˈez`). Abreviações não: "Sr." é soletrado (`ˌɛsyˈɛxe`) e o ponto quebra a frase. Expanda abreviações antes.
- Abrir o processo custa **~110–150 ms** por chamada, e isso fica no caminho crítico. Faça uma chamada por bloco e fonemize a próxima frase enquanto a atual toca.
- `generateAsync` ainda exige `text` (qualquer string). Passe `sid` e `speed` também dentro do `generationConfig`.

## ASR

Teste com `pt_br.wav` (4,6 s) e com ida e volta: 5 frases sintetizadas por 6 vozes (30 áudios).

| Modelo                        | Carga     | RAM carregado | Pico   | pt_br.wav | Média por frase (2–4 s) | RTF      | Acertos (ida e volta)                           |
| ----------------------------- | --------- | ------------- | ------ | --------- | ----------------------- | -------- | ----------------------------------------------- |
| Parakeet int8, 2 threads      | 3,5–4,7 s | +691 MB       | 858 MB | 747 ms    | ~0,4–0,7 s              | **0,18** | 29/30 frases certas, tirando o nome             |
| Parakeet int8, 4 threads      | 3,5 s     | +691 MB       | 859 MB | 884 ms    | igual                   | 0,20     | texto idêntico                                  |
| Whisper small int8, 2 threads | 3,2 s     | +427 MB       | 868 MB | 4229 ms   | 2,0–3,7 s               | 0,96     | 3 erros em palavras ("tão", "cacé", "O Estela") |
| Whisper small int8, 4 threads | 3,5 s     | +429 MB       | 855 MB | 5205 ms   | igual                   | 0,94     | —                                               |

- O Parakeet põe pontuação e maiúsculas. Ele ouve "Stella" como **"Estela"** sempre: corrija no texto. O único erro fora isso foi "Abra" no lugar de "Abre", com a dii.
- O Whisper analisa uma janela fixa de 30 s, então leva ~2 s mesmo para frases curtas.
- Com 4 threads fica igual ou pior: a CPU tem 4 núcleos e o resto do app disputa com ela. Use 2.

## TTS

O tempo inclui o espeak (~0,12 s). "Curta" tem 5 palavras e "típica" tem 15.

| Modelo / voz                    | Carga     | RAM                        | Curta     | Típica    | RTF       | Taxa     | F0 mediana          |
| ------------------------------- | --------- | -------------------------- | --------- | --------- | --------- | -------- | ------------------- |
| Piper **dii** (F)               | 3,6–6 s   | +68 MB (~+170 MB gerando)  | 0,7–1,0 s | 1,7–2,1 s | 0,40–0,55 | 22050 Hz | ~187 Hz (feminina)  |
| Piper **miro** (M)              | 4,0–4,4 s | +68 MB                     | 0,85 s    | 1,8–1,9 s | 0,40–0,55 | 22050 Hz | ~104 Hz (masculina) |
| Kokoro int8, pf_dora 42         | 2,1 s     | +186 MB (~+430 MB gerando) | 4,2 s     | 8,6 s     | **~2,0**  | 24000 Hz | 173 Hz              |
| Kokoro pm_alex 43 / pm_santa 44 | —         | —                          | 4,3–4,4 s | 8,5–9,5 s | 2,0–2,2   | —        | 132 Hz              |
| Kokoro com 4 threads (42)       | —         | —                          | 6,5 s     | 12 s      | 2,8–3,1   | —        | —                   |

- Na ida e volta pelo Parakeet, Piper e Kokoro dão o mesmo texto, com acentos, "você", "pão", "coração" e "3 horas". A qualidade da pronúncia está boa; o problema do Kokoro é só a velocidade.
- **No Piper, `speed` mexe pouco:** 0,8 deixa ~9% mais lento e 1,25 ~10% mais rápido (`lengthScale` faz o mesmo). Cada execução ainda varia ~3% sozinha.
- O Kokoro int8 nesta CPU (Haswell) leva o dobro do tempo real. A versão fp32 talvez seja mais rápida, mas não foi testada.

## Vozes por persona

Só existe **uma voz feminina pt-BR rápida o bastante** (dii). Para separar as três personas femininas, use o "tom": gere com o `speed` desejado e toque declarando a taxa como `sampleRate × tom`. Isso sobe ou desce a altura e o andamento juntos, com resultado previsível.

| Persona | Voz  | speed | tom (taxa ×) | Duração da frase de teste | F0     | Ida e volta            |
| ------- | ---- | ----- | ------------ | ------------------------- | ------ | ---------------------- |
| Leo     | miro | 1,15  | 1,0          | 6,08 s                    | 106 Hz | ok                     |
| Corni   | dii  | 1,0   | 1,0          | 6,27 s                    | 210 Hz | ok                     |
| Aqua    | dii  | 1,1   | 0,94         | 6,34 s                    | 199 Hz | ok                     |
| Pixi    | dii  | 0,7   | 1,06         | 6,99 s                    | 227 Hz | "Toi" no lugar de "Oi" |

Corni, Aqua e Pixi se distinguem, mas pouco: é a mesma voz. Os arquivos para ouvir são `wav/persona-*.wav`. Uma voz feminina de verdade diferente só sai do Kokoro (`if_sara` 35: 214 Hz e boa ida e volta; `pf_dora` 42), que hoje é lento demais.

## Latência estimada (sem o LLM)

| Etapa                                            | Tempo     |
| ------------------------------------------------ | --------- |
| Silêncio até o VAD fechar a fala                 | 0,5 s     |
| Parakeet numa frase de 2–3 s                     | 0,4–0,6 s |
| espeak + Piper no primeiro trecho de ~5 palavras | 0,7–1,0 s |

Isso soma ~1,6–2,1 s **mais** o tempo do LLM até a primeira frase. Para caber em ~2 s:

- baixe `minSilenceDuration` para 0,4;
- fale primeiro a primeira oração (até a vírgula);
- fonemize em paralelo com a fala.

## RAM

Ao soltar as referências e rodar o GC, a RSS volta a ~65–75 MB em todos os modelos. Antes estava entre 200 e 860 MB, e a base do processo é ~35–50 MB. O JS do sherpa **não tem** `free`/`release`/`destroy`: a memória nativa é liberada pelos finalizadores do N-API no GC. Matar o `utilityProcess` ao desligar a voz resolve de vez. O VAD ocupa +29 MB e leva ~0,3–0,5 ms por janela.

## Licenças

| Item                 | Licença                                      | Observação                                                                          |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Parakeet TDT 0.6b v3 | CC-BY-4.0 (NVIDIA); export sherpa Apache-2.0 | Atribuição obrigatória: "parakeet-tdt-0.6b-v3 by NVIDIA, CC BY 4.0"                 |
| Silero VAD v5        | MIT                                          | —                                                                                   |
| Piper dii / miro     | **CC BY-NC-SA 4.0**                          | **Proíbe uso comercial** e exige incluir a licença                                  |
| Kokoro v1.0          | Apache-2.0                                   | —                                                                                   |
| Whisper              | MIT                                          | —                                                                                   |
| espeak-ng            | **GPL-3.0**                                  | Roda como programa separado; distribua a licença e indique onde está o código-fonte |

## Configurações (caminhos relativos à pasta do modelo; resolva para absoluto)

```js
// VAD: new Vad(vadConfig, 30)
const vadConfig = {
  sileroVad: {
    model: 'silero_vad_v5.onnx',
    threshold: 0.5,
    minSilenceDuration: 0.5,
    minSpeechDuration: 0.25,
    maxSpeechDuration: 20,
    windowSize: 512,
  },
  sampleRate: 16000,
  numThreads: 1,
  debug: 0,
};

// ASR: await OfflineRecognizer.createAsync(asrConfig)
// pasta sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/
const asrConfig = {
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: 'encoder.int8.onnx',
      decoder: 'decoder.int8.onnx',
      joiner: 'joiner.int8.onnx',
    },
    tokens: 'tokens.txt',
    modelType: 'nemo_transducer',
    numThreads: 2,
    provider: 'cpu',
    debug: 0,
  },
  decodingMethod: 'greedy_search',
};
// const s = rec.createStream(); s.acceptWaveform({ samples, sampleRate: 16000 }); const { text } = await rec.decodeAsync(s);

// TTS: await OfflineTts.createAsync(ttsConfig); pasta vits-piper-pt_BR-dii-high-int8/ (ou miro)
const ttsConfig = {
  model: {
    vits: { model: 'pt_BR-dii-high.onnx', tokens: 'tokens.txt' },
    numThreads: 2,
    provider: 'cpu',
    debug: 0,
  },
  maxNumSentences: 1,
};
// phonemeCodepoints: number[][] (uma lista por frase; IPA do espeak-ng em NFD, filtrado pelo tokens.txt)
// const a = await tts.generateAsync({ text, sid: 0, speed, generationConfig: { sid: 0, speed, phonemeCodepoints } });
// tocar a.samples com sampleRate = a.sampleRate * tom   (22050 Hz na base)
```

Outras armadilhas:

- O `pt_br.wav` de teste é de 22050 Hz. O VAD só aceita 16 kHz: reamostre antes com `LinearResampler`. O reconhecedor até reamostra sozinho, mas imprime um aviso no stderr a cada stream.
- O Parakeet pede para cortar áudios longos em silêncios, com no máximo 15–20 s por trecho (`maxSpeechDuration: 20` no VAD).
