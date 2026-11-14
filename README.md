# Formstep Make integration

This is the Formstep custom app for Make, kept in git. Make hosts and runs the app. This repository holds its IML JSON and IML functions, contract tests, a script that pushes everything to the [Make Developer Hub](https://developers.make.com/custom-apps-documentation/), and the setup steps.

The Hub app is `formbase-f1d7bp`, version 1, shown in Make as Formstep. It is published and shared by invitation until Make approves it: https://www.make.com/en/hq/app-invitation/19b85d47851b8e2054970a52663f8290

The app follows the Formstep [n8n](https://github.com/formstep/n8n-nodes-formstep) and [Zapier](https://github.com/formstep/formstep-zapier) integrations. The API contract lives in [formstep/formstep](https://github.com/formstep/formstep/tree/main/packages/convex/src/http/external_api).

## What the app does

### Connection

OAuth 2.0 authorization code with mandatory PKCE S256 and the scopes `api:read api:write offline_access`. Access and refresh tokens rotate. One connection covers one workspace, and the form picker lists that workspace's forms with cursor pagination. The user picks their Make zone when they create the connection; see [OAuth redirect and the Make zone](#oauth-redirect-and-the-make-zone).

### Triggers

Both triggers are instant, and each has an attached dedicated webhook. Make subscribes with `webhooks.create` when the webhook is created and unsubscribes with `webhooks.delete` when it is deleted. A trigger listens to one event.

Watch public link submissions covers submissions through a form's public link:

| Event option | Delivers | When |
| --- | --- | --- |
| `submission_created` | `submission.completed` | Once per new submission |
| `submission_updated` | `submission.updated` | The respondent edits a submission they already sent. The form must allow editing after submit |
| `submission_abandoned` | `submission.abandoned` | A partial submission stays idle for the required idle window: 12 hours, 1 day, 3 days or 1 week |

Since 2.4.0 a scenario on `Submission created` no longer runs on edits; pick `Submission updated` for those. A completed request never reaches this trigger (one channel, one event), and a request never produces an update event.

Watch requests covers a form's requests:

| Event option | Delivers |
| --- | --- |
| `request_completed` | `request.completed` |
| `request_expired` | `request.expired` |
| `request_canceled` | `request.canceled` |

Test requests never reach it. A completed request fires Watch requests alone, so a scenario with both triggers on one form receives one bundle per completion.

### Actions and search

| Module | API method | What it does |
| --- | --- | --- |
| Create a request | `requests.create` | Takes the form, recipient, delivery, language, reminders, expiry, external ID, metadata and test mode. Returns the request summary with the request link (`url`) |
| Get a request | `requests.get` | Returns the request with `answers` and `display` per field key, plus the timeline |
| Cancel a request | `requests.cancel` | Withdraws a pending request, with an optional reason |
| Remind a request | `requests.remind` | Emails the recipient a reminder now |
| Search requests | `requests.list` | Lists a form's requests by status and external ID, following `nextCursor` up to the limit |
| Make an API call | any | Universal module for the other Formstep JSON-RPC methods |

In Create a request, picking a form loads the prefill inputs, the hidden-field context inputs and the read-only picker, one per field key, from `fields.list` through the nested `getRequestFields` RPC. The external ID is also sent as `idempotencyKey`, so a scenario that runs again reuses the request.

### Data shapes

Every event is the Formstep envelope `{ id, type, createdAt, apiVersion, test, data }`. `data.answers` holds each answer once under its field key, and `data.display` holds the readable text under the same key. `data.submission` carries the email, date, PDF and language. Request events add `data.request`.

Output interfaces are built from `fields.list`, so every answer maps under its own field key:

- a choice answer as its option key
- a multi-choice answer as a list of keys
- a matrix as one item per row
- a repeating group as an array of rows
- a booking or a payment as one item per property

Watch requests and Get a request reuse the `buildSubmissionInterface` function through the `iml` namespace, so a field key maps under the same pill in every module. Sample payloads come from `submissions.sample` and `requests.sample`.

The API returns a request's times as epoch milliseconds. Create, Get, Cancel and Remind a request and Search requests pass their output through the `requestDates` function, which turns the request's top-level `...At` fields and `timeline[].at` into ISO 8601 strings, so Make shows and compares them as dates. Answers, display text, prefill, context and metadata stay as they are, because a field key may end in `At` and hold a number that is not a time. Webhook events already carry ISO strings.

## Design notes

### Webhooks are not signed

A Make custom-app webhook sees only the parsed `body`, `headers` and `query`, never the raw bytes, and it holds no per-subscription secret when a delivery arrives. `X-Formstep-Signature` therefore cannot be verified here, for submissions or for requests. The unguessable `hook.make.com` URL over HTTPS protects deliveries. Zapier and n8n verify signatures because their runtimes expose the raw body.

### OAuth redirect and the Make zone

Both `redirect_uri` values are `https://{{ifempty(parameters.zone, 'eu1')}}.make.com/oauth/cb/app`, built from the connection's Make zone parameter. Make's own variable, `{{oauth.localRedirectUri}}`, resolves to `https://www.make.com/oauth/cb/app`, and that global callback answers "Resource not found" for this app: until Make approves a custom app, a pending authorization is known only to the zone the user's organization is in.

The user picks the zone from their Make address: eu1, eu2, us1 or us2. A connection made before the parameter existed has no zone and uses eu1, where it was made. Formstep allows all five URIs on `fboc_make`.

When Make approves the app, switch both values back to `{{oauth.localRedirectUri}}`, which the review asks for, and remove the parameter.

### Get a request keeps its form picker among the mappable parameters

The Form picker of Get a request is a mappable parameter with `mappable: false`. As a static parameter of an action, Make ran its `listForms` RPC without the connection and the API answered 401.

## Repository map

```text
formstep-make/
├── app/                  # Base, app parameters and the readme Make shows
├── connections/formbase/ # OAuth connection: communication, common data, scopes, parameters
├── functions/            # IML functions: interfaces and inputs built from fields.list, request times as dates
├── modules/              # Two instant triggers, four request actions, the search, the universal module
├── webhooks/             # Attached dedicated webhooks: submission_webhook, request_webhook
├── rpcs/                 # Form options, sample payloads, output interfaces, Create a request inputs
├── scripts/sync-hub.mjs  # Pushes the repository to the Make Developer Hub (npm run sync:hub)
└── test/                 # Contract tests
```

## Validate locally

```bash
cd ~/git/formstep-make
npm ci
npm test
```

The tests check JSON syntax, OAuth, PKCE, refresh rotation, sanitization, API envelopes, pagination, both webhook lifecycles, every module's request body and output interface, dynamic samples, and that every `rpc://` and function reference resolves. They also run the IML functions: the interfaces and inputs built from a field list, the static fallbacks that must equal them, and the dates `requestDates` returns. They do not run Make's hosted IML runtime, so finish with the live smoke test below.

## 1. Deploy Formstep OAuth support

Make signs in with a fixed confidential OAuth client, `fboc_make`. The Formstep backend creates it with `seedMakeOAuthClient`, which is idempotent, the same way it seeds the Zapier client.

Deploy the backend:

```bash
cd ~/git/formstep/packages/convex
pnpm convex deploy
```

Create one long random secret and keep it in a password manager. Set it interactively, so the value stays out of the shell history:

```bash
pnpm convex env set --prod MAKE_OAUTH_CLIENT_SECRET
```

Seed the production client:

```bash
pnpm convex run --prod internal/oauthClients:seedMakeOAuthClient \
  '{"redirectUris":["https://www.make.com/oauth/cb/app","https://eu1.make.com/oauth/cb/app","https://eu2.make.com/oauth/cb/app","https://us1.make.com/oauth/cb/app","https://us2.make.com/oauth/cb/app"]}'
```

Expected result:

```json
{ "clientId": "fboc_make", "created": true }
```

Running it again updates the redirect URIs and the secret hash and returns `created: false`. Keep the plaintext secret: the same value goes into the connection's encrypted Common data in Make. Never commit it to this repository.

## 2. Create components in Make Developer Hub

### Sync with the API

`npm run sync:hub` pushes this repository to the Hub app `formbase-f1d7bp` version 1 through Make's SDK Apps API, using the mapping in the table below.

1. In Make, open your profile, then **API access**, then **Add token**, with the scopes `sdk-apps:read` and `sdk-apps:write`. Save it as `MAKE_API_TOKEN=...` in `~/.config/formstep-make/.env`, or export it. To push the connection's Common data as well, add `MAKE_OAUTH_CLIENT_SECRET=...` there (the value set in Convex). Without it the script leaves Common data alone. The script never prints either value.
2. Run `npm run sync:hub`. This is a dry run: it reads every component and section from the Hub and prints the components it would create, the sections that differ (JSON is compared without regard to whitespace), and the Hub components the repository does not have. It reports those and never deletes them.
3. Run `npm run sync:hub -- --apply` to create the missing components, update changed labels and descriptions, and push the differing sections, in the order below.

| Option | Effect |
| --- | --- |
| `--dynamic` (default) | Pushes the IML functions and the dynamic files |
| `--static` | Pushes the `*.static.imljson` twins and skips the IML functions and the RPCs that call them. For an app where Make has not enabled IML functions (see below) |
| `--map <repo name>=<hub name>` | Make names connections and webhooks itself, so the script matches them by label. If a label does not match, pin one, for example `--map submission_webhook=<hub name>` |

The Hub refuses function code over 5000 characters, so the script pushes each function without its comments and indentation, and stops if one is still too long.

The script never publishes, requests review, changes visibility or deletes anything. `app/metadata.imljson` and `app/parameters.imljson` are not synced, because the API has no app parameters section.

### Manual reference

Create a private app named `formbase`, then create the components in this order:

1. OAuth 2.0 connection `formbase`
2. IML functions `buildSubmissionInterface`, `buildRequestInterface`, `buildRequestEventInterface`, `buildRequestFields`, `requestDates`. `buildRequestInterface` and `buildRequestEventInterface` call `iml.buildSubmissionInterface`, so add that one first
3. RPCs `listForms`, `getSampleSubmission`, `getSubmissionInterface`, `getSampleRequest`, `getRequestEventInterface`, `getRequestInterface`, `getRequestFields`
4. Attached dedicated web webhooks `submission_webhook` and `request_webhook`
5. Instant triggers `watchPublicLinkSubmissions` and `watchRequests`
6. Actions `createRequest` (create), `getRequest` (read), `cancelRequest` (update), `remindRequest` (update)
7. Search `searchRequests`
8. Universal module `makeApiCall`

Paste each file into the Hub editor of its component:

| Component | File → Hub field |
| --- | --- |
| App (`app/`) | `base.imljson` → Base, `parameters.imljson` → Parameters, `readme.md` → Readme |
| Connection (`connections/formbase/`) | `common.imljson` → Common data, `scope.imljson` → Default scope, `parameters.imljson` → Parameters, `communication.imljson` → Communication |
| IML functions (`functions/*.js`) | Functions (IML), one function per file |
| RPCs (`rpcs/*/`) | `api.imljson` → Communication |
| Webhooks (`webhooks/*/`) | `parameters.imljson` → Parameters, `attach.imljson` → Attach, `detach.imljson` → Detach, `api.imljson` → Communication |
| Modules (`modules/*/`) | `parameters.imljson` → Static parameters, `expect.imljson` → Mappable parameters, `api.imljson` → Communication, `interface.imljson` → Interface, `samples.imljson` → Samples |

A `*.static.imljson` file replaces its twin only on an app without IML functions.

General settings come from each `metadata.imljson`. Link each component to its connection and webhook exactly as declared there.

Before you save the connection's Common data, replace `REPLACE_IN_MAKE_DEVELOPER_HUB` with the plaintext secret stored in `MAKE_OAUTH_CLIENT_SECRET`. Leave the repository copy as it is.

### IML functions and the static twins

Make disables custom IML functions for a new app: the Developer Hub has no Functions tab and the `+` menu offers no "Create Function". Make enables them per app through a [helpdesk ticket](https://www.make.com/en/ticket). They are enabled for `formbase-f1d7bp` (formstep/formstep#207).

On an app without them, skip the functions and the four RPCs that call them (`getSubmissionInterface`, `getRequestEventInterface`, `getRequestInterface`, `getRequestFields`), and paste the static twins:

- `modules/watch_public_link_submissions/interface.static.imljson` into Watch public link submissions → Interface
- `modules/watch_requests/interface.static.imljson` into Watch requests → Interface
- `modules/get_request/interface.static.imljson` into Get a request → Interface
- `modules/create_request/expect.static.imljson` into Create a request → Mappable parameters
- `api.static.imljson` into Communication of Create, Get, Cancel and Remind a request and Search requests

Each interface and input twin is what its function returns for an unpublished form, with the per-key parts typed `any`. `data.answers` and `data.display` still arrive and map by typing `{{1.data.answers.<field key>}}`. Create a request takes `prefill` and `context` as JSON objects and `readonly` as a list of field keys, where the dynamic file has one input per field. The test suite keeps each of these twins equal to its function.

The `api.static.imljson` twins return the API response without `requestDates`, so a request's times arrive as epoch milliseconds.

Once functions are enabled, add the five functions, create the RPCs, and switch each module back to the dynamic file.

## 3. Live smoke test

Create a test scenario in Make:

1. Add **Formstep → Watch public link submissions**.
2. Create a connection. Pick the Make zone of the organization, sign in, select a workspace and approve the consent. The connection label shows the workspace name.
3. Select a form and `Submission created`. Use **Make an API call** with `webhooks.list` to confirm the registered subscription carries no `idleWindow`. The attach body sends it only for abandoned submissions.
4. Open the module's output mapping panel and confirm every question of the form is listed under **Answers** and **Answers (display)** by its field key. The list comes from `getSubmissionInterface`. A form that is not published has no field list yet (`fields.list` answers `published: false`), so the module shows the envelope alone until the form is published.
5. Click **Run once**, then submit the form.
6. Confirm one bundle with `id`, `type`, `createdAt`, `data.form`, `data.submission` (PDF and language), `data.answers` and `data.display`. The type is `submission.completed`. `data.answers` values keep their stored type, and `data.display` is stable text under the same keys. Then edit the submission you just sent (the form must allow editing after submit) and confirm this scenario does not run. A trigger set to `Submission updated` receives the edit as `submission.updated`.
7. Delete the trigger's webhook in Make. Use **Make an API call** with `webhooks.list` and the `formId` to confirm the subscription is gone. Deleting the scenario alone leaves the webhook and its subscription.
8. Create a webhook on `Submission abandoned`, select an idle window, save a partial response and leave it unchanged past that window. Confirm the bundle has the type `submission.abandoned`. The backend sweeps hourly, so delivery can come up to about one hour after the threshold.
9. Run an error scenario with an unknown API method and confirm a readable `METHOD_NOT_FOUND` error.
10. If a review is planned, test the form picker against a workspace with more than 100 forms and keep the execution logs that show pagination.
11. Add **Create a request** with the same form. Picking the form lists one input per prefillable field under **Prefill**, one per hidden field under **Context**, and the **Read-only fields** picker. On an app pushed with `--static`, `prefill` and `context` are JSON inputs. Set an external ID, run once, and confirm the bundle carries `id`, `url` and `deduplicated: false`, and that `createdAt` and `expiresAt` show as dates. Run again with the same inputs and confirm `deduplicated: true` and the same `url`.
12. Add **Watch requests** on the same form with `Request completed`, run once, and complete the request from step 11 through its `url`. Confirm one bundle with `type: request.completed`, `data.request.status: completed`, `data.answers` and `data.display`. Confirm the Watch public link submissions scenario from step 1 did not run: a completed request fires Watch requests alone.
13. Create a second request, add **Cancel a request** with its `id` and a reason, and confirm the summary comes back `canceled` with `cancelReason`. With Watch requests on `Request canceled`, confirm one `request.canceled` bundle with only `data.request`.
14. Run **Search requests** on the form with the status `canceled`, and **Get a request** with the completed request's `id`. The mapping panel lists `answers` and `display` per field key, and the bundle carries `outcome`, `answers`, `display` and `timeline`.
15. Run **Remind a request** on a pending request that has a recipient email and is not a test request, and confirm `remindersSent` increments. A second call within 10 minutes fails with `[409/CONFLICT] A reminder for this request went out less than ten minutes ago. Try again shortly.` Make shows the API's error code and message. The reason, `REMINDER_TOO_SOON`, is in the response's `error.details.reason`.

## 4. Publish

- For team-only use, save a scenario in the organization and confirm the app installation.
- For invite-link distribution, click **Publish**. Publishing cannot be undone, and published components cannot be deleted.
- For the Make marketplace, make every module visible, run fresh test scenarios, then fill in the **Review** tab: the API documentation link, a scenario link for each module, and a scenario with an API error.

The Make review requires sanitization, error handling, interfaces, pagination, limits, date-typed outputs, a universal API module, and recent successful and error scenario logs. This repository covers the code requirements. The logs have to be generated in Make.

## References

- [Make OAuth 2.0 and PKCE](https://developers.make.com/custom-apps-documentation/app-components/connections/oauth2)
- [Make attached webhooks](https://developers.make.com/custom-apps-documentation/app-components/webhooks/dedicated/attached)
- [Make instant triggers](https://developers.make.com/custom-apps-documentation/app-components/modules/instant-trigger)
- [Make app review prerequisites](https://developers.make.com/custom-apps-documentation/app-review/prerequisites)
- [Formstep REST API](https://formstep.io/docs/developers/rest-api/)
- [Formstep webhooks](https://formstep.io/docs/developers/webhooks-reference/)
