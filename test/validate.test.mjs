import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VALID_INTERFACE_TYPES = new Set([
    'any',
    'array',
    'boolean',
    'buffer',
    'collection',
    'date',
    'email',
    'filename',
    'integer',
    'json',
    'number',
    'text',
    'timestamp',
    'uinteger',
    'url',
    'uuid'
])

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'))
}

/**
 * Loads an IML function the way Make does: the file is a bare function
 * declaration pasted into the Hub's Functions editor, not a module.
 */
function loadImlFunction(relativePath, name, iml = {}) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
    return new Function('iml', `${source}\nreturn ${name}`)(iml)
}

/**
 * The custom functions the way the Hub exposes them to each other: a custom
 * function reaches another one through the `iml` namespace.
 */
function loadImlNamespace() {
    const iml = {}
    iml.buildSubmissionInterface = loadImlFunction('functions/buildSubmissionInterface.js', 'buildSubmissionInterface', iml)
    iml.buildRequestInterface = loadImlFunction('functions/buildRequestInterface.js', 'buildRequestInterface', iml)
    iml.buildRequestEventInterface = loadImlFunction('functions/buildRequestEventInterface.js', 'buildRequestEventInterface', iml)
    iml.buildRequestFields = loadImlFunction('functions/buildRequestFields.js', 'buildRequestFields', iml)
    return iml
}

/** `fields.list` items in the shape the API documents: plain fields, then one repeating group. */
const FIELD_LIST = [
    { key: 'your_name', type: 'text', title: 'Your name', required: true, prefillable: true },
    { key: 'rating', type: 'rating', title: 'How likely are you to recommend us?', required: false, prefillable: true },
    { key: 'signed_on', type: 'date', title: 'Signed on', required: false, prefillable: true },
    { key: 'plan', type: 'select', title: 'Plan', required: false, prefillable: true, options: [{ key: 'pro', label: 'Pro' }] },
    { key: 'topics', type: 'checkbox', title: 'Topics', required: false, prefillable: true, options: [{ key: 'billing', label: 'Billing' }] },
    {
        key: 'satisfaction',
        type: 'matrix',
        title: 'How did we do?',
        required: false,
        prefillable: true,
        rows: [{ key: 'delivery_speed', label: 'Delivery speed' }, { key: 'support', label: 'Support' }],
        columns: [{ key: 'very_good', label: 'Very good' }, { key: 'poor', label: 'Poor' }]
    },
    { key: 'account_id', type: 'hidden', title: 'Account ID', required: false, prefillable: false, context: true },
    { key: 'total', type: 'number', title: 'Total', required: false, prefillable: false, calculated: true },
    { key: 'contract', type: 'signature', title: 'Signature', required: true, prefillable: false },
    {
        key: 'attendees',
        type: 'group',
        repeating: true,
        members: [{ key: 'attendee_name', type: 'text', title: 'Attendee name', required: true, prefillable: true }]
    }
]

/** The names an interface exposes, `collection` and `array` entries walked. */
function interfaceNames(fields) {
    return fields.map((field) => field.name)
}

function untypedAnswers(fields) {
    return fields.map((field) => {
        if (field.name !== 'answers' && field.name !== 'display') return field
        return { name: field.name, type: 'any', label: field.label, help: field.help }
    })
}

function walkFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const absolutePath = path.join(directory, entry.name)
        return entry.isDirectory() ? walkFiles(absolutePath) : [absolutePath]
    })
}

function assertInterfaceFields(fields, location = 'interface') {
    for (const field of fields) {
        assert.equal(typeof field.name, 'string', `${location} field must have a name`)
        assert.ok(VALID_INTERFACE_TYPES.has(field.type), `${location}.${field.name} has unsupported type ${field.type}`)

        if (field.type === 'collection') {
            assert.ok(Array.isArray(field.spec), `${location}.${field.name}.spec must be an array`)
            assertInterfaceFields(field.spec, `${location}.${field.name}`)
        }

        if (field.type === 'array' && Array.isArray(field.spec)) {
            assertInterfaceFields(field.spec, `${location}.${field.name}[]`)
        }

        if (field.type === 'array' && field.spec?.type === 'collection') {
            assert.ok(Array.isArray(field.spec.spec), `${location}.${field.name}[].spec must be an array`)
            assertInterfaceFields(field.spec.spec, `${location}.${field.name}[]`)
        }
    }
}

test('all IML mirror files contain valid JSON', () => {
    const files = walkFiles(ROOT).filter((file) => file.endsWith('.imljson'))
    assert.ok(files.length >= 25)

    for (const file of files) {
        assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')), path.relative(ROOT, file))
    }
})

test('base uses OAuth bearer auth, envelope errors, and sanitized logs', () => {
    const base = readJson('app/base.imljson')
    assert.equal(base.baseUrl, 'https://api.formbase.so')
    assert.equal(base.headers.Authorization, 'Bearer {{connection.accessToken}}')
    assert.equal(base.response.error['401'].type, 'InvalidAccessTokenError')
    assert.equal(base.response.error['429'].type, 'RateLimitError')
    assert.ok(base.log.sanitize.includes('request.headers.authorization'))
    assert.equal(JSON.stringify(base).includes('connection.apiKey'), false)
})

