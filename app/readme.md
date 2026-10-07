# Formstep

Formstep collects and verifies customer information for workflows and AI agents. A caller creates a request, the customer completes a branded form, and Formstep hands the answers back to your scenario.

## Connection

Sign in with your Formstep account (OAuth 2.0). One connection covers one workspace.

## Modules

- **Create a request**: assigns a published form to one recipient and returns the request link. Prefill answers and hidden-field context are keyed by field key; set an external ID and a re-run scenario reuses the request instead of creating a second one.
- **Watch requests** (instant trigger): fires when a request is completed, expires, or is canceled. `data.request` carries the request ID, external ID, status, outcome, recipient and metadata; a completed request also delivers `data.answers` keyed by field key and `data.display` with readable text. Test requests never reach it.
- **Get a request**: one request with its status, outcome, request link, timeline, and the answers once the recipient has completed it.
- **Cancel a request**: withdraws a pending request with an optional reason.
- **Remind a request**: emails the recipient a reminder now.
- **Search requests**: lists a form's requests by status or external ID.
- **Watch public link submissions** (instant trigger): fires on the event you pick for submissions through the form's public link: Submission created, Submission updated (the respondent edits a submission they already sent) or Submission abandoned. Answers arrive under `data.answers` keyed by field key and readable text under `data.display`. A completed request fires Watch requests instead (one channel, one event).
- **Make an API call**: calls any Formstep API method with a JSON parameters object. See https://docs.formstep.io/developers/rest-api.

Deliveries to Make are not signed: a Make custom-app webhook never sees the raw request body, so the `X-Formstep-Signature` header cannot be verified. The unguessable `hook.make.com` URL over HTTPS protects them.

## Links

- Documentation: https://docs.formstep.io
