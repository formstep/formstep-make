/**
 * Turns the date-times inside booking and payment answers into dates, so Make
 * shows and compares them as dates (the app review requires parsed dates).
 *
 * `answers` is keyed by field key, so a booking or a payment sits under a key
 * only the form knows. This function therefore goes by shape: an answer that
 * is an object gets its `start`, `end`, `paidAt`, `refundedAt` and
 * `disputedAt` parsed, and only when the value is a full ISO 8601 date-time.
 * A repeating group is an array of rows keyed by member field key, and each
 * member is treated the same way.
 *
 * Everything else stays as it is. A date question answers `YYYY-MM-DD` and a
 * time question `HH:MM`; Make asks for those to stay text.
 *
 * Called by `eventDates` and `requestDates` through the `iml` namespace.
 */
function answerDates(answers) {
    var DATE_KEYS = ['start', 'end', 'paidAt', 'refundedAt', 'disputedAt']
    var ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    function withDates(answer) {
        if (!isObject(answer)) return answer
        var out = {}
        for (var key in answer) {
            if (Object.prototype.hasOwnProperty.call(answer, key)) out[key] = answer[key]
        }
        for (var i = 0; i < DATE_KEYS.length; i++) {
            var value = out[DATE_KEYS[i]]
            if (typeof value === 'string' && ISO_DATE_TIME.test(value)) out[DATE_KEYS[i]] = new Date(value)
        }
        return out
    }

    function rowWithDates(row) {
        if (!isObject(row)) return row
        var out = {}
        for (var member in row) {
            if (Object.prototype.hasOwnProperty.call(row, member)) out[member] = withDates(row[member])
        }
        return out
    }

    if (!isObject(answers)) return answers
    var parsed = {}
    for (var fieldKey in answers) {
        if (!Object.prototype.hasOwnProperty.call(answers, fieldKey)) continue
        var answer = answers[fieldKey]
        parsed[fieldKey] = Array.isArray(answer) ? answer.map(rowWithDates) : withDates(answer)
    }
    return parsed
}
