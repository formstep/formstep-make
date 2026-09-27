#!/usr/bin/env node
/**
 * Pushes this repository to the Make Developer Hub through Make's SDK Apps API.
 *
 *   npm run sync:hub                 dry run: read the Hub, compare, print the plan
 *   npm run sync:hub -- --apply      create missing components, push differing sections
 *
 * Flags: --static (default while formbase#207 is open) pushes the `*.static.imljson`
 * twins and skips IML functions and the RPCs that call them; --dynamic pushes both.
 * --map <repo name>=<hub name> pins a connection or webhook to a Hub component when
 * its label does not match.
 *
 * The script only reads, creates components, patches their general settings and sets
 * sections. It never publishes, requests review, changes visibility or deletes.
 *
 * Endpoints follow https://developers.make.com/api-documentation/api-reference/sdk-apps
 * and Make's own VS Code extension (integromat/vscode-apps-sdk), which uses the same API.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API_BASE = 'https://eu1.make.com/api/v2'
const APP_NAME = 'formbase-f1d7bp'
const APP_VERSION = 1
const ENV_FILE = path.join(os.homedir(), '.config', 'formbase-make', '.env')
export const SECRET_PLACEHOLDER = 'REPLACE_IN_MAKE_DEVELOPER_HUB'

export const CONTENT_TYPES = {
    jsonc: 'application/jsonc',
    // Common data is encrypted and takes plain JSON only, no comments.
    json: 'application/json',
    markdown: 'text/markdown',
    javascript: 'application/javascript'
}

/** Repository file -> Hub section per component kind, in the order README section 2 pastes them. */
export const SECTION_FILES = {
    app: [
        { file: 'base.imljson', section: 'base', format: 'jsonc' },
        { file: 'readme.md', section: 'readme', format: 'markdown' }
    ],
    connection: [
        { file: 'communication.imljson', section: 'api', format: 'jsonc' },
        { file: 'parameters.imljson', section: 'parameters', format: 'jsonc' },
        { file: 'scope.imljson', section: 'scope', format: 'jsonc' },
        { file: 'common.imljson', section: 'common', format: 'json' }
    ],
    rpc: [
        { file: 'api.imljson', section: 'api', format: 'jsonc' },
        { file: 'parameters.imljson', section: 'parameters', format: 'jsonc' }
    ],
    webhook: [
        { file: 'parameters.imljson', section: 'parameters', format: 'jsonc' },
        { file: 'attach.imljson', section: 'attach', format: 'jsonc' },
        { file: 'detach.imljson', section: 'detach', format: 'jsonc' },
        { file: 'api.imljson', section: 'api', format: 'jsonc' }
    ],
    module: [
        { file: 'parameters.imljson', section: 'parameters', format: 'jsonc' },
        { file: 'expect.imljson', section: 'expect', format: 'jsonc' },
        { file: 'api.imljson', section: 'api', format: 'jsonc' },
        { file: 'interface.imljson', section: 'interface', format: 'jsonc' },
        { file: 'samples.imljson', section: 'samples', format: 'jsonc' }
    ]
}

/** Repository files with no Hub section, and why. */
const NOT_SYNCED = {
    'app/metadata.imljson': 'app general settings (label, description) are set in the Hub by hand',
    'app/parameters.imljson': 'the SDK Apps API has no app parameters section (app sections: base, groups, install, installSpec, common, readme)'
}

/** `metadata.type` -> the API's `typeId` (Create Module: 1 trigger, 4 action, 9 search, 10 instant trigger, 11 responder, 12 universal). */
export const MODULE_TYPES = {
    instant_trigger: { typeId: 10, label: 'instant trigger' },
    trigger: { typeId: 1, label: 'trigger' },
    action: { typeId: 4, label: 'action' },
    search: { typeId: 9, label: 'search' },
    responder: { typeId: 11, label: 'responder' },
    universal: { typeId: 12, label: 'universal' }
}

/** Repository connection types -> Create Connection `type` (`oauth` is OAuth 2.0 authorization code). */
const CONNECTION_TYPES = { oauth2: 'oauth', basic: 'basic' }

const LIST_KEYS = {
    connection: ['appConnections'],
    webhook: ['appWebhooks'],
    // The reference documents `rpcs`; the API and Make's VS Code extension use `appRpcs`.
    rpc: ['appRpcs', 'rpcs'],
    module: ['appModules'],
    function: ['appFunctions']
}

