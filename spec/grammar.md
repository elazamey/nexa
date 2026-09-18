# `.nex` grammar

A small, human-readable rendering of NEXA objects. Machines use NEXA-C14N; humans
use this. The two are losslessly interconvertible (`parseNex(printNex(x))` preserves
the canonical form), and `.nex` is **never** the signed representation.

## Grammar (EBNF)

```ebnf
document      = "nexa" version , { directive | block } , EOF ;
version       = number "." number | string ;
directive     = "@" , name , value ;
name          = letter , { letter | digit | "_" | "." | "-" } ;
block         = block-name , object ;
block-name    = "body" | "sig" ;
value         = "null" | "true" | "false" | integer | string
              | word | object | array ;
word          = letter , { letter | digit | "_" | "." | "-" } ;
integer       = [ "-" ] , digit , { digit } ;
string        = '"' , { character | escape } , '"' ;
escape        = "\\" , ( '"' | "\\" | "/" | "b" | "f" | "n" | "r" | "t"
                       | "u" , 4 * hexdigit ) ;
object        = "{" , { key , value } , "}" ;
key           = word | string ;
array         = "[" , { value } , "]" ;
comment       = "#" , { character - newline } ;
```

## Rules

| Rule | Detail |
| --- | --- |
| Bare words | Any `word` that is not `null` / `true` / `false` is a string. Keys may also be quoted. |
| Comments | `#` to end of line, anywhere whitespace is allowed. |
| Whitespace | Spaces, tabs, CR and LF separate tokens; LF is significant only for line numbers in errors. |
| Duplicate keys | Rejected (`NEXA_E_PARSE`) — a `.nex` document cannot express two values for one key. |
| Floats | Rejected: `1.5` lexes as a version-shaped token and is refused as a value. |
| Integers | Must be safe integers (`NEXA_E_PARSE` otherwise); no `+` sign, no leading zeros beyond `0`. |
| Strings | Single line, escape sequences as listed; unescaped control characters are rejected. |
| Directives | `@type @id @from @to @ts @exp @nonce @cap @in_reply_to`; unknown or duplicated directives are errors. |
| Blocks | `body` is required; `sig` is optional (an unsigned skeleton is a legal `.nex` document). |
| Printing | Keys are emitted in canonical (sorted) order, so `printNex` is deterministic and idempotent. |

## Example

```text
nexa 0.1
@type CALL
@id "urn:nexa:msg:u9Yt2Q..."
@from "nexa:key:ed25519:z6Mk..."
@to "nexa:key:ed25519:z6Mk..."
@ts "2026-09-18T12:00:00Z"
@exp "2026-09-18T12:00:30Z"
@nonce 8Qm1V0nqW5m1jWv2kg
body {
  action call
  args {
    mode safe
    nested { depth 3 enabled true }
    tags [alpha beta "gamma delta"]
    text "hello \"nexa\""
  }
  resource "tool:echo"
}
sig {
  alg ed25519
  kid "nexa:key:ed25519:z6Mk..."
  val "MEUCIQ..."
}
```

## Mapping to the envelope

| `.nex` | envelope |
| --- | --- |
| `nexa <version>` | `nexa` |
| `@<name> <value>` | same-named envelope field |
| `body { ... }` | `body` |
| `sig { ... }` | `sig` |

`toEnvelope()` assembles the object; `validateEnvelope()` still has the last word, so
parsing never bypasses schema validation.
