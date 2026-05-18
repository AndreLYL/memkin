/**
 * LLM Provider interface and types
 * Unified interface for calling Language Models
 */

/**
 * Chat message in the OpenAI format
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Options for LLM chat completion
 */
export interface LLMOpts {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
}

/**
 * LLM Provider interface
 * Implementations provide chat completion functionality
 */
export interface LLMProvider {
  chat(messages: ChatMessage[], opts?: LLMOpts): Promise<string>;
}