const DETAIL_KEYS = { connection: 'appConnection', webhook: 'appWebhook', rpc: 'appRpc', module: 'appModule', function: 'appFunction' }

// ─── Local repository ──────────────────────────────────────────────────────

function readText(root, relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function readJson(root, relativePath) {
    return JSON.parse(readText(root, relativePath))
}

function listDirectories(root, relativePath) {
    return fs
        .readdirSync(path.join(root, relativePath), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
}

/**
 * The file a section is pushed from: the `*.static.imljson` twin in static mode when one
 * exists, else the file itself, else nothing (the section is not part of the component).
 */
export function chooseSectionFile(file, mode, exists) {
    const twin = file.replace(/\.imljson$/, '.static.imljson')
    if (mode === 'static' && twin !== file && exists(twin)) return twin
    return exists(file) ? file : null
}

function sectionsFor(root, kind, directory, mode) {
    const sections = []
    for (const { file, section, format } of SECTION_FILES[kind]) {
        const chosen = chooseSectionFile(file, mode, (candidate) => fs.existsSync(path.join(root, directory, candidate)))
        if (!chosen) continue
        sections.push({ section, format, file: `${directory}/${chosen}`, staticTwin: chosen !== file })
    }
    return sections
}

function unmappedFiles(root, kind, directory) {
    const known = new Set(['metadata.imljson'])
    for (const { file } of SECTION_FILES[kind]) {
        known.add(file)
        known.add(file.replace(/\.imljson$/, '.static.imljson'))
    }
    return fs
        .readdirSync(path.join(root, directory))
        .filter((file) => !known.has(file))
        .map((file) => `${directory}/${file}`)
}

/** Function names a piece of IML calls, as `name(`. */
export function calledFunctions(source, functionNames) {
    return functionNames.filter((name) => source.includes(`${name}(`))
}

/** Orders IML functions so one reached through `iml.<name>` is created before its callers. */
function orderFunctions(functions) {
    const ordered = []
    const pending = [...functions]
    while (pending.length > 0) {
        const index = pending.findIndex((fn) => fn.dependsOn.every((name) => ordered.some((placed) => placed.name === name)))
        if (index === -1) throw new Error(`IML functions depend on each other in a cycle: ${pending.map((fn) => fn.name).join(', ')}`)
        ordered.push(...pending.splice(index, 1))
    }
    return ordered
}

/**
 * Reads the repository into the components to push, in README section 2's dependency order:
 * app, connection, IML functions, RPCs, webhooks, modules (triggers, actions, searches, universal).
 */
export function collectLocalApp(root, { mode }) {
    if (mode !== 'static' && mode !== 'dynamic') throw new Error(`Unknown mode ${mode}`)
    const components = []
    const skipped = []
    const notSynced = []
    const functionNames = fs
        .readdirSync(path.join(root, 'functions'))
        .filter((file) => file.endsWith('.js'))
        .map((file) => path.basename(file, '.js'))
        .sort()

    components.push({ kind: 'app', key: 'app', name: APP_NAME, sections: sectionsFor(root, 'app', 'app', mode) })
    for (const file of unmappedFiles(root, 'app', 'app').concat('app/metadata.imljson')) {
        notSynced.push({ file, reason: NOT_SYNCED[file] ?? 'no Hub section is mapped to this file' })
    }

    for (const directory of listDirectories(root, 'connections')) {
        const dir = `connections/${directory}`
        const metadata = readJson(root, `${dir}/metadata.imljson`)
        components.push({ kind: 'connection', key: `connection:${metadata.name}`, name: metadata.name, dir, metadata, sections: sectionsFor(root, 'connection', dir, mode) })
        for (const file of unmappedFiles(root, 'connection', dir)) notSynced.push({ file, reason: 'no Hub section is mapped to this file' })
    }

    const functions = functionNames.map((name) => {
        const file = `functions/${name}.js`
        const source = readText(root, file)
        const dependsOn = functionNames.filter((other) => other !== name && source.includes(`iml.${other}(`))
        return { kind: 'function', key: `function:${name}`, name, dependsOn, sections: [{ section: 'code', format: 'javascript', file, staticTwin: false }] }
    })
    for (const fn of orderFunctions(functions)) {
        if (mode === 'dynamic') components.push(fn)
        else skipped.push({ kind: 'function', name: fn.name, reason: 'static mode: IML functions are locked until formbase#207' })
    }

    for (const directory of listDirectories(root, 'rpcs')) {
        const dir = `rpcs/${directory}`
        const metadata = readJson(root, `${dir}/metadata.imljson`)
        const sections = sectionsFor(root, 'rpc', dir, mode)
        const calls = calledFunctions(sections.map((section) => readText(root, section.file)).join('\n'), functionNames)
        if (mode === 'static' && calls.length > 0) {
            skipped.push({ kind: 'rpc', name: metadata.name, reason: `static mode: calls ${calls.join(', ')}` })
            continue
        }
        components.push({ kind: 'rpc', key: `rpc:${metadata.name}`, name: metadata.name, dir, metadata, sections })
    }

    for (const directory of listDirectories(root, 'webhooks')) {
        const dir = `webhooks/${directory}`
        const metadata = readJson(root, `${dir}/metadata.imljson`)
        components.push({ kind: 'webhook', key: `webhook:${metadata.name}`, name: metadata.name, dir, metadata, sections: sectionsFor(root, 'webhook', dir, mode) })
        for (const file of unmappedFiles(root, 'webhook', dir)) notSynced.push({ file, reason: 'no Hub section is mapped to this file' })
    }

    const typeOrder = Object.keys(MODULE_TYPES)
    const modules = listDirectories(root, 'modules').map((directory) => {
        const dir = `modules/${directory}`
        const metadata = readJson(root, `${dir}/metadata.imljson`)
        const moduleType = MODULE_TYPES[metadata.type]
        if (!moduleType) throw new Error(`${dir}/metadata.imljson has unknown module type ${metadata.type}`)
        for (const file of unmappedFiles(root, 'module', dir)) notSynced.push({ file, reason: 'no Hub section is mapped to this file' })
        return { kind: 'module', key: `module:${metadata.name}`, name: metadata.name, dir, metadata, typeId: moduleType.typeId, sections: sectionsFor(root, 'module', dir, mode) }
    })
    modules.sort((a, b) => typeOrder.indexOf(a.metadata.type) - typeOrder.indexOf(b.metadata.type) || a.name.localeCompare(b.name))
    components.push(...modules)

    return { mode, components, skipped, notSynced, functionNames }
}

/**
 * References a pushed section makes to an RPC or IML function this run does not push.
 * Empty when the static/dynamic selection is consistent.
 */
export function danglingReferences(root, local) {
    const pushedRpcs = new Set(local.components.filter((component) => component.kind === 'rpc').map((component) => component.name))
    const pushedFunctions = new Set(local.components.filter((component) => component.kind === 'function').map((component) => component.name))
    const problems = []
    for (const component of local.components) {
        for (const section of component.sections) {
            const source = readText(root, section.file)
            for (const [, name] of source.matchAll(/rpc:\/\/([A-Za-z0-9_]+)/g)) {
                if (!pushedRpcs.has(name)) problems.push(`${section.file} references rpc://${name}, which this run does not push`)
            }
            const missing = local.functionNames.filter((name) => !pushedFunctions.has(name))
            for (const name of calledFunctions(source, missing)) {
                if (section.file !== `functions/${name}.js`) problems.push(`${section.file} calls ${name}, which this run does not push`)
            }
        }
    }
    return problems
}

/** Common data with the placeholder replaced by the real client secret. */
export function withClientSecret(text, secret) {
    const common = JSON.parse(text)
    if (common.clientSecret !== SECRET_PLACEHOLDER) {
        throw new Error(`connections common.imljson clientSecret must stay ${SECRET_PLACEHOLDER} in the repository`)
    }
    return JSON.stringify({ ...common, clientSecret: secret }, null, 4)
}

/** The body PUT for a section: the file as written, or common data with the secret substituted. */
export function sectionBody(root, section, secret) {
    const text = readText(root, section.file)
    if (section.section !== 'common') return text
    if (!secret) throw new Error('Common data needs MAKE_OAUTH_CLIENT_SECRET')
    return withClientSecret(text, secret)
}

// ─── Comparison ────────────────────────────────────────────────────────────

/** Parses JSON with `//` and block comments and trailing commas, the way the Hub stores IML. */
export function parseJsonc(text) {
    let withoutComments = ''
    let inString = false
    for (let index = 0; index < text.length; index++) {
        const char = text[index]
        if (inString) {
            withoutComments += char
            if (char === '\\') withoutComments += text[++index] ?? ''
            else if (char === '"') inString = false
            continue
        }
        if (char === '"') {
            inString = true
            withoutComments += char
            continue
        }
        if (char === '/' && text[index + 1] === '/') {
            const end = text.indexOf('\n', index)
            index = end === -1 ? text.length : end - 1
            continue
        }
        if (char === '/' && text[index + 1] === '*') {
            const end = text.indexOf('*/', index + 2)
            index = end === -1 ? text.length : end + 1
            continue
        }
        withoutComments += char
    }

    let withoutTrailingCommas = ''
    inString = false
    for (let index = 0; index < withoutComments.length; index++) {
        const char = withoutComments[index]
        if (inString) {
            withoutTrailingCommas += char
            if (char === '\\') withoutTrailingCommas += withoutComments[++index] ?? ''
            else if (char === '"') inString = false
            continue
        }
        if (char === '"') inString = true
        if (char === ',' && /^\s*[}\]]/.test(withoutComments.slice(index + 1))) continue
        withoutTrailingCommas += char
    }
    return JSON.parse(withoutTrailingCommas)
}

