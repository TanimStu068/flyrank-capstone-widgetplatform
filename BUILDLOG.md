# BUILDLOG: AI usage

> **Intern: read and rewrite this in your own words before submitting.** The brief grades honesty and asks you to be
> able to explain any 2-3 lines of the code an evaluator picks. This draft records what actually happened in the
> session that generated the first version; add your own reading, changes and questions.

## Where AI helped
- Claude (Anthropic) generated the whole first version from the brief: the schema, layered code, widget script, tests,
  Docker files and docs, in one session.
- Design choices it proposed (check you agree and can defend them): token bucket instead of a fixed window; outbox
  table + worker for emails instead of fire-and-forget; a stable `/widget.js` loader that 302s to a content-hashed
  immutable bundle; 404 instead of 403 for cross-tenant access; silent 202 for spam; SQLite via `node:sqlite` to keep
  the stack at zero native dependencies.

## Where the AI was wrong, and what changed
1. **Async errors hung requests.** The submission handler was `async` and threw `AppError`s. Express 4 does not catch
   rejected promises, so invalid submissions never got a response and the test run timed out. Added a `wrap()` helper
   (`src/http/middleware.js`) that forwards rejections to the error handler.
2. **A "failing" 304 test that was a test bug.** The ETag/304 test failed, but curl showed the server was right.
   Node's `fetch` silently adds `Cache-Control: no-cache` when you set `If-None-Match`, which forces revalidation. The
   test now sends `Cache-Control: max-age=0` the way a browser reload does. No server change.
3. **Wrong test command.** `node --test test/` fails on Node 22 (it treats the path as a file); the script now uses a
   glob.
4. **Misleading evidence output.** The first `prove` run showed 10 failed jobs for one submission because earlier
   probes' emails were still queued when the email fault was switched on. The script now waits for the queue to drain,
   so the output shows exactly the 2 jobs from that submission.
5. A debugging command used `pkill -f` with a pattern that also matched its own shell and killed it. Only a tooling
   mishap, nothing in the repo.

## What was NOT verified
- `docker compose up` was **not run** (no Docker in the authoring sandbox). Run it once; fix anything it reveals.
- The widget was **not rendered in a real browser** (see EVIDENCE.md, "Manual check").
- The real geo providers (ip-api.com, ipapi.co) were **not called**; all proofs use the mock providers, as the brief
  recommends. Try `GEO_MODE=real GEO_LOOKUP_IP_OVERRIDE=8.8.8.8` manually.
- No load test beyond the burst probe.

## Things to understand before an interview
`createTokenBucket` (src/services/ratelimit.js), the order of defences in `createSubmissionService`, why the
submission and its jobs share one transaction, how `publicCors` makes error responses readable by the browser, and why
`TRUST_PROXY=true` is unsafe in production.
