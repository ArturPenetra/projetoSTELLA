import type { StellaApi } from '../shared/ipc.js';
import type { VoiceState } from '../shared/voice.js';

/** O que a faixa da voz diz em cada estado (sem faixa quando desligada). */
export function voiceLabel(state: VoiceState, persona: string): string | undefined {
  switch (state.status) {
    case 'off':
      return undefined;
    case 'loading':
      return 'Carregando a voz… (na primeira vez pode levar alguns segundos)';
    case 'listening':
      return 'Ouvindo… pode falar.';
    case 'thinking':
      return `${persona} está pensando…`;
    case 'speaking':
      return `${persona} está falando · Esc interrompe`;
    case 'error':
      return `Não deu para ligar a voz: ${state.error ?? 'erro desconhecido'}`;
  }
}

/**
 * Botão "Voz" e a faixa de estado. A voz começa desligada a cada abertura; ligar carrega os
 * modelos e abre o microfone, desligar libera tudo.
 */
export function setupVoice(
  stella: StellaApi,
  options: {
    button: HTMLButtonElement;
    bar: HTMLElement;
    text: HTMLElement;
    persona: () => string;
    /** A fala do usuário reconhecida: aparece no chat como mensagem dele. */
    onHeard: (text: string) => void;
  },
): void {
  const { button, bar, text } = options;
  let state: VoiceState = { status: 'off' };

  const show = (next: VoiceState) => {
    state = next;
    const on = next.status !== 'off' && next.status !== 'error';
    button.dataset['status'] = next.status;
    button.setAttribute('aria-pressed', String(on));
    button.textContent = on ? 'Voz ligada' : 'Voz';
    button.title = on ? 'Desligar a voz (libera o microfone e a memória)' : 'Conversar por voz';
    const label = voiceLabel(next, options.persona());
    bar.hidden = label === undefined;
    bar.dataset['status'] = next.status;
    text.textContent = label ?? '';
  };

  button.addEventListener('click', () => {
    const on = state.status !== 'off' && state.status !== 'error';
    button.disabled = true;
    void stella.voice
      .setEnabled(!on)
      .then(show)
      .finally(() => (button.disabled = false));
  });

  stella.voice.onEvent((event) => {
    if (event.type === 'state') show(event.state);
    else options.onHeard(event.text);
  });
  void stella.voice.state().then(show);
}
