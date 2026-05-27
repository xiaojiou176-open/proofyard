const ASCII_WORD_OR_PHRASE = /^[a-z0-9][a-z0-9 _-]*$/i

type PreparedToken = {
  normalized: string
  enforceBoundary: boolean
}

function isAsciiAlphaNumeric(char: string): boolean {
  const code = char.charCodeAt(0)
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122)
}

function hasWordBoundary(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : ""
  const after = end < text.length ? text[end] : ""
  const beforeOk = before === "" || !isAsciiAlphaNumeric(before)
  const afterOk = after === "" || !isAsciiAlphaNumeric(after)
  return beforeOk && afterOk
}

function tokenMatched(text: string, token: PreparedToken): boolean {
  let from = 0
  while (true) {
    const foundAt = text.indexOf(token.normalized, from)
    if (foundAt < 0) {
      return false
    }
    const end = foundAt + token.normalized.length
    if (!token.enforceBoundary || hasWordBoundary(text, foundAt, end)) {
      return true
    }
    from = foundAt + 1
  }
}

export function buildDenyRegex(denylist: string[]): { test: (value: string) => boolean } {
  const tokens: PreparedToken[] = denylist
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)
    .map((token) => ({
      normalized: token,
      enforceBoundary: ASCII_WORD_OR_PHRASE.test(token),
    }))

  return {
    test(value: string): boolean {
      const text = value.toLowerCase()
      for (const token of tokens) {
        if (tokenMatched(text, token)) {
          return true
        }
      }
      return false
    },
  }
}

export type DenyMatcher = ReturnType<typeof buildDenyRegex>
