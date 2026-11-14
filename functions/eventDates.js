/**
 * Turns the date-times of a Formstep event into dates, so Make shows and
 * compares them as dates (the app review requires parsed dates).
 *
 * Every event is the envelope `{ id, type, createdAt, apiVersion, test, data }`
 * and carries its times as ISO 8601 strings. Parsed here: the envelope's
 * `createdAt`, the request's `createdAt`, `completedAt`, `expiredAt` and
 * `canceledAt`, the submission's `submittedAt` and `updatedAt`, and the
 * booking and payment times inside `data.answers` (`answerDates`).
 * `data.display` is readable text and stays as it is.
 *
 * Called from both webhooks' `api.imljson` as `{{eventDates(body)}}`.
 */
function eventDates(event) {
    var ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    function withDates(object, keys) {
        if (!isObject(object)) return object
        var out = {}
        for (var key in object) {
            if (Object.prototype.hasOwnProperty.call(object, key)) out[key] = object[key]
        }
        for (var i = 0; i < keys.length; i++) {
            var value = out[keys[i]]
            if (typeof value === 'string' && ISO_DATE_TIME.test(value)) out[keys[i]] = new Date(value)
        }
        return out
    }

    if (!isObject(event)) return event
    var out = withDates(event, ['createdAt'])
    if (!isObject(event.data)) return out

    var data = withDates(event.data, [])
    if (isObject(data.request)) data.request = withDates(data.request, ['createdAt', 'completedAt', 'expiredAt', 'canceledAt'])
    if (isObject(data.submission)) data.submission = withDates(data.submission, ['submittedAt', 'updatedAt'])
    if (isObject(data.answers)) data.answers = iml.answerDates(data.answers)
    out.data = data
    return out
}
