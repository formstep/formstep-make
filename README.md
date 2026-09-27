# formbase Make integration

Git-tracked mirror of formbase custom app configuration for [Make Developer Hub](https://developers.make.com/custom-apps-documentation/). Make hosts and executes these definitions; this repository supplies reviewable IML JSON, contract tests, and deployment instructions.

## Integration surface

- OAuth 2.0 authorization-code connection with mandatory PKCE S256
- Rotating access and refresh tokens (`api:read api:write offline_access`)
- Workspace-scoped, cursor-paginated form picker
- Attached dedicated webhook with automatic subscribe/unsubscribe
- **Watch public link submissions**: one event per trigger for public-link submissions. `submission_created` delivers `submission.completed` once per new submission; `submission_updated` delivers `submission.updated` when the respondent edits a submission they already sent (the form must allow editing after submit); `submission_abandoned` delivers `submission.abandoned`, with a required 12-hour, 1-day, 3-day, or 1-week idle window. Since 2.4.0 a scenario on `Submission created` no longer runs on edits; pick `Submission updated` for those. A completed request never reaches it (one channel, one event), and a request never produces an update event
- **Watch requests**: `request_completed`, `request_expired` and `request_canceled` events on a form's requests, through the same attach/detach lifecycle (`webhooks.create` / `webhooks.delete`). Test requests never reach it. A completed request fires Watch requests alone, never Watch public link submissions, so a scenario with both triggers on one form receives one bundle per completion
- **Create a request** (`requests.create`): form picker, recipient, delivery, language, reminders, expiry, external ID, metadata and test mode. Prefill inputs, hidden-field context inputs and the read-only picker are generated per field key from `fields.list` through the `getRequestFields` nested RPC. The external ID doubles as `idempotencyKey`, so a re-run scenario reuses the request. Output is the request summary with the request link (`url`)
- **Get a request** (`requests.get`): the request view with `answers` and `display` listed per field key from `fields.list`, plus the timeline
- **Cancel a request** (`requests.cancel`, optional reason) and **Remind a request** (`requests.remind`)
- **Search requests** (`requests.list`) by form, status and external ID, following `nextCursor`
- Dynamic sample payloads from `submissions.sample` and `requests.sample`
- Dynamic output interfaces from `fields.list`, so every answer is mappable under its own field key: a choice answer as its option key, a multi-choice answer as a list of keys, a matrix as one item per row, a repeating group as an array of rows, a booking or a payment as one item per property. Watch requests and Get a request reuse the `buildSubmissionInterface` function through the `iml` namespace, so a field key maps under the same pill in every module
- Universal **Make an API call** module for other formbase JSON-RPC methods
- Unsigned webhooks, by necessity, for submissions and requests alike: a Make custom-app webhook sees only the parsed `body`, `headers` and `query`, never the raw bytes, and holds no per-subscription secret at receive time, so `X-formbase-Signature` cannot be verified here. Deliveries are protected by the unguessable `hook.make.com` URL over HTTPS; Zapier and n8n verify signatures because their runtimes expose the raw body
- Every event is the formbase envelope `{ id, type, createdAt, apiVersion, test, data }`: `data.answers` holds each answer once under its field key, `data.display` the readable text under the same key, `data.submission` the email/date/PDF/language, and on request events `data.request` the request block
- Event `type` values: `submission.completed`, `submission.updated`, `submission.abandoned`, `request.completed`, `request.expired` and `request.canceled`

Implementation follows current formbase [n8n](https://github.com/formbaseso/n8n-nodes-formbase) and [Zapier](https://github.com/formbaseso/formbase-zapier) integrations. Canonical API contract lives in [formbaseso/formbase](https://github.com/formbaseso/formbase/tree/main/packages/convex/src/http/external_api).

## Repository map

```text
formbase-make/
├── app/                         # Base and app settings
├── connections/formbase/        # OAuth connection, common data, scopes
├── functions/                   # Custom IML functions (interfaces and inputs built from fields.list)
├── modules/watch_public_link_submissions/   # Instant trigger: public-link submissions
├── modules/watch_requests/      # Instant trigger: requests completed, expired, canceled
├── modules/create_request/      # Action: requests.create
├── modules/get_request/         # Action: requests.get
├── modules/cancel_request/      # Action: requests.cancel
├── modules/remind_request/      # Action: requests.remind
├── modules/search_requests/     # Search: requests.list
├── modules/make_api_call/       # Universal JSON-RPC module
├── webhooks/submission_webhook/ # Attached dedicated webhook for submissions
├── webhooks/request_webhook/    # Attached dedicated webhook for requests
├── rpcs/list_forms/             # Paginated form options
├── rpcs/get_sample_submission/  # Dynamic Watch public link submissions sample
├── rpcs/get_submission_interface/ # Dynamic Watch public link submissions interface
├── rpcs/get_sample_request/     # Dynamic Watch requests sample (requests.sample)
├── rpcs/get_request_event_interface/ # Dynamic Watch requests interface
├── rpcs/get_request_interface/  # Dynamic Get a request interface
├── rpcs/get_request_fields/     # Nested RPC: Create a request prefill, context and read-only inputs
├── scripts/sync-hub.mjs         # Pushes the repository to Make Developer Hub (npm run sync:hub)
└── test/                        # Semantic contract tests
```

## Validate locally

```bash
cd /Users/onurhakbilen/git/formbase-make
npm ci
npm test
```

Tests validate JSON syntax plus OAuth, PKCE, refresh rotation, sanitization, API envelopes, pagination, both webhook lifecycles, every module's request body and output interface (including the interfaces and inputs the IML functions build from a field list, and the static fallbacks that must equal them), dynamic samples, and that every `rpc://` and function reference resolves. They do not execute Make's hosted IML runtime; complete live smoke test after importing definitions.

## 1. Deploy formbase OAuth support

Make needs fixed confidential client credentials. Backend change adds idempotent `seedMakeOAuthClient`, matching existing Zapier seed strategy.

Deploy changed backend first:

```bash
cd /Users/onurhakbilen/git/formbase/packages/convex
pnpm convex deploy
```

Create one long random secret in password manager. Set it interactively so value does not enter shell history:

```bash
pnpm convex env set --prod MAKE_OAUTH_CLIENT_SECRET
```

Seed production client:

```bash
pnpm convex run --prod internal/oauthClients:seedMakeOAuthClient \
  '{"redirectUris":["https://www.make.com/oauth/cb/app"]}'
```

Expected result:

```json
{ "clientId": "fboc_make", "created": true }
```

Re-running updates redirect URIs and secret hash, returning `created: false`. Keep plaintext secret; same value goes into Make encrypted Common data. Never commit it to this repository.

## 2. Create components in Make Developer Hub

### Sync with the API

`npm run sync:hub` pushes this repository to the Hub app `formbase-f1d7bp` version 1 through Make's SDK Apps API, using the mapping in the table below.

1. In Make, open your profile → **API access** → **Add token**, with scopes `sdk-apps:read` and `sdk-apps:write`. Save it as `MAKE_API_TOKEN=...` in `~/.config/formbase-make/.env`, or export it. To push connection Common data as well, add `MAKE_OAUTH_CLIENT_SECRET=...` there (the value set in Convex). Without it, Common data is not touched. The script never prints either value.
2. Run `npm run sync:hub` first. It is a dry run: it reads every component and section from the Hub and prints the components it would create, the sections that differ (JSON compared without regard to whitespace), and the Hub components the repository does not have. Those are reported and never deleted.
3. Run `npm run sync:hub -- --apply` to create the missing components, update changed labels and descriptions, and push the differing sections, in the order below.

`--static` (the default while formbase#207 is open) pushes the `*.static.imljson` twins and skips the IML functions and the RPCs that call them, as described below. `--dynamic` pushes functions and the dynamic files. Make names connections and webhooks itself, so the script matches them by label. If a label does not match, pin one with `--map submission_webhook=<hub name>`. The script never publishes, requests review, changes visibility or deletes anything. `app/metadata.imljson` and `app/parameters.imljson` are not synced, because the API has no app parameters section.

### Manual reference

Create private app named `formbase`, then create components in this order:

1. OAuth 2.0 connection `formbase`
2. IML functions `buildSubmissionInterface`, `buildRequestInterface`, `buildRequestEventInterface`, `buildRequestFields` (the request ones call `iml.buildSubmissionInterface`, so add that one first)
3. RPC `listForms`
4. RPC `getSampleSubmission`
5. RPC `getSubmissionInterface`
6. RPC `getSampleRequest`
7. RPC `getRequestEventInterface`
8. RPC `getRequestInterface`
9. RPC `getRequestFields`
10. attached dedicated web webhook `submission_webhook`
11. attached dedicated web webhook `request_webhook`
12. instant trigger `watchPublicLinkSubmissions`
13. instant trigger `watchRequests`
14. action `createRequest` (create), `getRequest` (read), `cancelRequest` (update), `remindRequest` (update)
15. search `searchRequests`
16. universal module `makeApiCall`

Paste each file into corresponding Hub editor:

| Repository file | Make Developer Hub field |
| --- | --- |
| `app/base.imljson` | App → Base |
| `app/parameters.imljson` | App → Parameters |
| `connections/formbase/common.imljson` | Connection → Common data |
| `connections/formbase/scope.imljson` | Connection → Default scope |
| `connections/formbase/parameters.imljson` | Connection → Parameters |
| `connections/formbase/communication.imljson` | Connection → Communication |
| `app/readme.md` | App → Readme |
| `functions/*.js` | App → Functions (IML), one function per file, see note below |
| `rpcs/list_forms/api.imljson` | `listForms` → Communication |
| `rpcs/get_sample_submission/api.imljson` | `getSampleSubmission` → Communication |
| `rpcs/get_submission_interface/api.imljson` | `getSubmissionInterface` → Communication |
| `rpcs/get_sample_request/api.imljson` | `getSampleRequest` → Communication |
| `rpcs/get_request_event_interface/api.imljson` | `getRequestEventInterface` → Communication |
| `rpcs/get_request_interface/api.imljson` | `getRequestInterface` → Communication |
| `rpcs/get_request_fields/api.imljson` | `getRequestFields` → Communication |
| `webhooks/submission_webhook/parameters.imljson` | Submission webhook → Parameters |
| `webhooks/submission_webhook/attach.imljson` | Submission webhook → Attach |
| `webhooks/submission_webhook/detach.imljson` | Submission webhook → Detach |
| `webhooks/submission_webhook/api.imljson` | Submission webhook → Communication |
| `webhooks/request_webhook/parameters.imljson` | Request webhook → Parameters |
| `webhooks/request_webhook/attach.imljson` | Request webhook → Attach |
| `webhooks/request_webhook/detach.imljson` | Request webhook → Detach |
| `webhooks/request_webhook/api.imljson` | Request webhook → Communication |
| `modules/watch_public_link_submissions/parameters.imljson` | Watch public link submissions → Static parameters |
| `modules/watch_public_link_submissions/api.imljson` | Watch public link submissions → Communication |
| `modules/watch_public_link_submissions/interface.imljson` | Watch public link submissions → Interface (`interface.static.imljson` until IML functions are enabled) |
| `modules/watch_public_link_submissions/samples.imljson` | Watch public link submissions → Samples |
| `modules/watch_requests/parameters.imljson` | Watch requests → Static parameters |
| `modules/watch_requests/api.imljson` | Watch requests → Communication |
| `modules/watch_requests/interface.imljson` | Watch requests → Interface (`interface.static.imljson` until IML functions are enabled) |
| `modules/watch_requests/samples.imljson` | Watch requests → Samples |
| `modules/create_request/parameters.imljson` | Create a request → Static parameters |
| `modules/create_request/expect.imljson` | Create a request → Mappable parameters (`expect.static.imljson` until IML functions are enabled) |
| `modules/create_request/api.imljson` | Create a request → Communication |
| `modules/create_request/interface.imljson` | Create a request → Interface |
| `modules/create_request/samples.imljson` | Create a request → Samples |
| `modules/get_request/parameters.imljson` | Get a request → Static parameters |
| `modules/get_request/expect.imljson` | Get a request → Mappable parameters |
| `modules/get_request/api.imljson` | Get a request → Communication |
| `modules/get_request/interface.imljson` | Get a request → Interface (`interface.static.imljson` until IML functions are enabled) |
| `modules/get_request/samples.imljson` | Get a request → Samples |
| `modules/cancel_request/*.imljson` | Cancel a request → the same five fields |
| `modules/remind_request/*.imljson` | Remind a request → the same five fields |
| `modules/search_requests/*.imljson` | Search requests → the same five fields |
| `modules/make_api_call/parameters.imljson` | Universal module → Static parameters |
| `modules/make_api_call/expect.imljson` | Universal module → Mappable parameters |
| `modules/make_api_call/api.imljson` | Universal module → Communication |
| `modules/make_api_call/interface.imljson` | Universal module → Interface |
| `modules/make_api_call/samples.imljson` | Universal module → Samples |

Custom IML functions are disabled for a new Make app: the Developer Hub has no Functions tab and the `+` menu offers no "Create Function". Make enables them per app through a helpdesk ticket (https://www.make.com/en/ticket; tracked as formbaseso/formbase#207). Until then skip steps 2, 5, 7, 8 and 9 and paste the static twins instead:

- `modules/watch_public_link_submissions/interface.static.imljson` into Watch public link submissions → Interface
- `modules/watch_requests/interface.static.imljson` into Watch requests → Interface
- `modules/get_request/interface.static.imljson` into Get a request → Interface
- `modules/create_request/expect.static.imljson` into Create a request → Mappable parameters

Each static twin is what the function returns for an unpublished form, with the per-key parts typed `any`: `data.answers` and `data.display` still arrive and map by typing `{{1.data.answers.<field key>}}`, and Create a request takes `prefill` and `context` as JSON objects and `readonly` as a list of field keys instead of one input per field. The test suite keeps every static twin equal to its function. Once functions are enabled, add the four functions, create the RPCs, and switch each module back to the dynamic file.

General settings come from each `metadata.imljson`. Set component connection/webhook links exactly as declared there.

Before saving connection Common data, replace `REPLACE_IN_MAKE_DEVELOPER_HUB` with same plaintext secret stored in `MAKE_OAUTH_CLIENT_SECRET`. Do not modify repository copy.

OAuth redirect must remain `oauth.localRedirectUri`. For hosted Make this resolves to registered `https://www.make.com/oauth/cb/app` callback recommended for reviewed apps.

## 3. Live smoke test

Create test scenario in Make:

1. Add **formbase → Watch public link submissions**.
2. Create connection. Sign in, select workspace, approve consent. Connection label should show workspace name.
3. Select form and `Submission created`. Use **Make an API call** with `webhooks.list` to confirm the registered subscription carries no `idleWindow` (the attach body sends it only for abandoned submissions, never for created or updated).
4. Open the module's output mapping panel and confirm every question of the selected form is listed under **Answers** and **Answers (display)** by its field key. The list comes from `getSubmissionInterface`; a form that is not published has no field list yet (`fields.list` answers `published: false`), so the module shows the envelope alone until the form is published.
5. Click **Run once**, then submit selected form.
6. Confirm one bundle contains `id`, `type`, `createdAt`, `data.form`, `data.submission` (PDF/language), `data.answers` and `data.display`. The type is `submission.completed`. Edit the submission you just sent (the form must allow editing after submit) and confirm this scenario does not run; a trigger set to `Submission updated` receives it as `submission.updated`. `data.answers` values keep their stored type; `data.display` is stable text under the same keys.
7. Deactivate scenario. Use **Make an API call** with method `webhooks.list` and selected `formId` to confirm subscription was removed.
8. Reactivate with `Submission abandoned`, select an idle window, save a partial response, and leave it unchanged past that window. Confirm delivered bundle uses `submission.abandoned`. The backend sweeps hourly, so delivery can occur up to about one hour after the selected threshold.
9. Run error scenario with unknown API method; confirm readable `METHOD_NOT_FOUND` error.
10. If review is planned, test form picker against workspace with more than 100 forms and retain execution logs showing pagination.
11. Add **Create a request** with the same form. Once IML functions are enabled, picking the form lists one input per prefillable field under **Prefill**, one per hidden field under **Context**, and the **Read-only fields** picker; until then `prefill` and `context` are JSON inputs. Set an external ID, run once, and confirm the bundle carries `id`, `url` and `deduplicated: false`. Run again with the same inputs and confirm `deduplicated: true` and the same `url`.
12. Add **Watch requests** on the same form with `Request completed`, run once, and complete the request from step 11 through its `url`. Confirm one bundle with `type: request.completed`, `data.request.status: completed`, `data.answers` and `data.display`, and that the Watch public link submissions scenario from step 11 did not run: a completed request fires Watch requests alone.
13. Create a second request, add **Cancel a request** with its `id` and a reason, and confirm the summary comes back `canceled` with `cancelReason`. With Watch requests on `Request canceled`, confirm one `request.canceled` bundle with only `data.request`.
14. **Search requests** on the form with status `canceled`, and **Get a request** with the completed request's `id`: the mapping panel lists `answers` and `display` per field key once functions are enabled, and the bundle carries `outcome`, `answers`, `display` and `timeline`.
15. **Remind a request** on a pending request with a recipient email; confirm `remindersSent` increments, and that a second call within 10 minutes answers `REMINDER_TOO_SOON`.

## 4. Publish

- For team-only use, save scenario in organization and confirm app installation.
- For invite-link distribution, click **Publish**. Publishing cannot be undone and published components cannot be deleted.
- For Make marketplace, expose every module, run fresh test scenarios, then complete **Review** tab with API docs, support contact, and scenario links.

Make review requires sanitization, error handling, interfaces, pagination, limits, universal API module, and recent successful/error scenario logs. This mirror includes code requirements; live logs must be generated in Make.

## References

- [Make OAuth 2.0 and PKCE](https://developers.make.com/custom-apps-documentation/app-components/connections/oauth2)
- [Make attached webhooks](https://developers.make.com/custom-apps-documentation/app-components/webhooks/dedicated/attached)
- [Make instant triggers](https://developers.make.com/custom-apps-documentation/app-components/modules/instant-trigger)
- [Make app review prerequisites](https://developers.make.com/custom-apps-documentation/app-review/prerequisites)
- [formbase REST API](https://docs.formbase.so/developers/rest-api)
- [formbase webhooks](https://docs.formbase.so/developers/webhooks-reference)
