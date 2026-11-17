export const APP_NAME = 'Stella';

export { isLoopbackHost, isLoopbackUrl, isRequestAllowed } from './network-policy.js';

export {
  appConfigSchema,
  ConfigError,
  DEFAULT_CHAT_MODEL,
  DEFAULT_OLLAMA_URL,
  defaultConfig,
  parseConfig,
  type AppConfig,
  type LlmConfig,
} from './config/schema.js';

export type {
  ChatChunk,
  ChatMessage,
  ChatOptions,
  ChatRole,
  ChatStats,
  LlmClient,
  LlmStatus,
} from './llm/types.js';
export { LlmError, isAbortError, type LlmErrorCode } from './llm/errors.js';
export { OllamaClient, sameModel, type OllamaClientOptions } from './llm/ollama.js';

export { ChatSession, DEFAULT_SYSTEM_PROMPT, type ChatSessionOptions } from './chat/session.js';

export {
  AvatarDirector,
  BUBBLE_MAX_CHARS,
  DEFAULT_AVATAR_TIMINGS,
  fitBubble,
  type AvatarMood,
  type AvatarSnapshot,
  type AvatarTimings,
} from './avatar/director.js';
