---
name: jeveryword-api
description: Call the hosted jeveryword API to pull exact fields out of text or find PII, paying per call with x402 (USDC) instead of holding any API key or account. Use when the user or agent has a crypto wallet and wants text extraction or PII detection without signing up for TypeSafe, or mentions x402, pay-per-call, or the hosted jeveryword API. If they have (or want) their own TypeSafe key, use the jeveryword skill and the library instead; it is cheaper.
---

# Hosted jeveryword API (pay per call with x402)

`https://jeveryword.vercel.app/v1` runs the open-source [jeveryword](https://github.com/jkrup/jeveryword)
library for you. No account, no API key: each request is paid for with a fraction of a cent of
USDC through [x402](https://docs.x402.org). Every value it returns is an exact slice of the text
you sent, with character offsets and a probability.

Read `GET https://jeveryword.vercel.app/v1` first. It is free and is the source of truth for the
current network (test or main), prices, and request shapes.

| Endpoint | Body | Price (USD) |
| --- | --- | --- |
| `POST /v1/extract` | `{ text, fields: [{ id, description }], trace? }` | 0.005 per call + 0.0005 per field (ten fields: one cent) |
| `POST /v1/pii` | `{ text, mode?: 'binary' \| 'categorized' }` | 0.004 per 1,000 characters; 0.006 with `mode: 'categorized'` |

Limits: text up to 4,000 characters; up to 16 fields; field ids use letters, digits, underscores.

## Call it

```sh
npm install @x402/fetch @x402/evm viem
```

```js
import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const client = new x402Client();
client.register('eip155:*', new ExactEvmScheme(privateKeyToAccount(process.env.EVM_PRIVATE_KEY)));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);   // pays a 402 and retries, once

const response = await fetchWithPayment('https://jeveryword.vercel.app/v1/extract', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: "Hi, I'm Maya Chen from Fern Labs. Reach me at maya@fern.example",
    fields: [
      { id: 'name', description: "The speaker's full name." },
      { id: 'email', description: "The speaker's current email address." },
      { id: 'phone', description: "The speaker's phone number." },
    ],
  }),
});
const { results } = await response.json();
// results.name  → { status: 'extracted', value: 'Maya Chen', start: 8, end: 17, probability: 0.98 }
// results.phone → { status: 'missing', value: null, probability: 1 }
```

`/v1/pii` returns `{ detections: [{ value, start, end, category, score }] }`, one per word; keep
the ones with `score >= 0.5` and join neighbours that share a category.

A field's `description` is the whole prompt for that field: say whose value, which one when
several appear, and what to leave out. Values are verbatim; if you need a date or number, convert
the returned text in code. Handle `missing` and `ambiguous`; confirm anything under 0.8.

## What the status codes mean

- `200` with a `PAYMENT-RESPONSE` header: done and paid; the header is the on-chain receipt.
- `400`: the request was malformed. Nothing was charged; fix it and retry.
- `402` after your client already paid: the payment was rejected (the body's `error` says why,
  for example `insufficient_balance`). Nothing was charged.
- `502` / `503`: the work failed or the service is unavailable. Nothing was charged.

## Rules for handling the wallet

- The private key lives in an environment variable on a server or in the agent's own secret
  store. Never in browser code, never in a repo, never printed.
- Use a wallet that holds only a small balance for this purpose. Each call costs well under a cent.
- Check the network in `GET /v1`: `eip155:84532` is Base Sepolia (test USDC, free from a
  faucet); `eip155:8453` is Base mainnet (real USDC).
