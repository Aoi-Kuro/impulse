// ─── Nickname rules ───────────────────────────────────────────────────────────
// What makes a nickname valid, and when two spellings are the same name. The
// block between the two <nickname-rules> markers is copied word for word into
// superbase/edge-functions/claim-nickname.ts, and minify.py stops the build if
// the two copies differ, so the sign-up form, the offline check
// (js/offline-account.js) and the server can never disagree about a name. It
// is written to be valid as both JavaScript and TypeScript: the defaults
// (= '') give the parameters their types without annotations.
//
// normalizeNickname: NFC first, so "é" typed as one character and "e" plus an
// accent are the same name, then trimmed, so "B " is "B".
// nicknameKey: the normalized name in lower case. This is the identities
// column nickname_lower, the one the unique index is on.
// nicknameProblem: null for a usable name (already normalized), otherwise the
// error code claim-nickname answers with.

// <nickname-rules>
const NICKNAME_RE = /^[\p{L}\p{N}._-]{2,40}$/u;
const RESERVED_NICKNAMES_LOWER = new Set(['gemini']);

function normalizeNickname(raw = '') {
  return typeof raw === 'string' ? raw.normalize('NFC').trim() : '';
}

function nicknameKey(name = '') {
  return normalizeNickname(name).toLowerCase();
}

function nicknameProblem(name = '') {
  if (!NICKNAME_RE.test(name)) return 'invalid_nickname';
  if (RESERVED_NICKNAMES_LOWER.has(name.toLowerCase())) return 'flagged_nickname';
  return null;
}
// </nickname-rules>
