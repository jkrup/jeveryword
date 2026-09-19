import type { Evaluate } from './index.js';
export interface JevClientOptions {
  /** TypeSafe API key. With `gateway` also set, this is the fallback route. */
  apiKey?: string;
  /** Vercel AI Gateway credentials; tried first when present. */
  gateway?: { token: string; authMethod?: 'api-key' | 'oidc' };
  model?: string;
  onRetry?: (event: { retry: number; delayMs: number; message: string }) => unknown;
  onFallback?: (event: { from: string; to: string; message: string }) => unknown;
  sleep?: (ms: number) => Promise<unknown>;
  shouldContinue?: () => boolean;
}
export function createJevClient(options: JevClientOptions): Evaluate & { readonly endpoint: string; readonly model: string; readonly provider: 'typesafe' | 'gateway' };
export function retryDelay(value: string | null | undefined, retry: number, now?: number): number;
