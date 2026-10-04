# Order-linked Checkout deployment

Checkout remains closed by default. Do not activate customer payments until the base and bundle payment-to-delivery smoke tests pass on the intended infrastructure.

## Integration

Quiz creates an immutable database order with recomputed score and a browser capability before server-created Stripe Checkout. The gateway validates the configured account, mode, one-time USD prices and Syrena metadata. Raw signed Stripe events trigger fresh Session retrieval; exact order, account, mode, prices, quantity, amount and paid state must match. A redirect or browser session_id cannot grant access. An authenticated worker persists text, audio and email acceptance with atomic job leases and retry controls. Capability-gated results/audio use the saved order. Email delivery counts require signed provider receipts.

## Configuration

Use explicit `SYRENA_PAYMENT_MODE=test` or `live`; matching `STRIPE_SECRET_KEY` test/live prefix; intended shared `SYRENA_STRIPE_ACCOUNT_ID=acct_1SrJtXK3yFNUEpTU`; `STRIPE_BASE_PRICE_ID` and `STRIPE_SHADOW_PRICE_ID`; matching `STRIPE_WEBHOOK_SECRET`; `DATABASE_URL`; exact `SYRENA_APP_ORIGIN` (HTTPS for live); and independent random 32+ character `SYRENA_ORDER_ACCESS_SECRET` and `SYRENA_WORKER_SECRET`. Never commit secret values. Test and production use separate databases and signing secrets.

Base Price is active, one-time USD 1900 with metadata `brand=syrena, offer=origin-reading`. Optional Shadow Price is active, one-time USD 1200 with `brand=syrena, offer=shadow-origin`. Bundle uses these two line items, total 3100. Do not reuse another brand's prices. Existing orders record account and environment; untagged legacy orders are not automatically accepted.

Apply migrations `001_orders.sql` and `002_email_delivery.sql` to the designated database after review. No migration runs during a request. Database access is required; browser storage is only quiz recovery/access capability, not a paid-order store.

