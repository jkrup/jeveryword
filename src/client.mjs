// Optional. The library only needs a function ({ state, questions }) => Promise<{ answers, usage?, model? }>;
// TypeSafe's own SDK fits directly: evaluate = request => client.systemOne(request). This dependency-free
// client adds what the pipelines know how to use: typed max_tokens_exceeded errors, 429 handling with
// Retry-After, and an optional Vercel AI Gateway route that falls back to TypeSafe's API.
export function retryDelay(value, retry, now = Date.now()) {
  if (value !== null && value !== undefined && value !== '') {
    const seconds = Number(value);
    const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
    if (Number.isFinite(milliseconds)) return Math.max(0, milliseconds);
  }
  return 2000 * 2 ** retry;
}

// On Vercel, AI Gateway accepts the project's own OIDC token, so Jev works with no key at all.
// Pass the incoming request inside a Vercel Function (the token arrives as a header), or nothing
// in local dev after `vercel env pull` (it is in VERCEL_OIDC_TOKEN). Returns undefined elsewhere.
export function vercelGateway(request, env = globalThis.process?.env ?? {}) {
  if (env.AI_GATEWAY_API_KEY) return { token: env.AI_GATEWAY_API_KEY, authMethod: 'api-key' };
  const token = (env.VERCEL && request?.headers?.get?.('x-vercel-oidc-token')) || env.VERCEL_OIDC_TOKEN;
  return token ? { token, authMethod: 'oidc' } : undefined;
}

const routes = {
  typesafe: ({ apiKey, model }) => ({ provider: 'typesafe', name: 'TypeSafe', endpoint: 'https://api.typesafe.ai/v1/systemone', model,
    headers: { Authorization: `Bearer ${apiKey}` },
    body: request => ({ model, ...request }),
    parse: body => body }),
  // Vercel AI Gateway's evaluation-model protocol (v4), as used by the AI SDK's gateway provider.
  gateway: ({ token, authMethod = 'api-key' }) => ({ provider: 'gateway', name: 'AI Gateway', endpoint: 'https://ai-gateway.vercel.sh/v4/ai/evaluation-model', model: 'typesafe-ai/jev',
    headers: { Authorization: `Bearer ${token}`, 'ai-gateway-protocol-version': '0.0.1', 'ai-gateway-auth-method': authMethod,
      'ai-evaluation-model-specification-version': '4', 'ai-model-id': 'typesafe-ai/jev' },
    body: request => request,
    parse: body => ({ model: 'typesafe-ai/jev',
      answers: Object.fromEntries(Object.entries(body.answers ?? {}).map(([id, answer]) => [id, { ...answer, confidence: body.providerMetadata?.typesafe?.confidence?.[id] }])),
      usage: body.usage ? { input_tokens: body.usage.inputTokens, output_tokens: body.usage.outputTokens } : undefined }) }),
};

// With both credentials the gateway is tried first and TypeSafe's own API is the fallback:
// a gateway failure (rate limit, quota, outage) moves the rest of this client's calls to TypeSafe.
export function createJevClient({ apiKey, gateway, model = 'jev-latest', timeoutMs = 30_000, fallbackTimeoutMs = 4_000, onRetry = () => {}, onFallback = () => {},
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), shouldContinue = () => true } = {}) {
  const chain = [gateway?.token && routes.gateway(gateway), apiKey && routes.typesafe({ apiKey, model })].filter(Boolean);
  if (!chain.length) throw new Error('Set TYPESAFE_API_KEY before running a live extraction.');
  const send = async (route, request, last) => {
    let response, retries = 0, waitedMs = 0;
    while (true) {
      if (!shouldContinue()) throw new Error('Client disconnected');
      response = await fetch(route.endpoint, {
        method: 'POST',
        headers: { ...route.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(route.body(request)),
        // Never follow a redirect with the key attached. Workers lack redirect: 'error'; a 3xx fails as non-OK below.
        redirect: 'manual',
        // A call normally takes 150 to 500 ms. A route with a fallback behind it gets only a few seconds,
        // so a hung gateway costs the caller seconds, not half a minute.
        signal: AbortSignal.timeout(last ? timeoutMs : Math.min(timeoutMs, fallbackTimeoutMs)),
      });
      if (response.status !== 429) break;
      const delayMs = retryDelay(response.headers.get('retry-after'), retries);
      await response.body?.cancel();
      // Waiting only makes sense when there is no other route to take.
      if (!last || retries >= 3 || waitedMs + delayMs > 60_000) {
        const error = new Error(`${route.name} is rate-limiting requests (429). ${retries ? 'Automatic retries did not clear the limit. ' : ''}Try again ${delayMs ? `in at least ${Math.ceil(delayMs / 1000)} seconds` : 'later'}. The scan could not finish.`);
        error.code = 'rate_limited'; error.httpAttempts = retries + 1;
        throw error;
      }
      retries++; waitedMs += delayMs;
      await onRetry({ retry: retries, delayMs, message: `Rate limited by ${route.name}. Retrying this batch in ${Math.ceil(delayMs / 1000)}s (${retries}/3); completed batches are retained.` });
      await sleep(delayMs);
    }
    if (!response.ok) {
      // Inspect only the provider's error code; never surface arbitrary response
      // bodies, which could echo source text or other sensitive request data.
      const errorBody = await response.json().catch(() => null);
      if (JSON.stringify(errorBody)?.includes('max_tokens_exceeded')) {
        const error = new Error(`Jev HTTP ${response.status}: max_tokens_exceeded. The request exceeds TypeSafe's token limit. Try 8-way search, fewer fields, or shorter text.`);
        error.code = 'max_tokens_exceeded';
        error.httpAttempts = retries + 1;
        throw error;
      }
      throw new Error(`${route.name} HTTP ${response.status}. Check credentials, quota, and request limits.`);
    }
    return { ...route.parse(await response.json()), provider: route.provider, rateLimitRetries: retries };
  };
  const evaluate = async request => {
    while (true) {
      const last = chain.length === 1;
      try {
        return await send(chain[0], request, last);
      } catch (error) {
        // A request that is too large is too large everywhere; the caller shrinks it.
        if (last || error.code === 'max_tokens_exceeded' || !shouldContinue()) throw error;
        const [failed] = chain.splice(0, 1);
        await onFallback({ from: failed.provider, to: chain[0].provider, message: `${failed.name} unavailable (${error.code ?? 'error'}); continuing on ${chain[0].name}.` });
      }
    }
  };
  return Object.assign(evaluate, { get endpoint() { return chain[0].endpoint; }, get model() { return chain[0].model; }, get provider() { return chain[0].provider; } });
}
