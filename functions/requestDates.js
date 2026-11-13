/**
 * Turns the request's timestamps into ISO dates, so Make shows and compares them
 * as dates (the app review requires date-typed outputs).
 *
 * The JSON-RPC API returns a request's times as epoch milliseconds. Webhook
 * events already carry ISO strings, so only the request actions use this:
 * Create, Get, Cancel and Remind a request call it on `body.data`, Search
 * requests on each `item`.
 *
 * Only the request's own top-level `...At` fields and `timeline[].at` change.
 * Answers, display text, prefill, context and metadata stay as they are: a
 * field key may end in `At` and hold a number that is not a time.
 */
function requestDates(request) {
    if (request === null || typeof request !== 'object') return request
    var isTime = function (value) {
        return typeof value === 'number' && isFinite(value)
    }
    var out = {}
    for (var key in request) {
        if (!Object.prototype.hasOwnProperty.call(request, key)) continue
        var value = request[key]
        out[key] = /At$/.test(key) && isTime(value) ? new Date(value).toISOString() : value
    }
    if (Array.isArray(request.timeline)) {
        out.timeline = request.timeline.map(function (entry) {
            if (entry === null || typeof entry !== 'object' || !isTime(entry.at)) return entry
            var copy = {}
            for (var field in entry) {
                if (Object.prototype.hasOwnProperty.call(entry, field)) copy[field] = entry[field]
            }
            copy.at = new Date(entry.at).toISOString()
            return copy
        })
    }
    return out
}
