# SOWLedger — TODO

Durable project tasks. Mark items [x] only after verification, not after code is written.

---

## Google OAuth — Production & Review Video

Goal: take the Google Calendar integration from test/unconfigured to a **verified production app**, and produce the **testing-mode demo video** Google requires for the sensitive `calendar.events` scope review.

### Current state (verified)
- [ ] `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` are **unset** in the environment (no `.env` file exists, only `.env.example`).
- [ ] Consequence: `googleCalendarConfigured()` returns false; the OAuth start route returns **HTTP 503**. The OAuth flow cannot run today.
- [ ] No Google OAuth Desktop/Web client has been created yet in Google Cloud Console for SOWLedger.
- [ ] Consent screen is not configured with test users, so a recording cannot reach Google's consent screen today.

### 1. Create the Google OAuth client (user action — cannot be delegated)
- [ ] Google Cloud Console -> APIs & Services -> Credentials -> Create Credentials -> OAuth client ID.
- [ ] Application type: Desktop or Web (matches flow).
- [ ] Add authorized redirect URI: `http://localhost:3000/api/integrations/google-calendar/oauth/callback` (testing).
- [ ] Save the client ID + client secret to store in `.env` (prefer 1Password; never commit).

### 2. Configure the consent screen for testing
- [ ] Google Cloud Console -> APIs & Services -> OAuth consent screen.
- [ ] Set user type to **External**.
- [ ] Fill required app info: app name, user support email.
- [ ] Add the developer/test Google account(s) under **Test users** (only test users can authorize in testing mode).
- [ ] Add required policy links (privacy policy + terms) on a verified domain.
- [ ] Note: while app is in Testing, refresh tokens expire after **7 days** and only test users can grant.

### 3. Verify the domain (Google Search Console)
- [ ] Add `sowledger.com` (or the deployed subdomain root `tkoresearch.com`) as a **Domain** property in Search Console.
- [ ] Choose DNS verification (TXT record), add the `google-site-verification=...` TXT record to DNS (Cloudflare / Vercel / registrar).
- [ ] Wait for propagation; confirm with: `dig TXT sowledger.com +short`.
- [ ] Click Verify in Search Console once the TXT record resolves.

### 4. Wire up the app
- [ ] Create `.env` from `.env.example` and set:
  - `GOOGLE_CALENDAR_CLIENT_ID=...`
  - `GOOGLE_CALENDAR_CLIENT_SECRET=...`
  - `GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/api/integrations/google-calendar/oauth/callback`
- [ ] Restart the app. Confirm `/api/integrations/google-calendar/oauth/start` no longer returns 503.
- [ ] (Later / prod) set `GOOGLE_CALENDAR_REDIRECT_URI=https://www.sowledger.com/api/integrations/google-calendar/oauth/callback` and register that exact callback in the Google client.

### 5. Record the testing-flow demo video
Constraint: the review video must show the app in use **through and including registering / connecting the Google account**. Google accepts screen recordings; keep it 60-120s, window-only, no unrelated features.

- [ ] Blocker: completing the Google login step requires the user to type a Google account password / pass 2FA. **This cannot be automated** — the user performs the login click.
- [ ] Prepare an ffmpeg screen-region recording harness (already installed) or OBS if blur/mic wanted. Default = ffmpeg.
- [ ] Setup: disable notifications and screen-saver before recording.
- [ ] Drive the flow: open `/integrations`, click Connect Google Calendar, land on consent screen.
- [ ] User completes the Google login + consent (test user account).
- [ ] Continue the app flow: confirm connection shows "connected" in `/integrations`.
- [ ] Show real data movement:
  - Create a scheduled work block -> "Sync now" -> show it appear in a real Google Calendar.
  - Show an external event importing into SOWLedger as an "unavailable" / busy block.
- [ ] Show revocation: disconnect from `/integrations`.
- [ ] Optional: show `/api/integrations/google-calendar/sync` returning `{ exported, imported, updated }`.
- [ ] Trim / stitch with ffmpeg into a sub-2-minute MP4/MOV acceptable to Google (QuickTime MOV is natively accepted).
- [ ] Upload the demo video to the Google OAuth verification request.

### 6. Production publishing (after testing verified)
- [ ] Add production redirect URI to the Google OAuth client: `https://www.sowledger.com/api/integrations/google-calendar/oauth/callback`.
- [ ] Move the Google client out of Testing: complete privacy policy + terms URLs on the verified domain.
- [ ] Click **Publish app** in the OAuth consent screen.
- [ ] Expect a Google review for the sensitive `calendar.events` scope (allow several business days; provide demo video + justification; may be asked for a demo video only if review doesn't simply accept).
- [ ] Consider a separate Google OAuth client for prod vs. dev so localhost redirect is not present in prod.

---

### Cross-reference
- `lib/integrations/google-calendar.ts` — scope `calendar.events`, auth URL builder, token exchange, refresh logic.
- `app/api/integrations/google-calendar/oauth/start/route.ts` — 503 gate when unconfigured.
- `app/api/integrations/google-calendar/oauth/callback/route.ts` — code exchange, state verify, connection store.
- `docs/launch-readiness.md` — post-deploy checks; Google callback registration line 69.
- `.env.example` — env var placeholders (lines 55-57).