Generation requires `SYRENA_GENERATION_ENABLED=approved-test` or `approved-live` matching the order, an explicitly selected and installed reading adapter (`SYRENA_READING_PROVIDER`, `SYRENA_READING_MODEL`, and that adapter's required credentials), `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID=uG1JFy6xppqckhHCs2KG`, `SYRENA_VOICE_APPROVED=true`, `RESEND_API_KEY`, `RESEND_EMAIL_FROM`. Test recipients must match `SYRENA_TEST_INBOX`. Verify voice access with the intended API account before spending.

New live Sessions additionally require `SYRENA_LIVE_CHECKOUT_ENABLED=approved-live` and `SYRENA_FULFILLMENT_READY=approved-live`. Keep both unset until runtime/worker/provider QA passes. Configuration presence cannot prove service readiness. Disabling new Sessions does not expire already-issued Sessions or prevent saved-URL retries; keep reconciliation and fulfillment operational for existing purchases.

Register/forward Stripe checkout.session.completed, checkout.session.async_payment_succeeded and checkout.session.async_payment_failed to `/api/stripe-webhook`, with its matching mode/account signing secret. Schedule protected POST `/api/fulfill` with `Authorization: Bearer <worker secret>`; one call processes one order. Verify host duration and queue monitoring. No scheduler is included or provisioned by this PR. The browser does not process jobs.

Payment reporting in the historical dashboard is explicitly unavailable; use Stripe for reconciliation until durable authenticated reporting is added. Provider delivery receipt route `/api/email-delivery` requires `SYRENA_EMAIL_WEBHOOK_SECRET`. Email accepted, provider delivered, and inbox/read are distinct. Gross paid is not net revenue. Browser stages are best-effort observations, not verified payment counts.

## Verification before activation

Run `node --test tests/*.test.mjs`, `npx --no-install tsc --noEmit -p tsconfig.app.json`, and `npm run build`. Full-repository typecheck has pre-existing Bun/publishing-script diagnostics outside the application check. `build-vercel.sh` produces Build Output API v3 locally using the frozen lock; it does not deploy. Confirm the actual domain's project before deploying, rather than selecting by repository/project name.

Minimum real integration smoke: two fictional orders with actual Stripe test Checkout in the intended account. Base: cancel once, confirm saved answers, retry, complete test payment, verify signed-event-to-order mapping and $19 total, invoke protected worker, inspect real personalized text, playable approved voice audio and actual internal email/private-link recovery. Bundle: verify $19+$12 lines and corresponding text/audio/email including Shadow; replay event/worker and confirm no duplicate work. Check fabricated session_id cannot reveal results. Authorize provider spend separately; local fixtures do not verify credentials, host runtime or delivery.

Only after those pass, validate live account/Price IDs, endpoint/worker configuration and origin before an approved traffic switch. Keep old merchant links untouched; late purchases and refunds belong to their original merchant/operator. No cross-account migration is implied. Existing unpaid links may still complete. Pause new Sessions if needed without discarding paid jobs.

## Operator limits

Uncertain text/audio outcomes enter review rather than automatically spending again. A crash can leave a lease; reconcile provider logs before clearing it. Email retries reuse saved payload/key inside 23 hours, then require review. Monitor queue age and stuck jobs. Audio storage is capped at 8 MB per order; actual host/DB latency still needs verification. Refund/revocation, retention, abuse limits and ongoing operational support remain separate release responsibilities.

## Recovery from PR #9

This draft builds on merged PR #9 at e159a977. It replaces browser-driven generation with order-bound fulfillment and retires the public provider/email endpoints. It reuses the payment/delivery core of PR #8, excludes its broad funnel/dashboard/share redesign, and preserves quiz recovery and inline checkout errors. Treat PR #8 as a source/reference, not a second change to merge over this repair.

The approved live base price is `price_1ULQB8K3yFNUEpTUORrruI7w`; Shadow is `price_1ULQBOK3yFNUEpTUd79ONEgA`. Live configuration fails closed for any other IDs. Do not use the obsolete `price_1Ttt…` merchant catalog. Test prices must be separate test-mode objects on the approved shared account.

Environment migration is explicit: #9's `STRIPE_PRICE_BASE_READING` becomes `STRIPE_BASE_PRICE_ID`; `STRIPE_PRICE_SHADOW_ORIGIN` becomes `STRIPE_SHADOW_PRICE_ID`; `SITE_URL` becomes `SYRENA_APP_ORIGIN`. `STRIPE_PRICE_BUNDLE` is retired. No inline prices or single-price bundle fallback remain. The current production environment has none of the required payment/delivery settings; adding only a Stripe key must not activate payments.

`vercel.json` disables automatic Git deployments for `codex/syrena-fulfillment-recovery` only, using Vercel's documented `git.deploymentEnabled` branch rule (https://vercel.com/docs/project-configuration/git-configuration). This draft does not change main's deployment behavior. Do not merge or manually deploy until approved. Publishing this branch must begin at the completed commit containing the rule, not a temporary branch at main.

Automatic delivery requires an operator-provisioned scheduler calling protected POST `/api/fulfill` repeatedly; without that schedule, verified purchases remain queued. Confirm the deployment's function duration accommodates text/audio/email generation, monitor queue age and stuck leases, and check the actual provider account access before activation. A source build cannot prove these settings. Email receipt verification records delivery separately from acceptance; neither guarantees inbox placement.

Old #9 Sessions lack immutable order/capability association and are intentionally not accepted as new orders. Reconcile any pre-repair purchases in their original merchant account and fulfill/refund them through an authorized support process. Do not silently import them or guess ownership.

## Provider selection pending — 2026-10-04

Anthropic is not a launch dependency: its SDK and key requirement have been removed. No replacement LLM has been confirmed. The installed reading-adapter registry is deliberately empty. There is no default provider/model, credential-based auto-detection, arbitrary custom endpoint, or canned paid-reading fallback. Live Checkout readiness and worker preflight fail closed until the chosen adapter is implemented and configured. Existing paid jobs remain queued when preflight cannot resolve a provider; no text/audio/email call starts.

The smallest adapter contract is `configure(modelId, environment)` (validates only that provider's credentials), returning `generate(prompt, abortSignal)` (one request, no hidden retry, returns raw JSON for common primary/Shadow validation). Prompts come only from the immutable quiz order. Add only the user-selected provider after confirmation, using its current official API documentation. OpenAI is a candidate, not an installed or selected provider.

Selection required: API provider/account, exact model, and approval for internal test usage. Once selected, document the exact `SYRENA_READING_PROVIDER` identifier, `SYRENA_READING_MODEL`, credential variable(s), and any provider-specific account settings. Do not set placeholders as production choices. Saved fulfillment identity now pins provider as well as model/voice; older partially fulfilled orders without provider identity require review instead of silently resuming under a new provider.

Resend account access is **unverified**: Ellis reports the browser shows login with no active session. Sender/domain verification, API credential access and actual internal delivery remain unproven. Browser login status alone does not establish whether an API credential works. Do not treat email as ready or request generation spend until the required checks are completed. This revision does not log in, provision credentials, send email, merge or deploy.
