import { describe, expect, it } from 'vitest';
import {
  isMicPermissionAllowed,
  isTrustedAppUrl,
  type MediaPermissionQuery,
} from './voice-permissions.js';

const base: MediaPermissionQuery = {
  permission: 'media',
  fromVoiceWindow: true,
  mediaTypes: ['audio'],
  requestingUrl: 'file:///D:/app/out/renderer/voice.html',
  devUrl: undefined,
};

describe('isMicPermissionAllowed', () => {
  it('libera só áudio para a janela de áudio do próprio app', () => {
    expect(isMicPermissionAllowed(base)).toBe(true);
  });

  it('nega câmera, mesmo junto com áudio', () => {
    expect(isMicPermissionAllowed({ ...base, mediaTypes: ['video'] })).toBe(false);
    expect(isMicPermissionAllowed({ ...base, mediaTypes: ['audio', 'video'] })).toBe(false);
  });

  it('nega pedido sem tipo de mídia informado', () => {
    expect(isMicPermissionAllowed({ ...base, mediaTypes: [] })).toBe(false);
    expect(isMicPermissionAllowed({ ...base, mediaTypes: undefined })).toBe(false);
  });

  it('nega outras janelas e outras permissões', () => {
    expect(isMicPermissionAllowed({ ...base, fromVoiceWindow: false })).toBe(false);
    expect(isMicPermissionAllowed({ ...base, permission: 'notifications' })).toBe(false);
    expect(isMicPermissionAllowed({ ...base, permission: 'display-capture' })).toBe(false);
  });

  it('nega páginas de fora do app', () => {
    expect(isMicPermissionAllowed({ ...base, requestingUrl: 'https://exemplo.com/' })).toBe(false);
    expect(isMicPermissionAllowed({ ...base, requestingUrl: undefined })).toBe(false);
  });

  it('em desenvolvimento aceita o servidor do Vite', () => {
    const dev = { ...base, devUrl: 'http://localhost:5173' };
    expect(
      isMicPermissionAllowed({ ...dev, requestingUrl: 'http://localhost:5173/voice.html' }),
    ).toBe(true);
    expect(isMicPermissionAllowed({ ...dev, requestingUrl: 'http://localhost:6000/' })).toBe(false);
  });
});

describe('isTrustedAppUrl', () => {
  it('devUrl vazio não libera tudo', () => {
    expect(isTrustedAppUrl('https://exemplo.com', '')).toBe(false);
  });
});