function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys)
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
}

/** One string per JSON value regardless of whitespace, comments or key order. */
export function canonicalJson(text) {
    if (text.trim() === '') return 'null'
    return JSON.stringify(sortKeys(parseJsonc(text)))
}

function normalizeText(text) {
    return text.replace(/\r\n/g, '\n').trimEnd()
}

/** Whether the Hub already holds the repository's section. */
export function sectionsEqual(format, localText, remoteText) {
    if (format === 'markdown' || format === 'javascript') return normalizeText(localText) === normalizeText(remoteText ?? '')
    const local = canonicalJson(localText)
    try {
        return local === canonicalJson(remoteText ?? '')
    } catch {
        return false
    }
}

// ─── Hub API ───────────────────────────────────────────────────────────────

export function collectionPath(kind) {
    switch (kind) {
        case 'connection':
            return `/sdk/apps/${APP_NAME}/connections`
        case 'webhook':
            return `/sdk/apps/${APP_NAME}/webhooks`
        case 'rpc':
        case 'module':
        case 'function':
            return `/sdk/apps/${APP_NAME}/${APP_VERSION}/${kind}s`
        default:
            throw new Error(`No collection for ${kind}`)
    }
}

/** Connections and webhooks live outside the app version; everything else under it. */
export function componentPath(kind, remoteName) {
    const name = encodeURIComponent(remoteName)
    switch (kind) {
        case 'app':
            return `/sdk/apps/${APP_NAME}/${APP_VERSION}`
        case 'connection':
            return `/sdk/apps/connections/${name}`
        case 'webhook':
            return `/sdk/apps/webhooks/${name}`
        default:
            return `${collectionPath(kind)}/${name}`
    }
}

