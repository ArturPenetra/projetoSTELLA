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
  DEFAULT_AVATAR_TIMINGS,
  PAGE_MAX_CHARS,
  paginate,
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

export type { ToolCall, ToolSpec } from './llm/types.js';
export { NO_TOOL_USED_NOTE, TOOL_RESULTS_NOTE } from './chat/session.js';
export { IntentRouter, looksLikeFile } from './tools/router.js';
export {
  appEntrySchema,
  ToolFailure,
  ToolRefusal,
  toolSettingsSchema,
  toolSpec,
  type AppEntry,
  type Tool,
  type ToolContext,
  type ToolName,
  type ToolResult,
  type ToolRisk,
  type ToolSettings,
} from './tools/types.js';
export {
  notDone,
  refusalReply,
  ToolRunner,
  type ConfirmRequest,
  type ToolDecision,
  type ToolHost,
  type ToolLogEntry,
  type ToolOutcome,
  type ToolRunnerOptions,
} from './tools/runner.js';
export {
  createReadFileTool,
  isInside,
  MAX_READ_BYTES,
  TEXT_EXTENSIONS,
  type ReadFileOptions,
} from './tools/read-file.js';
export {
  APP_EXTENSIONS,
  createOpenAppTool,
  defaultLauncher,
  appNames,
  findApp,
  normalizeAppName,
  setAppAliases,
  type Launcher,
  type LaunchResult,
  type OpenAppOptions,
} from './tools/open-app.js';

// Voz
export { SentenceSplitter, speakable, type SentenceSplitterOptions } from './voice/sentences.js';
export { chunks, durationOf, parseWav, resampleLinear, type AudioClip } from './voice/audio.js';
export {
  asrConfigSchema,
  parseVoiceConfig,
  resolveVoiceModels,
  ttsConfigSchema,
  vadConfigSchema,
  voiceConfigSchema,
  VOICE_PRESETS,
  VoiceModelError,
  type AsrConfig,
  type ResolvedVoiceModels,
  type TtsConfig,
  type VadConfig,
  type VoiceConfig,
  type VoiceConfigInput,
} from './voice/config.js';
export {
  cleanTranscript,
  Listener,
  Synthesizer,
  type ListenerEvents,
  type ListenerOptions,
  type RecognizerBackend,
  type SynthesizedAudio,
  type TtsBackend,
  type VadBackend,
  type Voice,
} from './voice/engine.js';
export {
  createSherpaRecognizer,
  createSherpaTts,
  createSherpaVad,
  createVoiceEngine,
  loadSherpa,
  toPhonemeCodepoints,
  VOICE_SAMPLE_RATE,
  type Phonemizer,
  type SherpaTtsOptions,
  type VoiceEngine,
  type VoiceEngineOptions,
} from './voice/sherpa.js';
export {
  clausePunctuation,
  createEspeakPhonemizer,
  joinClauses,
  type EspeakOptions,
} from './voice/espeak.js';
export {
  COMMON_WORDS,
  createNameFixer,
  foldName,
  nameEntries,
  STELLA_NAME,
  type NameEntry,
} from './voice/names.js';