test('OAuth connection implements PKCE, confidential client auth, rotation, and workspace scoping', () => {
    const common = readJson('connections/formbase/common.imljson')
    const communication = readJson('connections/formbase/communication.imljson')
    const scope = readJson('connections/formbase/scope.imljson')

    assert.equal(common.clientId, 'fboc_make')
    assert.equal(common.clientSecret, 'REPLACE_IN_MAKE_DEVELOPER_HUB')
    assert.deepEqual(scope, ['api:read', 'api:write', 'offline_access'])

    assert.equal(communication.authorize.url, 'https://api.formbase.so/oauth/authorize')
    assert.equal(communication.authorize.qs.redirect_uri, '{{oauth.localRedirectUri}}')
    assert.equal(communication.authorize.qs.code_challenge_method, 'S256')
    assert.match(communication.authorize.qs.code_challenge, /sha256\(temp\.codeVerifier/)
    assert.match(communication.authorize.qs.code_challenge, /replace\(replace\(replace/)
    assert.equal(communication.authorize.qs.code_challenge.includes('base64url('), false)

    assert.equal(communication.token.url, 'https://api.formbase.so/oauth/token')
    assert.equal(communication.token.type, 'urlencoded')
    assert.equal(communication.token.body.grant_type, 'authorization_code')
    assert.equal(communication.token.body.code_verifier, '{{temp.codeVerifier}}')
    assert.equal(communication.token.body.client_secret, '{{common.clientSecret}}')
    assert.equal(communication.token.response.data.refreshToken, '{{body.refresh_token}}')

    assert.equal(communication.refresh.body.grant_type, 'refresh_token')
    assert.equal(communication.refresh.body.refresh_token, '{{data.refreshToken}}')
    assert.equal(communication.refresh.response.data.refreshToken, '{{body.refresh_token}}')
    assert.match(communication.refresh.condition, /data\.expires/)

    assert.equal(communication.info.body.method, 'workspaces.list')
    assert.equal(communication.info.response.data.workspaceId, '{{body.data.items[1].id}}')
    assert.ok(communication.info.log.sanitize.includes('request.headers.authorization'))

    const serialized = JSON.stringify(communication)
    for (const secretPath of ['request.body.code_verifier', 'request.body.client_secret', 'response.body.access_token', 'response.body.refresh_token']) {
        assert.ok(serialized.includes(secretPath), `${secretPath} must be sanitized`)
    }
})

test('instant trigger delegates lifecycle to attached webhook', () => {
    const moduleApi = readJson('modules/watch_public_link_submissions/api.imljson')
    const moduleParameters = readJson('modules/watch_public_link_submissions/parameters.imljson')
    const webhookParameters = readJson('webhooks/submission_webhook/parameters.imljson')
    const webhook = readJson('webhooks/submission_webhook/api.imljson')
    const attach = readJson('webhooks/submission_webhook/attach.imljson')
    const detach = readJson('webhooks/submission_webhook/detach.imljson')

    assert.deepEqual(moduleApi, {})
    assert.deepEqual(moduleParameters, [])
    assert.equal(webhookParameters.find((field) => field.name === 'formId')?.options.store, 'rpc://listForms')
    const eventType = webhookParameters.find((field) => field.name === 'eventType')
    assert.equal(eventType?.default, 'submission_created')
    // One subscription event per trigger: created receives submission.completed only, updated
    // receives submission.updated only, abandoned receives submission.abandoned.
    assert.deepEqual(
        eventType.options.map((option) => option.value),
        ['submission_created', 'submission_updated', 'submission_abandoned']
    )
    const updatedOption = eventType.options.find((option) => option.value === 'submission_updated')
    assert.equal(updatedOption.label, 'Submission updated')
    // Only an abandoned subscription takes an idle window.
    assert.deepEqual(
        eventType.options.filter((option) => 'nested' in option).map((option) => option.value),
        ['submission_abandoned']
    )
    assert.match(eventType.help, /Submission updated fires when the respondent edits a submission they already sent/)
    assert.doesNotMatch(eventType.help, /again when/)
    const abandonedOption = eventType.options.find((option) => option.value === 'submission_abandoned')
    const idleWindow = abandonedOption.nested.find((field) => field.name === 'idleWindow')
    assert.equal(idleWindow.required, true)
    assert.equal(idleWindow.default, '12h')
    assert.deepEqual(
        idleWindow.options.map((option) => option.value),
        ['12h', '1d', '3d', '1w']
    )

    assert.equal('verification' in webhook, false)
    assert.equal(webhook.output, '{{body}}')
    assert.equal(webhook.respond.status, 200)

    assert.equal(attach.body.method, 'webhooks.create')
    assert.equal(attach.url, '/api/v1')
    assert.equal(attach.body.params.formId, '{{parameters.formId}}')
    assert.equal(attach.body.params.provider, 'make')
    assert.equal(attach.body.params.eventType, '{{parameters.eventType}}')
    // A created subscription must not send idleWindow at all, not even one left over from a
    // previous abandoned selection; `undefined` makes Make omit the key.
    assert.equal(attach.body.params.idleWindow, "{{if(parameters.eventType = 'submission_abandoned', parameters.idleWindow, undefined)}}")
    assert.equal(attach.response.data.subscriptionId, '{{body.data.subscriptionId}}')

    assert.equal(detach.body.method, 'webhooks.delete')
    assert.equal(detach.url, '/api/v1')
    assert.deepEqual(detach.body.params, { subscriptionId: '{{webhook.subscriptionId}}' })
})

test('form picker and sample RPC match current paginated API envelopes', () => {
    const listForms = readJson('rpcs/list_forms/api.imljson')
    const sample = readJson('rpcs/get_sample_submission/api.imljson')
    const moduleSamples = readJson('modules/watch_public_link_submissions/samples.imljson')

    assert.equal(listForms.body.method, 'forms.list')
    assert.equal(listForms.url, '/api/v1')
    assert.equal(listForms.body.params.workspaceId, '{{connection.workspaceId}}')
    assert.equal(listForms.response.iterate, '{{body.data.items}}')
    assert.equal(listForms.response.output.value, '{{item.id}}')
    assert.equal(listForms.response.limit, 300)
    assert.match(listForms.pagination.condition, /hasMore/)
    assert.equal(listForms.pagination.body.params.cursor, '{{body.data.nextCursor}}')

    assert.equal(moduleSamples, 'rpc://getSampleSubmission')
    assert.equal(sample.body.method, 'submissions.sample')
    assert.equal(sample.url, '/api/v1')
    assert.equal(sample.body.params.formId, '{{webhook.formId}}')
    assert.equal(sample.response.output, '{{body.data}}')
})

test('static interface fallback is the envelope with untyped answers', () => {
    const staticInterface = readJson('modules/watch_public_link_submissions/interface.static.imljson')
    const buildSubmissionInterface = loadImlFunction('functions/buildSubmissionInterface.js', 'buildSubmissionInterface')

    const expected = buildSubmissionInterface([])
    const data = expected.find((field) => field.name === 'data')
    for (const name of ['answers', 'display']) {
        const index = data.spec.findIndex((field) => field.name === name)
        const field = data.spec[index]
        data.spec[index] = { name: field.name, type: 'any', label: field.label, help: field.help }
    }
    assert.deepEqual(staticInterface, expected)
})

test('abandoned submission fixture and interface match the event envelope', () => {
    const fixture = readJson('test/fixtures/submission.json')
    const metadata = readJson('modules/watch_public_link_submissions/metadata.imljson')
    const outputInterface = readJson('modules/watch_public_link_submissions/interface.imljson')
    const buildSubmissionInterface = loadImlFunction('functions/buildSubmissionInterface.js', 'buildSubmissionInterface')

    assert.equal(outputInterface, 'rpc://getSubmissionInterface')
    const envelopeOnly = buildSubmissionInterface([])
    assertInterfaceFields(envelopeOnly)
    assert.equal(fixture.type, 'submission.abandoned')
    assert.equal(typeof fixture.apiVersion, 'string')
    assert.equal(typeof fixture.test, 'boolean')
    assert.match(metadata.description, /submission\.abandoned/)
    assert.match(metadata.description, /Submission created \(submission\.completed\)/)
    assert.match(metadata.description, /Submission updated when the respondent edits/)
    assert.equal(typeof fixture.data.submission.pdfUrl, 'string')
    assert.equal(fixture.data.submission.language, 'en')
    assert.equal('fields' in fixture, false)
    assert.deepEqual(Object.keys(fixture.data.display), Object.keys(fixture.data.answers))
    assert.ok(Object.values(fixture.data.answers).some((value) => Array.isArray(value)))

    assert.deepEqual(
        envelopeOnly.map((field) => field.name),
        ['id', 'type', 'createdAt', 'apiVersion', 'test', 'data']
    )
    const dataInterface = envelopeOnly.find((field) => field.name === 'data')
    const submissionInterface = dataInterface.spec.find((field) => field.name === 'submission')
    assert.deepEqual(
        submissionInterface.spec.map((field) => field.name),
        ['id', 'respondentEmail', 'submittedAt', 'updatedAt', 'editCount', 'pdfUrl', 'language']
    )
    for (const name of ['answers', 'display']) {
        assert.equal(dataInterface.spec.find((field) => field.name === name)?.type, 'collection')
        assert.deepEqual(dataInterface.spec.find((field) => field.name === name).spec, [])
    }
})

test('dynamic interface RPC builds answer fields from the published field list', () => {
    const rpcApi = readJson('rpcs/get_submission_interface/api.imljson')
    const rpcMetadata = readJson('rpcs/get_submission_interface/metadata.imljson')
    const buildSubmissionInterface = loadImlFunction('functions/buildSubmissionInterface.js', 'buildSubmissionInterface')

    assert.equal(rpcMetadata.name, 'getSubmissionInterface')
    assert.equal(rpcMetadata.connection, 'formbase')
    assert.equal(rpcApi.url, '/api/v1')
    assert.equal(rpcApi.body.method, 'fields.list')
    assert.equal(rpcApi.body.params.formId, '{{webhook.formId}}')
    assert.equal(rpcApi.response.output, '{{buildSubmissionInterface(body.data.items)}}')

    // The shape fields.list returns: plain fields, then one repeating group.
    const built = buildSubmissionInterface([
        { key: 'your_name', type: 'text', title: 'Your name', required: true, prefillable: true },
        { key: 'rating', type: 'rating', title: 'How likely are you to recommend us?', required: false, prefillable: true },
        { key: 'signed_on', type: 'date', title: 'Signed on', required: false, prefillable: true },
        { key: 'plan', type: 'select', title: 'Plan', required: false, prefillable: true, options: [{ key: 'pro', label: 'Pro' }] },
        { key: 'topics', type: 'checkbox', title: 'Topics', required: false, prefillable: true, options: [{ key: 'billing', label: 'Billing' }] },
        {
            key: 'satisfaction',
            type: 'matrix',
            title: 'How did we do?',
            required: false,
            prefillable: true,
            rows: [{ key: 'delivery_speed', label: 'Delivery speed' }, { key: 'support', label: 'Support' }],
            columns: [{ key: 'very_good', label: 'Very good' }, { key: 'poor', label: 'Poor' }]
        },
        { key: 'account_id', type: 'hidden', title: 'Account ID', required: false, prefillable: false, context: true },
        { key: 'total', type: 'number', title: 'Total', required: false, prefillable: false, calculated: true },
        {
            key: 'attendees',
            type: 'group',
            repeating: true,
            members: [{ key: 'attendee_name', type: 'text', title: 'Attendee name', required: true, prefillable: true }]
        },
        { key: 'book_a_call', type: 'schedule-appointment', title: 'Book a call', required: false, prefillable: false },
        { key: 'pay_the_fee', type: 'payment', title: 'Pay the fee', required: false, prefillable: false }
    ])

    assertInterfaceFields(built)
    const data = built.find((field) => field.name === 'data')
    const answers = data.spec.find((field) => field.name === 'answers')
    const display = data.spec.find((field) => field.name === 'display')
    const answer = (name) => answers.spec.find((field) => field.name === name)

    const answerKeys = answers.spec.map((field) => field.name)
    assert.deepEqual(answerKeys, ['your_name', 'rating', 'signed_on', 'plan', 'topics', 'satisfaction', 'account_id', 'total', 'attendees', 'book_a_call', 'pay_the_fee'])
    assert.deepEqual(display.spec.map((field) => field.name), answerKeys)
    assert.equal(display.spec.find((field) => field.name === 'plan').label, 'Plan (display)')

    assert.deepEqual(answer('your_name'), { name: 'your_name', type: 'text', label: 'Your name' })
    assert.equal(answer('rating').type, 'number')
    assert.equal(answer('signed_on').type, 'date')
    // A choice answer is the option key; a multi-choice answer is a list of them.
    assert.equal(answer('plan').type, 'text')
    assert.deepEqual(answer('topics'), { name: 'topics', type: 'array', label: 'Topics', spec: { type: 'text' } })
    // A matrix answer is `{ row_key: column_key }`, so each row is mappable on its own.
    assert.deepEqual(answer('satisfaction'), {
        name: 'satisfaction',
        type: 'collection',
        label: 'How did we do?',
        spec: [
            { name: 'delivery_speed', type: 'text', label: 'Delivery speed' },
            { name: 'support', type: 'text', label: 'Support' }
        ]
    })
    assert.equal(answer('account_id').type, 'text')
    assert.equal(answer('total').type, 'number')

    const group = answers.spec.find((field) => field.name === 'attendees')
    assert.equal(group.type, 'array')
    assert.equal(group.spec.type, 'collection')
    assert.deepEqual(group.spec.spec.map((field) => field.name), ['attendee_name'])
    assert.equal(display.spec.find((field) => field.name === 'attendees').type, 'text')

    // A booking and a payment are objects, so each property is mappable on its own.
    const booking = answer('book_a_call')
    assert.equal(booking.type, 'collection')
    assert.deepEqual(booking.spec.map((field) => field.name), ['status', 'start', 'end', 'timeZone', 'attendee', 'meetingUrl', 'eventTitle', 'provider', 'providerBookingId'])
    assert.equal(booking.spec.find((field) => field.name === 'start').type, 'date')
    assert.deepEqual(booking.spec.find((field) => field.name === 'attendee').spec.map((field) => field.name), ['name', 'email'])
    const payment = answer('pay_the_fee')
    assert.equal(payment.type, 'collection')
    assert.deepEqual(payment.spec.map((field) => field.name), ['status', 'amount', 'currency', 'amountRefunded', 'receiptUrl', 'paidAt', 'refundedAt', 'disputedAt', 'provider', 'providerPaymentIntentId'])
    assert.equal(payment.spec.find((field) => field.name === 'amount').type, 'number')
    assert.equal(display.spec.find((field) => field.name === 'pay_the_fee').type, 'text')

    // Every key the fixture carries is mappable, under both collections.
    const fixture = readJson('test/fixtures/submission.json')
    const fixtureInterface = buildSubmissionInterface([
        { key: 'your_name', type: 'text', title: 'Your name' },
        { key: 'rating', type: 'rating', title: 'Rating' },
        { key: 'attendees', type: 'group', repeating: true, members: [{ key: 'attendee_name', type: 'text', title: 'Attendee name' }] },
        { key: 'book_a_call', type: 'schedule-appointment', title: 'Book a call' },
        { key: 'pay_the_fee', type: 'payment', title: 'Pay the fee' }
    ])
    const fixtureAnswers = fixtureInterface
        .find((field) => field.name === 'data')
        .spec.find((field) => field.name === 'answers')
    assert.deepEqual(fixtureAnswers.spec.map((field) => field.name), Object.keys(fixture.data.answers))
    // Every property of the fixture's booking and payment has an interface entry.
    for (const key of ['book_a_call', 'pay_the_fee']) {
        const spec = fixtureAnswers.spec.find((field) => field.name === key).spec
        assert.deepEqual(spec.map((field) => field.name).sort(), Object.keys(fixture.data.answers[key]).sort())
    }
})

test('universal API module forwards method and JSON params through current envelope', () => {
    const metadata = readJson('modules/make_api_call/metadata.imljson')
    const api = readJson('modules/make_api_call/api.imljson')
    const expect = readJson('modules/make_api_call/expect.imljson')
    const outputInterface = readJson('modules/make_api_call/interface.imljson')

    assert.equal(metadata.label, 'Make an API call')
    assert.equal(metadata.type, 'universal')
    assert.equal(metadata.name, 'makeApiCall')
    assert.equal(api.url, '/api/v1')
    assert.equal(api.body.method, '{{parameters.method}}')
    assert.equal(api.body.params, '{{parameters.params}}')
    assert.deepEqual(api.response.output, { data: '{{body.data}}' })
    assert.equal(expect.find((field) => field.name === 'params')?.type, 'json')
    assert.equal(outputInterface.find((field) => field.name === 'data')?.type, 'any')
})

// ─── requests ───────────────────────────────────────────────────────────────

test('every module, webhook and RPC is declared and every reference resolves', () => {
    const rpcNames = new Set(fs.readdirSync(path.join(ROOT, 'rpcs')).map((dir) => readJson(`rpcs/${dir}/metadata.imljson`).name))
    const webhookNames = new Set(fs.readdirSync(path.join(ROOT, 'webhooks')).map((dir) => readJson(`webhooks/${dir}/metadata.imljson`).name))
    const functionNames = new Set(fs.readdirSync(path.join(ROOT, 'functions')).map((file) => path.basename(file, '.js')))
    const modules = fs.readdirSync(path.join(ROOT, 'modules'))

    assert.deepEqual(
        modules.sort(),
        ['cancel_request', 'create_request', 'get_request', 'make_api_call', 'remind_request', 'search_requests', 'watch_public_link_submissions', 'watch_requests']
    )
    for (const dir of modules) {
        const metadata = readJson(`modules/${dir}/metadata.imljson`)
        assert.equal(metadata.connection, 'formbase', `${dir} must use the formbase connection`)
        assert.ok(['instant_trigger', 'action', 'search', 'universal'].includes(metadata.type), `${dir} has type ${metadata.type}`)
        if (metadata.type === 'instant_trigger') assert.ok(webhookNames.has(metadata.webhook), `${dir} webhook ${metadata.webhook} missing`)
        if (metadata.type === 'action') assert.ok(['create', 'read', 'update', 'delete'].includes(metadata.actionType), `${dir} needs an actionType`)
        for (const file of ['api', 'interface', 'samples', 'parameters', 'metadata']) {
            assert.ok(fs.existsSync(path.join(ROOT, `modules/${dir}/${file}.imljson`)), `${dir}/${file}.imljson missing`)
        }
        if (metadata.type !== 'instant_trigger') assert.ok(fs.existsSync(path.join(ROOT, `modules/${dir}/expect.imljson`)), `${dir}/expect.imljson missing`)
    }

    for (const file of walkFiles(ROOT).filter((entry) => entry.endsWith('.imljson') && !entry.includes('node_modules'))) {
        const source = fs.readFileSync(file, 'utf8')
        for (const [, name] of source.matchAll(/rpc:\/\/([A-Za-z]+)/g)) {
            assert.ok(rpcNames.has(name), `${path.relative(ROOT, file)} references unknown RPC ${name}`)
        }
        for (const [, name] of source.matchAll(/\{\{(build[A-Za-z]+)\(/g)) {
            assert.ok(functionNames.has(name), `${path.relative(ROOT, file)} calls unknown IML function ${name}`)
        }
    }
})

test('Watch requests delegates lifecycle to the request webhook', () => {
    const metadata = readJson('modules/watch_requests/metadata.imljson')
    const moduleApi = readJson('modules/watch_requests/api.imljson')
    const moduleParameters = readJson('modules/watch_requests/parameters.imljson')
    const webhookParameters = readJson('webhooks/request_webhook/parameters.imljson')
    const webhook = readJson('webhooks/request_webhook/api.imljson')
    const attach = readJson('webhooks/request_webhook/attach.imljson')
    const detach = readJson('webhooks/request_webhook/detach.imljson')
    const sample = readJson('rpcs/get_sample_request/api.imljson')

    assert.equal(metadata.type, 'instant_trigger')
    assert.equal(metadata.webhook, 'request_webhook')
    assert.match(metadata.description, /request\.completed, request\.expired or request\.canceled/)
    assert.deepEqual(moduleApi, {})
    assert.deepEqual(moduleParameters, [])
    assert.equal(readJson('modules/watch_requests/interface.imljson'), 'rpc://getRequestEventInterface')
    assert.equal(readJson('modules/watch_requests/samples.imljson'), 'rpc://getSampleRequest')

    assert.equal(webhookParameters.find((field) => field.name === 'formId')?.options.store, 'rpc://listForms')
    const eventType = webhookParameters.find((field) => field.name === 'eventType')
    assert.equal(eventType.default, 'request_completed')
    assert.deepEqual(
        eventType.options.map((option) => option.value),
        ['request_completed', 'request_expired', 'request_canceled']
    )
    // One channel, one event: a completed request never fires Watch public link submissions, and the help says so.
    assert.match(eventType.help, /never Watch public link submissions/)

    // Same unsigned receive as the submission webhook: Make never sees the raw body.
    assert.deepEqual(webhook, readJson('webhooks/submission_webhook/api.imljson'))

    assert.equal(attach.url, '/api/v1')
    assert.equal(attach.body.method, 'webhooks.create')
    assert.deepEqual(attach.body.params, {
        formId: '{{parameters.formId}}',
        targetUrl: '{{webhook.url}}',
        provider: 'make',
        eventType: '{{parameters.eventType}}'
    })
    assert.equal('idleWindow' in attach.body.params, false)
    assert.equal(attach.response.data.subscriptionId, '{{body.data.subscriptionId}}')
    assert.deepEqual(detach, readJson('webhooks/submission_webhook/detach.imljson'))

    assert.equal(sample.url, '/api/v1')
    assert.equal(sample.body.method, 'requests.sample')
    assert.deepEqual(sample.body.params, { formId: '{{webhook.formId}}', eventType: '{{webhook.eventType}}' })
    assert.equal(sample.response.output, '{{body.data}}')
})

test('request event interface carries the request block for every type and answers on completion only', () => {
    const iml = loadImlNamespace()
    const rpcApi = readJson('rpcs/get_request_event_interface/api.imljson')
    assert.equal(rpcApi.body.method, 'fields.list')
    assert.equal(rpcApi.body.params.formId, '{{webhook.formId}}')
    assert.equal(rpcApi.response.output, '{{buildRequestEventInterface(body.data.items, webhook.eventType)}}')

    const completed = iml.buildRequestEventInterface(FIELD_LIST, 'request_completed')
    assertInterfaceFields(completed)
    assert.deepEqual(interfaceNames(completed), ['id', 'type', 'createdAt', 'apiVersion', 'test', 'data'])
    const completedData = completed.find((field) => field.name === 'data')
    assert.deepEqual(interfaceNames(completedData.spec), ['request', 'form', 'submission', 'answers', 'display'])
    const request = completedData.spec.find((field) => field.name === 'request')
    assert.deepEqual(interfaceNames(request.spec), [
        'id', 'externalId', 'status', 'outcome', 'language', 'recipient', 'metadata', 'context',
        'createdAt', 'completedAt', 'expiredAt', 'canceledAt', 'cancelReason'
    ])

    // The per-key half is the one Watch public link submissions builds, so a field key maps under the same pill.
    const submission = iml.buildSubmissionInterface(FIELD_LIST).find((field) => field.name === 'data')
    for (const name of ['form', 'submission', 'answers', 'display']) {
        assert.deepEqual(completedData.spec.find((field) => field.name === name), submission.spec.find((field) => field.name === name))
    }

    for (const eventType of ['request_expired', 'request_canceled']) {
        const terminal = iml.buildRequestEventInterface(FIELD_LIST, eventType)
        assertInterfaceFields(terminal)
        assert.deepEqual(interfaceNames(terminal.find((field) => field.name === 'data').spec), ['request'])
    }

    // Every key both fixtures carry is mappable.
    const completedFixture = readJson('test/fixtures/request_completed.json')
    const expiredFixture = readJson('test/fixtures/request_expired.json')
    const fixtureInterface = iml.buildRequestEventInterface(
        [
            { key: 'your_name', type: 'text', title: 'Your name' },
            { key: 'rating', type: 'rating', title: 'Rating' },
            { key: 'attendees', type: 'group', repeating: true, members: [{ key: 'attendee_name', type: 'text', title: 'Attendee name' }] }
        ],
        'request_completed'
    )
    const fixtureData = fixtureInterface.find((field) => field.name === 'data')
    assert.deepEqual(Object.keys(completedFixture.data), interfaceNames(fixtureData.spec))
    assert.deepEqual(Object.keys(completedFixture.data.answers), interfaceNames(fixtureData.spec.find((field) => field.name === 'answers').spec))
    const requestNames = interfaceNames(fixtureData.spec.find((field) => field.name === 'request').spec)
    for (const fixture of [completedFixture, expiredFixture]) {
        assert.equal(fixture.type.startsWith('request.'), true)
        for (const key of Object.keys(fixture.data.request)) assert.ok(requestNames.includes(key), `request.${key} is not mappable`)
    }
    assert.deepEqual(Object.keys(expiredFixture.data), ['request'])
})

test('Watch requests static interface fallback is the completed envelope with untyped answers', () => {
    const iml = loadImlNamespace()
    const staticInterface = readJson('modules/watch_requests/interface.static.imljson')

    const expected = iml.buildRequestEventInterface([], 'request_completed')
    const data = expected.find((field) => field.name === 'data')
    data.spec = untypedAnswers(data.spec)
    for (const field of data.spec) {
        if (field.name !== 'request') field.help = `${field.help ? `${field.help} ` : ''}Present only on request.completed.`
    }
    assertInterfaceFields(staticInterface)
    assert.deepEqual(staticInterface, expected)
})

test('Get a request reads by request id and lists answers under the form\'s field keys', () => {
    const iml = loadImlNamespace()
    const metadata = readJson('modules/get_request/metadata.imljson')
    const api = readJson('modules/get_request/api.imljson')
    const parameters = readJson('modules/get_request/parameters.imljson')
    const expect = readJson('modules/get_request/expect.imljson')
    const rpcApi = readJson('rpcs/get_request_interface/api.imljson')
    const samples = readJson('modules/get_request/samples.imljson')

    assert.equal(metadata.type, 'action')
    assert.equal(metadata.actionType, 'read')
    assert.equal(api.url, '/api/v1')
    assert.equal(api.body.method, 'requests.get')
    assert.deepEqual(api.body.params, { requestId: '{{parameters.requestId}}' })
    assert.equal(api.response.output, '{{body.data}}')
    // The form is a static parameter: it only shapes the mapping panel, the id fetches the request.
    assert.deepEqual(parameters.map((field) => field.name), ['formId'])
    assert.equal(parameters[0].mappable, false)
    assert.equal(parameters[0].options.store, 'rpc://listForms')
    assert.deepEqual(expect.map((field) => field.name), ['requestId'])
    assert.equal(expect[0].required, true)

    assert.equal(readJson('modules/get_request/interface.imljson'), 'rpc://getRequestInterface')
    assert.equal(rpcApi.body.method, 'fields.list')
    assert.equal(rpcApi.body.params.formId, '{{parameters.formId}}')
    assert.equal(rpcApi.response.output, '{{buildRequestInterface(body.data.items)}}')

    const built = iml.buildRequestInterface(FIELD_LIST)
    assertInterfaceFields(built)
    const submission = iml.buildSubmissionInterface(FIELD_LIST).find((field) => field.name === 'data')
    for (const name of ['answers', 'display']) {
        assert.deepEqual(built.find((field) => field.name === name), submission.spec.find((field) => field.name === name))
    }
    assert.deepEqual(interfaceNames(built).slice(-3), ['answers', 'display', 'timeline'])
    // The sample is a completed request: every key it carries is mappable.
    assert.deepEqual(Object.keys(samples), interfaceNames(built))

    const staticInterface = readJson('modules/get_request/interface.static.imljson')
    assertInterfaceFields(staticInterface)
    assert.deepEqual(staticInterface, untypedAnswers(iml.buildRequestInterface([])))
})

test('Create a request builds its per-key inputs from the published field list', () => {
    const iml = loadImlNamespace()
    const metadata = readJson('modules/create_request/metadata.imljson')
    const api = readJson('modules/create_request/api.imljson')
    const expect = readJson('modules/create_request/expect.imljson')
    const rpcApi = readJson('rpcs/get_request_fields/api.imljson')
    const outputInterface = readJson('modules/create_request/interface.imljson')
    const samples = readJson('modules/create_request/samples.imljson')

    assert.equal(metadata.type, 'action')
    assert.equal(metadata.actionType, 'create')
    assert.equal(api.url, '/api/v1')
    assert.equal(api.body.method, 'requests.create')
    assert.deepEqual(api.body.params, {
        formId: '{{parameters.formId}}',
        recipient: { email: '{{parameters.recipientEmail}}', name: '{{parameters.recipientName}}' },
        language: '{{parameters.language}}',
        prefill: '{{parameters.prefill}}',
        context: '{{parameters.context}}',
        readonly: '{{parameters.readonly}}',
        externalId: '{{parameters.externalId}}',
        // The external id doubles as the idempotency key; both keys drop out together when it is empty.
        idempotencyKey: '{{parameters.externalId}}',
        metadata: '{{parameters.metadata}}',
        delivery: '{{parameters.delivery}}',
        reminders: '{{parameters.reminders}}',
        expiresAt: "{{if(parameters.expiresAt, parseNumber(formatDate(parameters.expiresAt, 'x')), undefined)}}",
        test: '{{parameters.test}}'
    })
    assert.equal('callbackUrl' in api.body.params, false)
    assert.equal(api.response.output, '{{body.data}}')

    const formId = expect.find((field) => field.name === 'formId')
    assert.deepEqual(formId.options, { store: 'rpc://listForms', nested: 'rpc://getRequestFields' })
    assert.equal(formId.mappable, false)
    assert.deepEqual(
        expect.map((field) => field.name),
        ['formId', 'recipientEmail', 'recipientName', 'delivery', 'externalId', 'language', 'reminders', 'expiresAt', 'metadata', 'test']
    )
    assert.equal(expect.find((field) => field.name === 'delivery').default, 'none')
    assert.equal(expect.find((field) => field.name === 'metadata').type, 'json')
    assert.equal(expect.find((field) => field.name === 'test').default, false)

    assert.equal(rpcApi.body.method, 'fields.list')
    assert.equal(rpcApi.body.params.formId, '{{parameters.formId}}')
    assert.equal(rpcApi.response.output, '{{buildRequestFields(body.data.items)}}')

    const fields = iml.buildRequestFields(FIELD_LIST)
    assert.deepEqual(fields.map((field) => field.name), ['prefill', 'context', 'readonly'])
    const [prefill, context, readonly] = fields
    assert.equal(prefill.type, 'collection')
    // Prefillable questions only: no hidden, calculated or signature field.
    assert.deepEqual(prefill.spec.map((field) => field.name), ['your_name', 'rating', 'signed_on', 'plan', 'topics', 'satisfaction', 'attendees'])
    const input = (name) => prefill.spec.find((field) => field.name === name)
    assert.deepEqual(input('your_name'), { name: 'your_name', label: 'Your name', required: false, type: 'text' })
    assert.equal(input('rating').type, 'number')
    assert.equal(input('signed_on').type, 'text')
    assert.match(input('signed_on').help, /YYYY-MM-DD/)
    // A choice question offers its option keys, labelled for a person.
    assert.deepEqual(input('plan'), { name: 'plan', label: 'Plan', required: false, type: 'select', options: [{ label: 'Pro', value: 'pro' }] })
    assert.equal(input('topics').type, 'select')
    assert.equal(input('topics').multiple, true)
    assert.deepEqual(input('topics').options, [{ label: 'Billing', value: 'billing' }])
    // A matrix takes one column key per row.
    assert.equal(input('satisfaction').type, 'collection')
    assert.deepEqual(input('satisfaction').spec.map((field) => field.name), ['delivery_speed', 'support'])
    assert.deepEqual(input('satisfaction').spec[0].options, [{ label: 'Very good', value: 'very_good' }, { label: 'Poor', value: 'poor' }])
    // A repeating group is an array of rows keyed by member field key.
    assert.equal(input('attendees').type, 'array')
    assert.deepEqual(input('attendees').spec.map((field) => field.name), ['attendee_name'])

    assert.equal(context.type, 'collection')
    assert.deepEqual(context.spec, [{ name: 'account_id', type: 'text', label: 'Account ID', required: false }])

    assert.equal(readonly.type, 'select')
    assert.equal(readonly.multiple, true)
    assert.deepEqual(readonly.options.map((option) => option.value), ['your_name', 'rating', 'signed_on', 'plan', 'topics', 'satisfaction', 'attendees'])

    // No field list (an unpublished form) adds no inputs; a form with no hidden field has no Context.
    assert.deepEqual(iml.buildRequestFields([]), [])
    assert.deepEqual(iml.buildRequestFields([FIELD_LIST[0]]).map((field) => field.name), ['prefill', 'readonly'])

    assert.deepEqual(interfaceNames(outputInterface), ['id', 'status', 'url', 'deliveryStatus', 'expiresAt', 'createdAt', 'externalId', 'deduplicated'])
    assertInterfaceFields(outputInterface)
    assert.deepEqual(Object.keys(samples), interfaceNames(outputInterface))
})

test('Create a request static inputs replace the per-key inputs with JSON until IML functions are enabled', () => {
    const expect = readJson('modules/create_request/expect.imljson')
    const staticExpect = readJson('modules/create_request/expect.static.imljson')

    assert.deepEqual(
        staticExpect.map((field) => field.name),
        ['formId', 'prefill', 'context', 'readonly', ...expect.slice(1).map((field) => field.name)]
    )
    assert.deepEqual(staticExpect[0].options, { store: 'rpc://listForms' })
    assert.equal(staticExpect.find((field) => field.name === 'prefill').type, 'json')
    assert.equal(staticExpect.find((field) => field.name === 'context').type, 'json')
    assert.deepEqual(staticExpect.find((field) => field.name === 'readonly').spec, { type: 'text', label: 'Field key' })
    assert.deepEqual(staticExpect.slice(4), expect.slice(1))
})

test('Cancel, Remind and Search return the request summary', () => {
    const iml = loadImlNamespace()
    const summary = iml.buildRequestInterface([]).filter((field) => !['url', 'answers', 'display', 'timeline'].includes(field.name))
    assertInterfaceFields(summary)

    const cancel = readJson('modules/cancel_request/api.imljson')
    const cancelExpect = readJson('modules/cancel_request/expect.imljson')
    assert.equal(readJson('modules/cancel_request/metadata.imljson').actionType, 'update')
    assert.equal(cancel.url, '/api/v1')
    assert.equal(cancel.body.method, 'requests.cancel')
    assert.deepEqual(cancel.body.params, { requestId: '{{parameters.requestId}}', reason: '{{parameters.reason}}' })
    assert.equal(cancel.response.output, '{{body.data}}')
    assert.deepEqual(cancelExpect.map((field) => [field.name, field.required]), [['requestId', true], ['reason', false]])

    const remind = readJson('modules/remind_request/api.imljson')
    assert.equal(readJson('modules/remind_request/metadata.imljson').actionType, 'update')
    assert.equal(remind.url, '/api/v1')
    assert.equal(remind.body.method, 'requests.remind')
    assert.deepEqual(remind.body.params, { requestId: '{{parameters.requestId}}' })
    assert.equal(remind.response.output, '{{body.data}}')
    assert.deepEqual(readJson('modules/remind_request/expect.imljson').map((field) => field.name), ['requestId'])

    const search = readJson('modules/search_requests/api.imljson')
    const searchExpect = readJson('modules/search_requests/expect.imljson')
    assert.equal(readJson('modules/search_requests/metadata.imljson').type, 'search')
    assert.equal(search.url, '/api/v1')
    assert.equal(search.body.method, 'requests.list')
    assert.deepEqual(search.body.params, {
        formId: '{{parameters.formId}}',
        status: '{{parameters.status}}',
        externalId: '{{parameters.externalId}}',
        includeTest: '{{parameters.includeTest}}',
        limit: '{{min(100, parameters.limit)}}'
    })
    assert.equal(search.response.limit, '{{parameters.limit}}')
    assert.equal(search.response.iterate, '{{body.data.items}}')
    assert.equal(search.response.output, '{{item}}')
    assert.match(search.pagination.condition, /hasMore/)
    assert.deepEqual(search.pagination.body, { method: 'requests.list', params: { ...search.body.params, cursor: '{{body.data.nextCursor}}' } })
    assert.equal(searchExpect.find((field) => field.name === 'formId').options.store, 'rpc://listForms')
    assert.deepEqual(
        searchExpect.find((field) => field.name === 'status').options.map((option) => option.value),
        ['pending', 'completed', 'expired', 'canceled']
    )
    assert.equal(searchExpect.find((field) => field.name === 'limit').default, 25)

    for (const module of ['cancel_request', 'remind_request', 'search_requests']) {
        assert.deepEqual(readJson(`modules/${module}/interface.imljson`), summary, `${module} interface must be the request summary`)
        assert.deepEqual(Object.keys(readJson(`modules/${module}/samples.imljson`)), interfaceNames(summary), `${module} sample must match its interface`)
    }
    assert.equal(readJson('modules/cancel_request/samples.imljson').status, 'canceled')
    assert.equal(readJson('modules/remind_request/samples.imljson').remindersSent, 1)
    assert.equal(readJson('modules/search_requests/samples.imljson').status, 'pending')
})