export function sectionPath(kind, remoteName, section) {
    return `${componentPath(kind, remoteName)}/${section}`
}

const PUT_SECTIONS = ['base', 'readme', 'api', 'parameters', 'expect', 'interface', 'samples', 'attach', 'detach', 'scope', 'common', 'code']
const ALLOWED_WRITES = {
    // Create Connection / Webhook / RPC / Module / Function, and nothing else under POST
    // (publish, review, visibility, deprecation, clone, commit, test and uninstall are all POST).
    POST: /^\/sdk\/apps\/[^/]+(?:\/\d+)?\/(?:connections|webhooks|rpcs|modules|functions)$/,
    PATCH: /^\/sdk\/apps\/(?:connections|webhooks)\/[^/]+$|^\/sdk\/apps\/[^/]+\/\d+\/(?:rpcs|modules)\/[^/]+$/,
    PUT: new RegExp(`^/sdk/apps/.+/(?:${PUT_SECTIONS.join('|')})$`)
}

/** Refuses any call outside reading, creating components, patching them and setting sections. */
export function assertAllowedRequest(method, apiPath) {
    if (method === 'GET') return
    if (ALLOWED_WRITES[method]?.test(apiPath)) return
    throw new Error(`Refusing ${method} ${apiPath}: sync-hub only reads, creates components and sets sections`)
}

export class ApiError extends Error {
    constructor(method, apiPath, status, body) {
        super(`Make API error: ${method} ${apiPath} -> HTTP ${status}\n${body}`)
        this.apiPath = apiPath
    }
}

function redact(text, secrets) {
    return secrets.reduce((result, secret) => result.split(secret).join('[redacted]'), text)
}

