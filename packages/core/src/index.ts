export { APP_NAME } from './app.js';

export { isLoopbackHost, isLoopbackUrl, isRequestAllowed } from './network-policy.js';

export {
  appConfigSchema,
  ConfigError,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_OLLAMA_URL,
  defaultConfig,
  parseConfig,
  type AppConfig,
  type LlmConfig,
  type MemoryConfig,
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

export {
  ChatSession,
  DEFAULT_SPEAKER,
  DEFAULT_SYSTEM_PROMPT,
  SpeakerTagFilter,
  type ChatSessionOptions,
  type HistoryMessage,
  type SendOptions,
  type Speaker,
} from './chat/session.js';

export {
  AvatarDirector,
  BUBBLE_MAX_CHARS,
  DEFAULT_AVATAR_TIMINGS,
  fitBubble,
  type AvatarMood,
  type AvatarSnapshot,
  type AvatarTimings,
} from './avatar/director.js';

export type { CompleteOptions, Completer, Embedder } from './llm/types.js';
export {
  FactExtractor,
  parseFacts,
  type ExchangeToExtract,
  type ExtractedFact,
} from './memory/extractor.js';
export {
  formatMemoryPrompt,
  Memory,
  type ConversationMemory,
  type Exchange,
  type FormatOptions,
  type MemoryOptions,
} from './memory/memory.js';
export { MemoryStore, type Fact, type FactMatch, type NewFact } from './memory/store.js';

export {
  ELEMENT_NAMES,
  ELEMENTS,
  elementOf,
  isValidDayMonth,
  SIGN_NAMES,
  SIGNS,
  signsForDate,
  type ElementId,
  type SignId,
} from './personas/zodiac.js';
export {
  loadPersonaCatalog,
  parsePersona,
  PersonaCatalog,
  PersonaCatalogError,
  type Persona,
  type PersonaFile,
} from './personas/catalog.js';
export {
  affinityTable,
  article,
  idealSign,
  PREFERENCE_LABELS,
  PREFERENCES,
  suggest,
  suggestionReason,
  type Preference,
  type Suggestion,
} from './personas/affinity.js';
export {
  commonRules,
  handoffInstruction,
  personaSystemPrompt,
  signTalkNote,
  withArticle,
} from './personas/prompt.js';
