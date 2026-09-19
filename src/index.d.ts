export interface Chunk { id: number; text: string; start: number; end: number }
export interface Range { lo: number; hi: number }
export interface Resolved extends Range { value: string; start: number; end: number }
export interface Sentence extends Range { id: number; text: string }
export type Chunker = (text: string) => { text: string; start: number; end: number }[];
export const chunkers: { tokens: Chunker; words: Chunker };

export interface Doc {
  readonly text: string;
  readonly chunks: Chunk[];
  readonly prefix: string;
  /** "id|chunk" lines for the model to read; optionally only some ranges. */
  list(ranges?: Range[]): string;
  /** { source_text, tokens: list() } */
  readonly state: { source_text: string; tokens: string };
  /** Bare-id options (null descriptions). Beyond `fanout` chunks they become balanced id ranges. */
  options(options?: { lo?: number; hi?: number; fanout?: number; also?: string[] }): Record<string, null>;
  /** "12" → {lo:12,hi:12}; "40-59" → {lo:40,hi:59}; anything else → null. */
  decode(choice: unknown): Range | null;
  resolve(lo: number, hi?: number, options?: { trim?: boolean }): Resolved;
  resolve(range: Range, options?: { trim?: boolean }): Resolved;
  sentences(): Sentence[];
}
export function index(text: string, options?: { chunker?: Chunker; prefix?: string }): Doc;
export function partition(lo: number, hi: number, fanout: number): Range[];
export function mergeChunks<K extends string = 'label'>(text: string, detections: ({ start: number; end: number; score: number } & Record<K, string>)[],
  options?: { threshold?: number; key?: K; joinable?: RegExp }): ({ start: number; end: number; score: number; value: string } & Record<K, string>)[];

export interface Usage { input_tokens: number; output_tokens: number }
export interface ChoiceQuestion { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
export interface ChoiceAnswer { choice: string; probabilities: Record<string, number>; confidence?: number }
export interface EvaluateRequest { state: unknown; questions: Record<string, ChoiceQuestion> }
export interface EvaluateResponse { answers: Record<string, ChoiceAnswer>; model?: string; usage?: Usage; provider?: string; rateLimitRetries?: number }
/**
 * The only thing the pipelines need from a model. TypeSafe's SDK fits as-is:
 * `request => client.systemOne(request)`. Throw an error with `code: 'max_tokens_exceeded'`
 * to let a pipeline shrink its request and retry.
 */
export type Evaluate = (request: EvaluateRequest) => Promise<EvaluateResponse>;

export interface Field { id: string; description: string }
export type FieldResult =
  | { status: 'extracted'; value: string; start: number; end: number; tokenStart: number; tokenEnd: number; probability: number }
  | { status: 'missing' | 'ambiguous'; value: null; probability: number };
export interface Decision { field: string; boundary: 'locate' | 'start' | 'end' | 'verify'; range: [number, number]; choice?: string; probabilities?: Record<string, number>; confidence?: number; speculative?: boolean; accepted?: boolean; candidates?: Record<string, string> }
export interface Round { call: number; boundary: 'locate' | 'start' | 'end' | 'verify'; durationMs: number; decisions: Decision[]; model?: string; provider?: string; usage?: Usage; speculative?: boolean; retry?: boolean; recovery?: string; request?: EvaluateRequest }
export interface ExtractOptions {
  text: string;
  fields: Field[];
  evaluate: Evaluate;
  /** Options per question, 2..253. Default 253 (point straight at a token). */
  fanout?: number;
  /** Ask for span ends alongside starts. Default true. */
  speculate?: boolean;
  minSpeculativeProbability?: number;
  /** Long text: find each field's sentence first. Default true. */
  locate?: boolean;
  /** Settle boundaries that have a rival token by comparing candidate spans. Default true. */
  verify?: boolean;
  /** A rival is any other token with at least this probability. Default 0.15. */
  rivalProbability?: number;
  trimPunctuation?: boolean;
  onRound?: (round: Round) => unknown;
  includeRequests?: boolean;
}
export interface ExtractResult { results: Record<string, FieldResult>; tokenCount: number; fanout: number; effectiveFanout: number; calls: number; durationMs: number; trace: Round[] }
export function extractSpans(options: ExtractOptions): Promise<ExtractResult>;

export interface Detection { id: number; value: string; start: number; end: number; label: string; score: number; probabilities: Record<string, number> }
export interface ClassifyOptions {
  text: string;
  /** Option name → description. Include a "nothing of interest" option (default key 'none') to get 1 - P(none) scores. */
  labels: Record<string, string>;
  evaluate: Evaluate;
  rules?: string;
  none?: string;
  chunker?: Chunker;
  maxBatch?: number;
  onBatch?: (event: unknown) => unknown;
}
export function classifyChunks(options: ClassifyOptions): Promise<{ detections: Detection[]; calls: number; inputTokens: number; durationMs: number; trace: unknown[] }>;

export { createJevClient, type JevClientOptions } from './client.js';