function createClient({ token, secrets }) {
    async function request(method, apiPath, { body, contentType } = {}) {
        assertAllowedRequest(method, apiPath)
        const headers = { Authorization: `Token ${token}`, Accept: 'application/json, text/markdown, application/javascript, */*' }
        if (body !== undefined) headers['Content-Type'] = contentType
        for (let attempt = 1; ; attempt++) {
            const response = await fetch(`${API_BASE}${apiPath}`, { method, headers, body })
            const text = await response.text()
            if (response.status === 429 && attempt < 4) {
                const seconds = Number(response.headers.get('retry-after')) || 20
                console.error(`  rate limited on ${method} ${apiPath}, retrying in ${seconds}s`)
                await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
                continue
            }
            if (!response.ok) throw new ApiError(method, apiPath, response.status, redact(text, secrets))
            return text
        }
    }
    return {
        request,
        getJson: async (apiPath) => {
            const text = await request('GET', apiPath)
            return text.trim() === '' ? null : parseJsonc(text)
        }
    }
}

function pickList(kind, response) {
    for (const key of LIST_KEYS[kind]) {
        if (Array.isArray(response?.[key])) return response[key]
    }
    throw new Error(`Unexpected ${kind} list response, keys: ${Object.keys(response ?? {}).join(', ')}`)
}

export async function readHubLists(client, mode) {
    const lists = {}
    for (const kind of ['connection', 'webhook', 'rpc', 'module']) {
        lists[kind] = pickList(kind, await client.getJson(collectionPath(kind)))
    }
    lists.function = mode === 'dynamic' ? pickList('function', await client.getJson(collectionPath('function'))) : []
    for (const kind of ['connection', 'webhook']) {
        lists[kind] = lists[kind].filter((item) => item.app_version === undefined || Number(item.app_version) === APP_VERSION)
    }
    return lists
}

/**
 * The Hub name of a repository component, or null when the Hub has none. Make names
 * connections and webhooks itself, so those match by label (or `--map`); RPCs, modules
 * and functions keep the repository name.
 */
export function resolveRemoteName(component, hubItems, map = {}) {
    if (component.kind !== 'connection' && component.kind !== 'webhook') {
        return hubItems.some((item) => item.name === component.name) ? component.name : null
    }
    const pinned = map[component.name]
    if (pinned) {
        if (!hubItems.some((item) => item.name === pinned)) throw new Error(`--map ${component.name}=${pinned}: the Hub has no ${component.kind} named ${pinned}`)
        return pinned
    }
    // Case-insensitive: labels moved to sentence case for Make review ("Submission Webhook" -> "Submission webhook").
    const wanted = component.metadata.label.trim().toLowerCase()
    const matches = hubItems.filter((item) => item.label?.trim().toLowerCase() === wanted)
    if (matches.length > 1) {
        throw new Error(`Several Hub ${component.kind}s are labelled "${component.metadata.label}" (${matches.map((item) => item.name).join(', ')}); pick one with --map ${component.name}=<hub name>`)
    }
    if (matches.length === 1) return matches[0].name
    // The app has one connection by design: an unmatched label is a rename, not a second connection.
    if (component.kind === 'connection' && hubItems.length === 1) return hubItems[0].name
    return null
}

/** Create body per kind, `ref` resolving a repository reference (`connection:formbase`) to its Hub name. */
export function createBody(component, ref) {
    const { metadata } = component
    switch (component.kind) {
        case 'connection': {
            const type = CONNECTION_TYPES[metadata.type]
            if (!type) throw new Error(`connection ${component.name} has unsupported type ${metadata.type}`)
            return { type, label: metadata.label }
        }
        case 'webhook':
            return { type: metadata.type, label: metadata.label, connection: ref(metadata.connection && `connection:${metadata.connection}`) }
        case 'rpc':
            return { name: metadata.name, label: metadata.label, connection: ref(metadata.connection && `connection:${metadata.connection}`) }
        case 'function':
            return { name: component.name }
        case 'module': {
            const body = {
                name: metadata.name,
                typeId: MODULE_TYPES[metadata.type].typeId,
                label: metadata.label,
                description: metadata.description,
                moduleInitMode: 'blank',
                connection: ref(metadata.connection && `connection:${metadata.connection}`)
            }
            if (metadata.type === 'instant_trigger') body.webhook = ref(`webhook:${metadata.webhook}`)
            if (metadata.type === 'action') body.crud = metadata.actionType
            // Required by the API for universal modules (VS Code extension, create-remote-component.ts).
            if (metadata.type === 'universal') body.subtype = 'Universal'
            return body
        }
        default:
            throw new Error(`Cannot create ${component.kind}`)
    }
}

