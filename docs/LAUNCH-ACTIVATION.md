# Chain Clash launch activation

The app can be deployed and played as a guest-first web game now. The items below need an account, a verified domain, or an external provider; they are deliberately not simulated in the product.

## Required before public launch

1. Register a Workers.dev subdomain for the Cloudflare account, then deploy the main app with `npm run deploy:main`. This creates the app origin used by the realtime Worker. A custom domain can be attached later.
2. Enable an error tracker and product analytics provider, then add only their public client identifiers as hosted environment values. Confirm the consent choice is honored before sending optional events.
3. Create the D1 database, apply the Drizzle migrations, and copy `realtime-worker/wrangler.jsonc.example` to the ignored `realtime-worker/wrangler.production.jsonc`. Fill in its D1 ID and exact production `APP_ORIGIN`, then deploy the realtime Worker. Add the `REALTIME_TICKET_SECRET` Worker secret, then configure the same secret plus `REALTIME_ORIGIN` on the main app. Polling remains the automatic fallback until realtime passes a two-browser production smoke test.
4. Durable Object alarms perform transient room cleanup. Waiting rooms with no connected human live for 5 minutes, abandoned active rooms for 15 minutes, and finished realtime snapshots for 5 minutes. D1 match/profile/ranking history is not deleted by these alarms.
5. Add a real support email or support form, then update the privacy policy and Play listing with that contact.

## Identity and purchases

- Guest play remains the default. Google upgrade is implemented but stays unavailable until the three server-only values below are configured. Do not put the client secret in browser code or repository files.
- In Google Cloud OAuth settings, add this exact Authorized JavaScript Origin: `https://chain-clash.tanmaysharma763.workers.dev`.
- Add this exact Authorized Redirect URI: `https://chain-clash.tanmaysharma763.workers.dev/api/auth/google/callback`.
- Before changing to a custom domain, update `APP_URL` and add that domain's exact origin and callback URI in Google Cloud before deploying the change.
- Before adding ads, create AdMob/AdSense accounts and use test units first. Show rewarded ads only after player opt-in and interstitials only on completed-match screens.
- Before charging money, create Stripe and/or Google Play Billing products, implement server-side webhook and receipt verification, and only then expose a remove-ads entitlement or cosmetic purchase.

## Google Play / TWA

1. Publish the PWA on the final HTTPS domain and verify its manifest, service worker, privacy policy, terms, and account deletion page.
2. Create a Trusted Web Activity with a final Android package id.
3. Generate the signing certificate fingerprint and publish the matching `/.well-known/assetlinks.json`. It cannot be created correctly until the package id and certificate exist.
4. Complete Play Console identity verification, Data Safety, content rating, and the current Android target-SDK requirement. Test the signed release on physical Android devices before production rollout.

## Operational checks

- Configure billing alerts for Cloudflare Worker/D1 usage.
- Review reports regularly and maintain the blocked-word list.
- Load-test concurrent rooms after the Durable Object migration, not against the polling implementation.
- Rotate any credentials that were ever pasted into chat or logs.

## Required server-only configuration

- `GUEST_SESSION_SECRET`: main app cookie-signing secret. Required before guest buttons work.
- `REALTIME_TICKET_SECRET`: identical server-only value on the main app and realtime Worker; use a different value from the guest-session secret.
- `REALTIME_ORIGIN`: public HTTPS origin of the realtime Worker, for example `https://chain-clash-realtime.<subdomain>.workers.dev`.
- `APP_ORIGIN`: non-secret exact HTTPS app origin in the realtime Worker, used to reject cross-origin socket upgrades.
- `APP_URL`: main app HTTPS origin, currently `https://chain-clash.tanmaysharma763.workers.dev`; used to construct the Google OAuth callback without trusting incoming host headers.
- `GOOGLE_CLIENT_ID`: Google OAuth web-client ID for the main app origin.
- `GOOGLE_CLIENT_SECRET`: Google OAuth web-client secret. Set only as a Cloudflare Worker secret.

Generate each secret independently with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Never commit the output. The realtime ticket lasts 60 seconds, is HMAC-SHA256 signed, contains room/user/session/player/expiry/nonce claims, and its nonce is accepted only once by that room's Durable Object.

Polling may be removed only after the realtime Worker is deployed, two-browser reconnect/timeout/bot tests pass in production, and realtime connection/error telemetry shows the rollout is stable.

## Cloudflare deployment commands

After creating the D1 database and replacing the placeholder values in the ignored realtime production config, apply every checked-in migration before deploying either Worker:

```powershell
npx wrangler d1 migrations apply chain-clash-production --remote --config realtime-worker/wrangler.production.jsonc
npm run deploy:main
npx wrangler deploy --config realtime-worker/wrangler.production.jsonc
```

The migration command applies both forward-only migrations. `0006_align_production_schema.sql` brings older migration-created databases in line with `db/schema.ts`; `0007_google_account_linking.sql` adds Google-account linking and one-time OAuth CSRF state records.
