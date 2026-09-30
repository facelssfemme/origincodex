# Order-linked Checkout deployment

Checkout remains closed by default. Do not activate customer payments until the base and bundle payment-to-delivery smoke tests pass on the intended infrastructure.

## Integration

Quiz creates an immutable database order with recomputed score and a browser capability before server-created Stripe Checkout. The gateway validates the configured account, mode, one-time USD prices and Syrena metadata. Raw signed Stripe events trigger fresh Session retrieval; exact order, account, mode, prices, quantity, amount and paid state must match. A redirect or browser session_id cannot grant access. An authenticated worker persists text, audio and email acceptance with atomic job leases and retry controls. Capability-gated results/audio use the saved order. Email delivery counts require signed provider receipts.

## Configuration

Use explicit `SYRENA_PAYMENT_MODE=test` or `live`; matching `STRIPE_SECRET_KEY` test/live prefix; intended shared `SYRENA_STRIPE_ACCOUNT_ID=acct_1SrJtXK3yFNUEpTU`; `STRIPE_BASE_PRICE_ID` and `STRIPE_SHADOW_PRICE_ID`; matching `STRIPE_WEBHOOK_SECRET`; `DATABASE_URL`; exact `SYRENA_APP_ORIGIN` (HTTPS for live); and independent random 32+ character `SYRENA_ORDER_ACCESS_SECRET` and `SYRENA_WORKER_SECRET`. Never commit secret values. Test and production use separate databases and signing secrets.

Base Price is active, one-time USD 1900 with metadata `brand=syrena, offer=origin-reading`. Optional Shadow Price is active, one-time USD 1200 with `brand=syrena, offer=shadow-origin`. Bundle uses these two line items, total 3100. Do not reuse another brand's prices. Existing orders record account and environment; untagged legacy orders are not automatically accepted.

Apply migrations 001 and 002 to the designated database after review. No migration runs during a request. Database access is required; browser storage is only quiz recovery/access capability, not a paid-order store.

Generation requires `SYRENA_GENERATION_ENABLED=approved-test` or `approved-live` matching the order, `ANTHROPIC_API_KEY`, `SYRENA_READING_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID=uG1JFy6xppqckhHCs2KG`, `SYRENA_VOICE_APPROVED=true`, `RESEND_API_KEY`, `RESEND_EMAIL_FROM`. Test recipients must match `SYRENA_TEST_INBOX`. Verify voice access with the intended API account before spending.

New live Sessions additionally require `SYRENA_LIVE_CHECKOUT_ENABLED=approved-live` and `SYRENA_FULFILLMENT_READY=approved-live`. Keep both unset until runtime/worker/provider QA passes. Configuration presence cannot prove service readiness. Disabling new Sessions does not expire already-issued Sessions or prevent saved-URL retries; keep reconciliation and fulfillment operational for existing purchases.

Register/forward Stripe checkout.session.completed, checkout.session.async_payment_succeeded and checkout.session.async_payment_failed to `/api/stripe-webhook`, with its matching mode/account signing secret. Schedule protected POST `/api/fulfill` with `Authorization: Bearer <worker secret>`; one call processes one order. Verify host duration and queue monitoring. No scheduler is included or provisioned by this PR. The browser does not process jobs.

Optional restricted reporting: `SYRENA_ANALYTICS_MODE=test|live`, independent `SYRENA_REPORT_SECRET` (32+ chars). Provider delivery receipt route `/api/email-delivery` requires `SYRENA_EMAIL_WEBHOOK_SECRET`. Email accepted, provider delivered, and inbox/read are distinct. Gross paid is not net revenue. Browser stages are best-effort observations, not verified payment counts.

## Verification before activation

Run `node --test tests/*.test.mjs`, `npx --no-install tsc --noEmit -p tsconfig.app.json`, and `npm run build`. Full-repository typecheck has pre-existing Bun/publishing-script diagnostics outside the application check. `build-vercel.sh` produces Build Output API v3 locally using the frozen lock; it does not deploy. Confirm the actual domain's project before deploying, rather than selecting by repository/project name.

Minimum real integration smoke: two fictional orders with actual Stripe test Checkout in the intended account. Base: cancel once, confirm saved answers, retry, complete test payment, verify signed-event-to-order mapping and $19 total, invoke protected worker, inspect real personalized text, playable approved voice audio and actual internal email/private-link recovery. Bundle: verify $19+$12 lines and corresponding text/audio/email including Shadow; replay event/worker and confirm no duplicate work. Check fabricated session_id cannot reveal results. Authorize provider spend separately; local fixtures do not verify credentials, host runtime or delivery.

Only after those pass, validate live account/Price IDs, endpoint/worker configuration and origin before an approved traffic switch. Keep old merchant links untouched; late purchases and refunds belong to their original merchant/operator. No cross-account migration is implied. Existing unpaid links may still complete. Pause new Sessions if needed without discarding paid jobs.

## Operator limits

Uncertain text/audio outcomes enter review rather than automatically spending again. A crash can leave a lease; reconcile provider logs before clearing it. Email retries reuse saved payload/key inside 23 hours, then require review. Monitor queue age and stuck jobs. Audio storage is capped at 8 MB per order; actual host/DB latency still needs verification. Refund/revocation, retention, abuse limits and ongoing operational support remain separate release responsibilities.
