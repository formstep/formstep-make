/**
 * Builds the Watch public link submissions output interface from `fields.list`.
 *
 * Every event is the formbase envelope `{ id, type, createdAt, apiVersion,
 * test, data }`. The envelope half is fixed; the per-form half is not, so the
 * `data.answers` and `data.display` collections are filled from the published
 * field list of the selected form: one item per field key, labelled with the
 * question title a person recognises.
 *
 * Called from `rpcs/get_submission_interface/api.imljson` as
 * `{{buildSubmissionInterface(body.data.items)}}`. With no items (a form that
 * is not published yet) it returns the envelope alone, so the module stays
 * mappable.
 */
function buildSubmissionInterface(items) {
    // formbase question type -> Make interface type for a single-valued
    // answer. Anything unlisted stays `any`: the stored value keeps its own
    // JSON shape in data.answers.
    var TYPE_BY_INPUT_TYPE = {
        text: 'text',
        textarea: 'text',
        email: 'email',
        phone: 'text',
        url: 'url',
        number: 'number',
        rating: 'number',
        scale: 'number',
        switch: 'boolean',
        date: 'date',
        time: 'text',
        radio: 'text',
        select: 'text',
        signature: 'text',
        hidden: 'text'
    }
    // Choice questions whose answer is a list of option keys.
    var MULTI_OPTION_TYPES = { checkbox: true, 'picture-choice': true, ranking: true }
    // A booking and a payment answer are objects (formbase
    // docs/external-api.md § Events, "Bookings and payments"), so each
    // property is mappable on its own.
    var OBJECT_SPEC_BY_INPUT_TYPE = {
        'schedule-appointment': [
            { name: 'status', type: 'text', label: 'Status' },
            { name: 'start', type: 'date', label: 'Start' },
            { name: 'end', type: 'date', label: 'End' },
            { name: 'timeZone', type: 'text', label: 'Time zone' },
            {
                name: 'attendee',
                type: 'collection',
                label: 'Attendee',
                spec: [
                    { name: 'name', type: 'text', label: 'Name' },
                    { name: 'email', type: 'email', label: 'Email' }
                ]
            },
            { name: 'meetingUrl', type: 'url', label: 'Meeting URL' },
            { name: 'eventTitle', type: 'text', label: 'Event title' },
            { name: 'provider', type: 'text', label: 'Provider' },
            { name: 'providerBookingId', type: 'text', label: 'Provider booking ID' }
        ],
        payment: [
            { name: 'status', type: 'text', label: 'Status' },
            { name: 'amount', type: 'number', label: 'Amount' },
            { name: 'currency', type: 'text', label: 'Currency' },
            { name: 'amountRefunded', type: 'number', label: 'Amount refunded' },
            { name: 'receiptUrl', type: 'url', label: 'Receipt URL' },
            { name: 'paidAt', type: 'date', label: 'Paid at' },
            { name: 'refundedAt', type: 'date', label: 'Refunded at' },
            { name: 'disputedAt', type: 'date', label: 'Disputed at' },
            { name: 'provider', type: 'text', label: 'Provider' },
            { name: 'providerPaymentIntentId', type: 'text', label: 'Provider payment intent ID' }
        ]
    }

    function label(field) {
        return field.title || field.key
    }

    // The interface entry for one field's stored value.
    function answerField(field) {
        if (MULTI_OPTION_TYPES[field.type]) {
            return { name: field.key, type: 'array', label: label(field), spec: { type: 'text' } }
        }
        if (field.type === 'matrix' && Array.isArray(field.rows)) {
            // A matrix answer is `{ row_key: column_key }`.
            var rowSpec = []
            for (var r = 0; r < field.rows.length; r++) {
                rowSpec.push({ name: field.rows[r].key, type: 'text', label: field.rows[r].label || field.rows[r].key })
            }
            return { name: field.key, type: 'collection', label: label(field), spec: rowSpec }
        }
        if (OBJECT_SPEC_BY_INPUT_TYPE[field.type]) {
            return { name: field.key, type: 'collection', label: label(field), spec: OBJECT_SPEC_BY_INPUT_TYPE[field.type] }
        }
        return { name: field.key, type: TYPE_BY_INPUT_TYPE[field.type] || 'any', label: label(field) }
    }

    var list = Array.isArray(items) ? items : []
    var answerSpec = []
    var displaySpec = []

    for (var index = 0; index < list.length; index++) {
        var item = list[index]
        if (!item || typeof item.key !== 'string') continue

        // A repeating group is an array of rows, each row keyed by member field
        // key. The group has no title of its own, so its key labels it.
        if (Array.isArray(item.members)) {
            var memberSpec = []
            for (var m = 0; m < item.members.length; m++) {
                var member = item.members[m]
                if (!member || typeof member.key !== 'string') continue
                memberSpec.push(answerField(member))
            }
            answerSpec.push({ name: item.key, type: 'array', label: item.key, spec: { type: 'collection', spec: memberSpec } })
            displaySpec.push({ name: item.key, type: 'text', label: item.key + ' (display)' })
            continue
        }

        answerSpec.push(answerField(item))
        displaySpec.push({ name: item.key, type: 'text', label: label(item) + ' (display)' })
    }

    return [
        { name: 'id', type: 'text', label: 'Event ID' },
        { name: 'type', type: 'text', label: 'Event type' },
        { name: 'createdAt', type: 'date', label: 'Event timestamp' },
        { name: 'apiVersion', type: 'text', label: 'API version' },
        { name: 'test', type: 'boolean', label: 'Test event' },
        {
            name: 'data',
            type: 'collection',
            label: 'Data',
            spec: [
                {
                    name: 'form',
                    type: 'collection',
                    label: 'Form',
                    spec: [
                        { name: 'id', type: 'text', label: 'Form ID' },
                        { name: 'name', type: 'text', label: 'Form name' },
                        { name: 'snapshotId', type: 'text', label: 'Published version ID' }
                    ]
                },
                {
                    name: 'submission',
                    type: 'collection',
                    label: 'Submission',
                    spec: [
                        { name: 'id', type: 'text', label: 'Submission ID' },
                        { name: 'respondentEmail', type: 'email', label: 'Respondent email' },
                        { name: 'submittedAt', type: 'date', label: 'Submitted at' },
                        { name: 'updatedAt', type: 'date', label: 'Last edited at' },
                        { name: 'editCount', type: 'uinteger', label: 'Edit count' },
                        { name: 'pdfUrl', type: 'url', label: 'Submission PDF link' },
                        { name: 'language', type: 'text', label: 'Submission language' }
                    ]
                },
                {
                    name: 'answers',
                    type: 'collection',
                    label: 'Answers',
                    help: 'Every answer keyed by field key. A choice answer is the option key; a repeating group is an array of rows keyed by member field key; a booking or a payment is an object.',
                    spec: answerSpec
                },
                {
                    name: 'display',
                    type: 'collection',
                    label: 'Answers (display)',
                    help: 'Human-readable text for every answer, under the same keys as Answers.',
                    spec: displaySpec
                }
            ]
        }
    ]
}
