import { describe, expect, it } from 'vitest';
import { isLoopbackHost, isLoopbackUrl, isRequestAllowed } from './network-policy.js';

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1', '127.5.6.7', 'localhost', 'LOCALHOST', '[::1]', '::1'])(
    'aceita %s',
    (host) => expect(isLoopbackHost(host)).toBe(true),
  );

  it.each([
    '0.0.0.0',
    '192.168.0.10',
    '10.0.0.1',
    'example.com',
    'localhost.evil.com',
    '128.0.0.1',
  ])('recusa %s', (host) => expect(isLoopbackHost(host)).toBe(false));
});

describe('isLoopbackUrl', () => {
  it('aceita o Ollama local', () => {
    expect(isLoopbackUrl('http://127.0.0.1:11434/api/chat')).toBe(true);
    expect(isLoopbackUrl('http://localhost:11434')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:11434')).toBe(true);
  });

  it('recusa endereços externos', () => {
    expect(isLoopbackUrl('https://api.openai.com/v1/chat/completions')).toBe(false);
    expect(isLoopbackUrl('http://0.0.0.0:11434')).toBe(false);
    expect(isLoopbackUrl('http://127.0.0.1.nip.io')).toBe(false);
  });

  it('recusa truque com usuário na URL', () => {
    expect(isLoopbackUrl('http://127.0.0.1@evil.com/')).toBe(false);
  });

  it('recusa protocolos que não são HTTP/WS e URLs inválidas', () => {
    expect(isLoopbackUrl('ftp://127.0.0.1')).toBe(false);
    expect(isLoopbackUrl('file:///C:/x')).toBe(false);
    expect(isLoopbackUrl('não é url')).toBe(false);
  });
});

describe('isRequestAllowed', () => {
  it('permite arquivos do app e devtools', () => {
    expect(isRequestAllowed('file:///D:/app/index.html')).toBe(true);
    expect(isRequestAllowed('devtools://devtools/bundled/x.js')).toBe(true);
    expect(isRequestAllowed('data:image/png;base64,AAA')).toBe(true);
  });

  it('permite o servidor de desenvolvimento local', () => {
    expect(isRequestAllowed('http://localhost:5173/src/main.ts')).toBe(true);
  });

  it('bloqueia a internet', () => {
    expect(isRequestAllowed('https://fonts.googleapis.com/css')).toBe(false);
    expect(isRequestAllowed('https://github.com')).toBe(false);
  });
});
