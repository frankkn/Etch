<div align="right">

**English** | [繁體中文](README.zh-TW.md)

</div>

# Etch

**A self-reflection app where you can only ever publish 100 posts. For life.**

🔗 Live: **https://etch-5ae60.web.app**

## What is this

Etch is built on one idea: **scarcity forces sincerity**. The real product isn't the posting feature — it's the hesitation before spending one of your hundred. That's where reflection happens.

Every post is like carving into wet clay: for the first 24 hours you can still make a few corrections, then it fires into ceramic — permanently.

### The rules

- **You get 100 posts for life.** When they're gone, they're gone
- **Etch publishes instantly**: you get your number (No. X / 100) and spend one slot immediately
- **Malleable window**: for 24 hours after publishing you may edit (number unchanged) or delete (slot refunded). The window is fixed — editing does not extend it
- **Hardening**: once 24 hours pass, the post can never be edited or deleted. The only exception is **Strike** — a strikethrough that says "I once thought this; I no longer do." The post stays visible, still counts against your quota, and striking is itself one-time and irreversible
- **No likes, no comments, no followers, no algorithm.** Posts have only a number and a timestamp; the silence between two posts is content too
- **Private by default.** At the moment of etching you choose: carved for yourself, or carved for the world — reversible later via Reveal / Unlist

## Privacy and data sovereignty

> "Private posts are end-to-end encrypted — even we cannot read them. Public posts are what you chose to show the world, stored in plaintext."

- **Local-first**: your data lives in your device's IndexedDB. No account required for full functionality
- **E2E encrypted backup**: signing in enables cloud sync, but everything is encrypted client-side with your **passphrase** (PBKDF2 600k + AES-256-GCM) before upload. The server only ever stores ciphertext. **Losing the passphrase means losing the data** — no reset, no backdoor. That's a feature, not a flaw
- **You don't need us**:
  - Export produces one encrypted JSON file — the [format is fully documented](docs/EXPORT_FORMAT.md), built only on standard cryptographic primitives, so anyone can implement a decryptor
  - A [single-file offline decryptor](public/etch-decryptor.html) ships with the app (pure HTML + Web Crypto, zero dependencies, zero network). If Etch ever disappears, that file plus your passphrase still opens your life
- **Sharing**: one unguessable random link (re-keyable, revocable). Visitors see only the posts you chose to make public — with numbering, gaps ("X posts of silence in between"), and your true progress intact
- **Immutability is enforced server-side**: the malleable window, hardening, strike-once, and the quota cap are written into [Firestore Security Rules](firestore.rules), with [Cloud Functions](functions/index.js) as the final arbiter — the rules are the product promise

## Stack

Vite + React + TypeScript + Tailwind CSS | IndexedDB (idb) | Web Crypto API | Firebase (Auth / Firestore / Hosting / Functions)

Architecture details, the full product spec, and the roadmap live in [CLAUDE.md](CLAUDE.md) (Chinese).

## Development

```bash
npm install
cp .env.example .env   # fill in your Firebase web app config (Console → Project settings → Your apps)
npm run dev            # http://localhost:5173
```

### Tests

```bash
npm test               # unit tests: crypto, storage invariants, export format, sync mapping
npm run test:rules     # Security Rules tests (requires Java; emulator simulates owner / stranger / visitor)
```

Any change to `firestore.rules` must pass `test:rules` before deploying.

### Deploy

```bash
npm run build
firebase deploy --only hosting,firestore:rules
firebase deploy --only functions   # requires the Blaze plan
```

## Deliberately not building

Social features (likes, comments, follows, view counts), notification spam, any engagement optimization, passphrase recovery, rich text editing, fake take-backs (nothing that implies published content can be un-seen), and moderation tooling for private content — we technically cannot read it.

---

When they're gone, they're gone. That's not a limitation — it's what makes each one worth it.
