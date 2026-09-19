import type { Evaluate, Field, ChoiceQuestion, ChoiceAnswer } from './index.js';
/** A model stand-in for tests. `values` maps field ids to verbatim text (or null for missing); `labels` maps chunk text to a label. */
export function stubEvaluate(options: { text: string; fields?: Field[]; values?: Record<string, string | null>; labels?: Record<string, string>; none?: string;
  fallback?: (question: ChoiceQuestion, key: string) => ChoiceAnswer }): Evaluate & { calls: number };
