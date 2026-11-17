import type { LlmStatus } from '@stella/core';
import type { ChatEvent, StellaApi } from '../shared/ipc.js';
import { cleanIpcError, setupMemoryPanel } from './memory-panel.js';

declare global {
  interface Window {
    stella: StellaApi;
  }
}

const { stella } = window;

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} não encontrado`);
  return el as T;
}

const messages = $<HTMLElement>('messages');
const empty = $<HTMLElement>('empty');
const form = $<HTMLFormElement>('composer');
const input = $<HTMLTextAreaElement>('input');
const sendButton = $<HTMLButtonElement>('send');
const resetButton = $<HTMLButtonElement>('reset');
const banner = $<HTMLElement>('banner');
const bannerText = $<HTMLElement>('banner-text');
const retryButton = $<HTMLButtonElement>('retry');
const statusDot = $<HTMLElement>('status-dot');

let currentRequest: string | undefined;
let currentBubble: HTMLElement | undefined;

function addBubble(kind: 'user' | 'assistant' | 'error', text: string): HTMLElement {
  empty.hidden = true;
  const bubble = document.createElement('div');
  bubble.className = `msg ${kind}`;
  bubble.textContent = text;
  messages.append(bubble);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

function setBusy(busy: boolean): void {
  sendButton.textContent = busy ? 'Parar' : 'Enviar';
  sendButton.classList.toggle('stop', busy);
}

function showStatus(status: LlmStatus): void {
  statusDot.dataset['state'] = status.state;
  if (status.state === 'ready') {
    statusDot.title = `Ollama ${status.version} · ${status.model}`;
    banner.hidden = true;
    return;
  }
  bannerText.textContent =
    status.state === 'unavailable'
      ? status.message
      : `O modelo "${status.model}" não está instalado. Rode "npm run models:pull" e tente de novo.`;
  statusDot.title = bannerText.textContent;
  banner.hidden = false;
}

async function refreshStatus(): Promise<void> {
  showStatus(await stella.llm.status());
}

function finish(): void {
  currentBubble?.classList.remove('pending');
  currentBubble = undefined;
  currentRequest = undefined;
  setBusy(false);
  input.focus();
}

stella.chat.onEvent((event: ChatEvent) => {
  if (event.requestId !== currentRequest || !currentBubble) return;
  switch (event.type) {
    case 'token':
      currentBubble.textContent += event.text;
      messages.scrollTop = messages.scrollHeight;
      break;
    case 'done':
      finish();
      break;
    case 'error':
      if (!currentBubble.textContent) currentBubble.remove();
      if (event.code !== 'aborted') addBubble('error', event.message);
      finish();
      if (event.code === 'unavailable' || event.code === 'model_missing') void refreshStatus();
      break;
  }
});

async function send(): Promise<void> {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addBubble('user', text);
  const bubble = addBubble('assistant', '');
  bubble.classList.add('pending');
  currentBubble = bubble;
  setBusy(true);
  try {
    const { requestId } = await stella.chat.send(text);
    currentRequest = requestId;
  } catch (err) {
    bubble.remove();
    addBubble('error', cleanIpcError(err));
    finish();
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (currentRequest) {
    void stella.chat.cancel(currentRequest);
  } else if (!currentBubble) {
    void send();
  }
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

resetButton.addEventListener('click', () => {
  void stella.chat.reset();
  messages.querySelectorAll('.msg').forEach((m) => m.remove());
  empty.hidden = false;
  finish();
});

retryButton.addEventListener('click', () => void refreshStatus());

const memoryPanel = setupMemoryPanel(stella, $<HTMLButtonElement>('memory-open'));

// Transparência: quando a Stella guarda algo, aparece um aviso discreto na conversa.
stella.memory.onEvent((event) => {
  if (event.type !== 'added') return;
  for (const fact of event.facts) {
    empty.hidden = true;
    const note = document.createElement('button');
    note.type = 'button';
    note.className = 'msg note';
    note.textContent = `Guardei na memória: ${fact.text}`;
    note.title = 'Ver ou apagar o que a Stella lembra';
    note.addEventListener('click', () => memoryPanel.open());
    messages.append(note);
  }
  messages.scrollTop = messages.scrollHeight;
});

void refreshStatus();
setInterval(() => void refreshStatus(), 10_000);
input.focus();