/** General settings the Hub should hold, as literal values or `{ ref }` to another component. */
function expectedSettings(component) {
    const { metadata } = component
    const connection = { ref: metadata.connection ? `connection:${metadata.connection}` : null }
    switch (component.kind) {
        case 'connection':
            return { label: metadata.label }
        case 'webhook':
        case 'rpc':
            return { label: metadata.label, connection }
        case 'module': {
            const settings = { label: metadata.label, description: metadata.description, connection }
            if (metadata.type === 'instant_trigger') settings.webhook = { ref: `webhook:${metadata.webhook}` }
            if (metadata.type === 'action') settings.crud = metadata.actionType
            return settings
        }
        default:
            return {}
    }
}

function blankToNull(value) {
    return value === undefined || value === '' ? null : value
}

/** Reads every section of every matched component and decides what to create, patch and push. */
export async function buildPlan(client, local, lists, { map = {}, secret = null, root }) {
    const names = new Map()
    const entries = []
    const warnings = []
    const skipped = [...local.skipped]
    let inSync = 0

    for (const component of local.components) {
        const remoteName = component.kind === 'app' ? APP_NAME : resolveRemoteName(component, lists[component.kind], map)
        const entry = { component, remoteName, create: remoteName === null, patch: null, puts: [] }
        entries.push(entry)

        const syncedSections = component.sections.filter((section) => {
            if (section.section !== 'common' || secret) return true
            skipped.push({ kind: component.kind, name: `${component.name} common`, reason: 'MAKE_OAUTH_CLIENT_SECRET is not set, so Common data is left as it is' })
            return false
        })

        if (entry.create) {
            entry.puts = syncedSections.map((section) => ({ section, reason: 'new' }))
            continue
        }
        names.set(component.key, remoteName)

        if (component.kind !== 'app' && component.kind !== 'function') {
            const detail = (await client.getJson(componentPath(component.kind, remoteName)))?.[DETAIL_KEYS[component.kind]] ?? {}
            const patch = {}
            for (const [field, expected] of Object.entries(expectedSettings(component))) {
                const expectedValue = typeof expected === 'object' && expected !== null ? (expected.ref ? names.get(expected.ref) : null) : expected
                if (blankToNull(detail[field]) !== blankToNull(expectedValue)) patch[field] = expected
            }
            if (Object.keys(patch).length > 0) entry.patch = patch
            if (component.kind === 'module' && detail.typeId !== undefined && detail.typeId !== component.typeId) {
                warnings.push(`module ${component.name}: the Hub has type ${detail.typeId}, the repository ${component.typeId} (${component.metadata.type}); change it in the Hub by hand`)
            }
            const expectedType = component.kind === 'connection' ? CONNECTION_TYPES[component.metadata.type] : component.metadata.type
            if ((component.kind === 'connection' || component.kind === 'webhook') && detail.type && detail.type !== expectedType) {
                warnings.push(`${component.kind} ${component.name} [${remoteName}]: the Hub type is ${detail.type}, the repository expects ${expectedType}`)
            }
        }

        for (const section of syncedSections) {
            const remoteText = await client.request('GET', sectionPath(component.kind, remoteName, section.section))
            const localText = sectionBody(root, section, secret)
            if (sectionsEqual(section.format, localText, remoteText)) inSync++
            else entry.puts.push({ section, reason: 'differs' })
        }
    }

    const remoteNamesOf = (kind) => new Set([...names].filter(([key]) => key.startsWith(`${kind}:`)).map(([, name]) => name))
    const known = {
        connection: remoteNamesOf('connection'),
        webhook: remoteNamesOf('webhook'),
        rpc: new Set([...local.components, ...local.skipped].filter((item) => item.kind === 'rpc').map((item) => item.name)),
        module: new Set(local.components.filter((item) => item.kind === 'module').map((item) => item.name)),
        function: new Set(local.functionNames)
    }
    const hubOnly = []
    for (const [kind, items] of Object.entries(lists)) {
        for (const item of items) {
            if (!known[kind].has(item.name)) hubOnly.push({ kind, name: item.name, label: item.label })
        }
    }

    return { entries, names, warnings, skipped, hubOnly, inSync, notSynced: local.notSynced }
}

// ─── Output ────────────────────────────────────────────────────────────────

function describe(component, remoteName) {
    if (component.kind === 'app') return 'app'
    const hubName = remoteName && remoteName !== component.name ? ` [${remoteName}]` : ''
    return `${component.kind} ${component.name}${hubName}`
}

function sectionLabel(section) {
    return section.staticTwin ? `${section.section} (${path.basename(section.file)})` : section.section
}

