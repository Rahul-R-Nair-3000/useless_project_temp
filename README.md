# pulu.com — a troll chatbot for Useless Projects

A chatbot that never actually helps you. Built with Express + Groq.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy `.env.example` to `.env` and add your Groq API key:
   ```
   cp .env.example .env
   ```
   Get a free key at https://console.groq.com — then paste it into `.env`.

   Also double check `GROQ_MODEL` in `.env` against the current model list on
   the Groq console. Groq deprecates model names fairly often, so
   `llama-3.1-8b-instant` may need swapping out by the time you run this.

3. Run it:
   ```
   npm start
   ```
   Then open http://localhost:3000

## Project structure

- `server.js` — Express app, `/api/troll` endpoint, rate limiting, calls Groq
- `persona.js` — Pulu's system prompt, few-shot examples, and the safety
  keyword filter. **This is the file to edit if you want to change the jokes.**
- `public/index.html` — the whole frontend (HTML/CSS/JS, no build step)

## Tuning the personality

Open `persona.js` and edit the `EXAMPLES` section inside `SYSTEM_PROMPT`.
Add more of your own examples in the same `User: ... / Pulu: ...` format —
the model follows the pattern of whatever examples you give it, so more
good examples = funnier, more consistent replies.

## Safety circuit breaker

`persona.js` has a `containsDistressSignal()` check that runs on both the
user's message and the model's reply. If it detects real distress language
(not just casual complaining), Pulu drops the troll act and shows a plain
supportive message with helpline numbers instead. This is checked on both
sides (input and output) so a model slip-up can't get through either.

Keep this in even for a one-day demo — it's ~10 lines and costs nothing,
but matters if a stranger at the event types something real into it.

## Rate limiting

Simple in-memory limiter: 15 requests per IP per minute. Fine for an event
booth. Resets whenever the server restarts, and won't hold up if you ever
deploy this behind multiple server instances — not a concern for a one-off
demo.

## Notes

- This was built as a one-off for a college event and is meant to be run
  locally / deleted after use, not deployed as a public long-running service.
- The Groq API key must stay server-side (in `.env`), never hardcoded into
  `public/index.html` or committed to git.
