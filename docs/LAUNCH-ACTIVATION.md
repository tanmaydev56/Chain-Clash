# Chain Clash launch activation

The app can be deployed and played as a guest-first web game now. The items below need an account, a verified domain, or an external provider; they are deliberately not simulated in the product.

## Required before public launch

1. Configure a real custom domain and update the public base URL in `app/layout.tsx`.
2. Enable an error tracker and product analytics provider, then add only their public client identifiers as hosted environment values. Confirm the consent choice is honored before sending optional events.
3. Provision a Cloudflare Durable Object room coordinator and migrate room polling to WebSockets plus alarms. This needs a Cloudflare account-level binding and a load test, so it cannot safely be switched on from this repository alone.
4. Set a scheduled cleanup job for finished and abandoned rooms. Choose retention periods first; the current delete-account flow already removes user-owned game data.
5. Add a real support email or support form, then update the privacy policy and Play listing with that contact.

## Identity and purchases

- Keep guest play as the default. Before enabling Google or email upgrades, create OAuth redirect URIs for the final domain, use freshly rotated credentials, and implement token verification on the server. Do not put OAuth client secrets in browser code or repository files.
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