function printPlan(plan, { mode, apply }) {
    const lines = []
    const modeNote = mode === 'static' ? 'static mode, IML functions locked (formbase#207)' : 'dynamic mode'
    lines.push(`${APP_NAME} v${APP_VERSION} on ${new URL(API_BASE).host}, ${modeNote}${apply ? '' : ', dry run'}`)

    const creates = plan.entries.filter((entry) => entry.create)
    if (creates.length > 0) {
        lines.push('', `Create ${creates.length} component${creates.length === 1 ? '' : 's'}:`)
        for (const { component } of creates) {
            const type = component.kind === 'module' ? ` (${MODULE_TYPES[component.metadata.type].label})` : ''
            const label = component.metadata?.label ? ` "${component.metadata.label}"` : ''
            lines.push(`  + ${component.kind} ${component.name}${type}${label}`)
        }
    }

    const patches = plan.entries.filter((entry) => entry.patch)
    if (patches.length > 0) {
        lines.push('', `Update general settings of ${patches.length} component${patches.length === 1 ? '' : 's'}:`)
        for (const entry of patches) lines.push(`  ~ ${describe(entry.component, entry.remoteName)}: ${Object.keys(entry.patch).join(', ')}`)
    }

    const puts = plan.entries.filter((entry) => entry.puts.length > 0)
    const putCount = puts.reduce((total, entry) => total + entry.puts.length, 0)
    if (putCount > 0) {
        lines.push('', `Push ${putCount} section${putCount === 1 ? '' : 's'}:`)
        for (const entry of puts) {
            const marker = entry.create ? '+' : '~'
            lines.push(`  ${marker} ${describe(entry.component, entry.remoteName)}: ${entry.puts.map(({ section }) => sectionLabel(section)).join(', ')}`)
        }
    }
    lines.push('', `Already in sync: ${plan.inSync} section${plan.inSync === 1 ? '' : 's'}`)

    if (plan.skipped.length > 0) {
        lines.push('', 'Not pushed:')
        for (const item of plan.skipped) lines.push(`  - ${item.kind} ${item.name}: ${item.reason}`)
    }
    if (plan.notSynced.length > 0) {
        lines.push('', 'Repository files with no Hub section:')
        for (const item of plan.notSynced) lines.push(`  - ${item.file}: ${item.reason}`)
    }
    if (plan.hubOnly.length > 0) {
        lines.push('', 'Only in the Hub (reported, never deleted):')
        for (const item of plan.hubOnly) lines.push(`  ? ${item.kind} ${item.name}${item.label ? ` "${item.label}"` : ''}`)
    }
    if (plan.warnings.length > 0) {
        lines.push('', 'Warnings:')
        for (const warning of plan.warnings) lines.push(`  ! ${warning}`)
    }

    const pending = creates.length + patches.length + putCount
    if (!apply) lines.push('', pending === 0 ? 'Nothing to push.' : 'Dry run: nothing changed. Run `npm run sync:hub -- --apply` to push.')
    console.log(lines.join('\n'))
    return pending
}

// ─── Apply ─────────────────────────────────────────────────────────────────

/** Executes a plan in component order, so a connection or webhook exists before anything names it. */
export async function applyPlan(client, plan, { root, secret = null, log = console.log }) {
    const names = new Map(plan.names)
    const ref = (key) => {
        if (!key) return null
        const name = names.get(key)
        if (!name) throw new Error(`No Hub name for ${key}; it must be created first`)
        return name
    }
    const resolve = (fields) =>
        Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, typeof value === 'object' && value !== null ? ref(value.ref) : value]))

    log('')
    for (const entry of plan.entries) {
        const { component } = entry
        let remoteName = entry.remoteName
        if (entry.create) {
            const response = parseJsonc(
                await client.request('POST', collectionPath(component.kind), {
                    body: JSON.stringify(createBody(component, ref)),
                    contentType: 'application/json'
                })
            )
            const created = response?.[DETAIL_KEYS[component.kind]]?.name
            // Make names connections and webhooks; the other kinds keep the name sent.
            remoteName = component.kind === 'connection' || component.kind === 'webhook' ? created : component.name
            if (!remoteName) throw new Error(`Created ${component.kind} ${component.name}, but the response names no ${DETAIL_KEYS[component.kind]}`)
            names.set(component.key, remoteName)
            log(`created ${describe(component, remoteName)}`)
        }
        if (entry.patch) {
            await client.request('PATCH', componentPath(component.kind, remoteName), {
                body: JSON.stringify(resolve(entry.patch)),
                contentType: 'application/json'
            })
            log(`updated ${describe(component, remoteName)}: ${Object.keys(entry.patch).join(', ')}`)
        }
        for (const { section } of entry.puts) {
            await client.request('PUT', sectionPath(component.kind, remoteName, section.section), {
                body: sectionBody(root, section, secret),
                contentType: CONTENT_TYPES[section.format]
            })
            log(`pushed ${describe(component, remoteName)} ${sectionLabel(section)}`)
        }
    }
    log('\nDone. Test in Make before publishing; this script never publishes.')
}

