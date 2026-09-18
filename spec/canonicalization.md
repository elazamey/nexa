# NEXA-C14N — canonical form

Normative description of `packages/ast/src/canonical.js`. Signature verification is
only meaningful if both sides hash *identical* bytes, so canonicalization is part of
the protocol, not an implementation detail.

## Accepted value domain

| Type | Accepted | Rule |
| --- | --- | --- |
| `null` | yes | `null` |
| boolean | yes | `true` / `false` |
| integer | yes | safe integers only, `-2^53+1 .. 2^53-1` |
| number (float) | **no** | rejected with `NEXA_E_C14N_NUMBER` |
| string | yes | NFC-normalized, UTF-8, minimal escaping |
| array | yes | dense only; sparse arrays rejected |
| object | yes | plain objects only (`Object.prototype` or `null` prototype) |
| `undefined`, function, symbol, bigint | **no** | rejected with `NEXA_E_C14N_TYPE` |
| `Date`, `Map`, `Set`, class instances | **no** | rejected: values must be data, not behavior |

Negative zero canonicalizes to `0`. Non-finite numbers are rejected. Nesting deeper
than 64 levels is rejected.

## Object keys

Sorted by UTF-16 code unit order. No other order is canonical. Keys must be strings and
are NFC-normalized before encoding, with two hard rules:

* **Normalization collisions are rejected** (`NEXA_E_C14N_FORM`). `{"é":1,"e\u0301":2}`
  is two distinct JavaScript keys that normalize to one canonical key; emitting both
  would make the signed bytes ambiguous, so it is an error rather than a silent merge.
* **`__proto__` is refused** (`NEXA_E_C14N_TYPE`). An own property with that name is a
  prototype-pollution vector for any consumer that spreads or assigns the decoded object,
  and no NEXA document legitimately needs it.

## Strings

* NFC normalization first.
* Escaped: `"` → `\"`, `\` → `\\`, and U+0000..U+001F as `\b \t \n \f \r` where
  those short forms exist, otherwise `\u00xx`.
* Everything else — including non-ASCII, U+2028, U+2029 and emoji — is emitted raw.
* Unpaired surrogates are rejected (`NEXA_E_C14N_STRING`).

## Why these rules

* **No floats.** Cross-language float formatting is a source of signature
  mismatches; NEXA v0.1 carries quantities as integers.
* **No `undefined`.** A field that is absent is absent; it is not "present and empty".
* **Plain objects only.** Prototypes can change traversal behaviour; data must be data.
* **Exact re-encoding check.** `parseCanonical()` re-canonicalizes its input and
  rejects anything that is not already canonical (`NEXA_E_C14N_FORM`). This makes
  duplicate keys, key reordering and non-minimal escaping detectable rather than
  silently tolerated.

## Domain separation

Every signature covers a domain prefix followed by canonical bytes:

| Object | Domain prefix |
| --- | --- |
| envelope | `NEXA/0.1 envelope signature\0` |
| identity document | `NEXA/0.1 identity document\0` |
| capability (root) | `NEXA/0.1 capability\0` |
| capability (delegation) | `NEXA/0.1 capability delegation\0` |
| revocation | `NEXA/0.1 capability revocation\0` |
| evidence record | `NEXA/0.1 evidence record\0` |
| receipt | `NEXA/0.1 receipt\0` |

A signature produced for one object type can never be replayed as another, even if
the canonical bytes happen to be identical.

## Test vectors

`spec/vectors/canonical.json` pins canonical output for the cases that matter
(ordering, escaping, surrogates, floats, nesting). `tools/vectors.mjs` regenerates it;
`tests/canonical.test.js` runs it.