// ─── CLI ───────────────────────────────────────────────────────────────────

const USAGE = `Usage: npm run sync:hub -- [--dry-run | --apply] [--static | --dynamic] [--map <repo name>=<hub name>]

  --dry-run   (default) read the Hub and print what would change
  --apply     create missing components and push differing sections
  --static    (default) push *.static.imljson twins; skip IML functions and the RPCs calling them
  --dynamic   push IML functions and the function-backed files
  --map       pin a repository connection or webhook to a Hub name, e.g. --map submission_webhook=formbase-f1d7bp2

Reads MAKE_API_TOKEN (scopes sdk-apps:read, sdk-apps:write) and optional MAKE_OAUTH_CLIENT_SECRET
from the environment or ${ENV_FILE}.`

export function parseArgs(argv) {
    const flags = new Set()
    const map = {}
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index]
        if (arg === '--map' || arg.startsWith('--map=')) {
            const value = arg === '--map' ? argv[++index] : arg.slice('--map='.length)
            const separator = value?.indexOf('=') ?? -1
            if (separator <= 0 || separator === value.length - 1) throw new Error(`--map takes <repo name>=<hub name>, got ${value ?? 'nothing'}`)
            map[value.slice(0, separator)] = value.slice(separator + 1)
            continue
        }
        if (!['--dry-run', '--apply', '--static', '--dynamic', '--help', '-h'].includes(arg)) throw new Error(`Unknown option ${arg}\n\n${USAGE}`)
        flags.add(arg)
    }
    if (flags.has('--apply') && flags.has('--dry-run')) throw new Error('Pick one of --dry-run and --apply')
    if (flags.has('--static') && flags.has('--dynamic')) throw new Error('Pick one of --static and --dynamic')
    return {
        help: flags.has('--help') || flags.has('-h'),
        apply: flags.has('--apply'),
        mode: flags.has('--dynamic') ? 'dynamic' : 'static',
        map
    }
}

/** `KEY=value` lines; blank lines, `#` comments and an `export ` prefix are ignored, quotes stripped. */
export function parseEnvFile(text) {
    const values = {}
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (line === '' || line.startsWith('#')) continue
        const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
        if (!match) continue
        let value = match[2].trim()
        if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1)
        values[match[1]] = value
    }
    return values
}

function loadSettings() {
    let file = {}
    try {
        file = parseEnvFile(fs.readFileSync(ENV_FILE, 'utf8'))
    } catch (error) {
        if (error.code !== 'ENOENT') throw error
    }
    return {
        token: process.env.MAKE_API_TOKEN || file.MAKE_API_TOKEN || null,
        secret: process.env.MAKE_OAUTH_CLIENT_SECRET || file.MAKE_OAUTH_CLIENT_SECRET || null
    }
}

async function main(argv) {
    const options = parseArgs(argv)
    if (options.help) {
        console.log(USAGE)
        return
    }
    const { token, secret } = loadSettings()
    if (!token) throw new Error(`MAKE_API_TOKEN is not set. Export it or add MAKE_API_TOKEN=... to ${ENV_FILE}.`)

    const local = collectLocalApp(ROOT, { mode: options.mode })
    const client = createClient({ token, secrets: [token, secret].filter(Boolean) })
    const lists = await readHubLists(client, options.mode)
    const plan = await buildPlan(client, local, lists, { map: options.map, secret, root: ROOT })
    plan.warnings.push(...danglingReferences(ROOT, local))
    const pending = printPlan(plan, options)
    if (options.apply && pending > 0) await applyPlan(client, plan, { root: ROOT, secret })
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(`\n${error.message}`)
        if (error instanceof ApiError && error.apiPath.includes('/functions')) {
            console.error('\nThe functions endpoint refused the call: the API does not bypass the Hub lock on IML functions (formbase#207). Run without --dynamic.')
        }
        process.exitCode = 1
    })
}
