/**
 * Builds the Get a request output interface from `fields.list`.
 *
 * `requests.get` returns the request summary plus, once the request is
 * completed, the same `answers` and `display` maps a `request.completed` event
 * carries. The summary half is fixed; the per-form half comes from
 * `buildSubmissionInterface`, so a field key is mappable under the same pill
 * whether the answers arrive through Watch public link submissions, Watch requests or a
 * Get a request call.
 *
 * Called from `rpcs/get_request_interface/api.imljson` as
 * `{{buildRequestInterface(body.data.items)}}`. With no items (a form that is
 * not published yet) it returns the summary alone, so the module stays
 * mappable.
 */
function buildRequestInterface(items) {
    var submission = iml.buildSubmissionInterface(items)
    var submissionData = submission[submission.length - 1].spec
    function part(name) {
        for (var i = 0; i < submissionData.length; i++) {
            if (submissionData[i].name === name) return submissionData[i]
        }
        return undefined
    }

    return [
        { name: 'id', type: 'text', label: 'Request ID' },
        { name: 'status', type: 'text', label: 'Status', help: 'pending, completed, expired or canceled.' },
        { name: 'outcome', type: 'text', label: 'Outcome', help: 'The recipient\'s verdict from the decision question: approve, decline or changes. Empty when there is none.' },
        { name: 'url', type: 'url', label: 'Request link' },
        { name: 'workspaceId', type: 'text', label: 'Workspace ID' },
        { name: 'formId', type: 'text', label: 'Form ID' },
        { name: 'formSnapshotId', type: 'text', label: 'Published version ID' },
        { name: 'submissionId', type: 'text', label: 'Submission ID' },
        { name: 'createdVia', type: 'text', label: 'Created via' },
        { name: 'isTest', type: 'boolean', label: 'Test request' },
        { name: 'language', type: 'text', label: 'Language' },
        {
            name: 'recipient',
            type: 'collection',
            label: 'Recipient',
            spec: [
                { name: 'email', type: 'email', label: 'Recipient email' },
                { name: 'name', type: 'text', label: 'Recipient name' }
            ]
        },
        { name: 'externalId', type: 'text', label: 'External ID' },
        { name: 'metadata', type: 'any', label: 'Metadata' },
        { name: 'context', type: 'any', label: 'Context' },
        { name: 'prefill', type: 'any', label: 'Prefill' },
        { name: 'readonlyKeys', type: 'array', label: 'Read-only field keys', spec: { type: 'text' } },
        {
            name: 'documents',
            type: 'array',
            label: 'Documents',
            spec: {
                type: 'collection',
                spec: [
                    { name: 'field', type: 'text', label: 'Field key' },
                    { name: 'name', type: 'text', label: 'Name' },
                    { name: 'size', type: 'number', label: 'Size (bytes)' },
                    { name: 'contentType', type: 'text', label: 'Content type' }
                ]
            }
        },
        { name: 'delivery', type: 'text', label: 'Delivery' },
        { name: 'deliveryStatus', type: 'text', label: 'Delivery status' },
        { name: 'hasCallback', type: 'boolean', label: 'Has callback' },
        { name: 'callbackFailedAt', type: 'date', label: 'Callback failed at' },
        { name: 'expiresAt', type: 'date', label: 'Expires at' },
        { name: 'createdAt', type: 'date', label: 'Created at' },
        { name: 'updatedAt', type: 'date', label: 'Updated at' },
        { name: 'openedAt', type: 'date', label: 'Opened at' },
        { name: 'startedAt', type: 'date', label: 'Started at' },
        { name: 'lastActivityAt', type: 'date', label: 'Last activity at' },
        { name: 'completedAt', type: 'date', label: 'Completed at' },
        { name: 'expiredAt', type: 'date', label: 'Expired at' },
        { name: 'canceledAt', type: 'date', label: 'Canceled at' },
        { name: 'canceledBy', type: 'text', label: 'Canceled by' },
        { name: 'cancelReason', type: 'text', label: 'Cancel reason' },
        { name: 'dataPurgedAt', type: 'date', label: 'Data purged at' },
        { name: 'reminderStep', type: 'integer', label: 'Reminder step' },
        { name: 'remindersSent', type: 'integer', label: 'Reminders sent' },
        { name: 'reminderDueAt', type: 'date', label: 'Reminder due at' },
        part('answers'),
        part('display'),
        {
            name: 'timeline',
            type: 'array',
            label: 'Timeline',
            help: 'Oldest first: created, invitation, reminder, opened, started, completed, expired, canceled, callback.',
            spec: {
                type: 'collection',
                spec: [
                    { name: 'id', type: 'text', label: 'Entry ID' },
                    { name: 'at', type: 'date', label: 'At' },
                    { name: 'type', type: 'text', label: 'Entry type' },
                    { name: 'deliveryStatus', type: 'text', label: 'Delivery status' },
                    { name: 'attemptCount', type: 'integer', label: 'Attempt count' },
                    { name: 'eventType', type: 'text', label: 'Callback event type' },
                    { name: 'canceledBy', type: 'text', label: 'Canceled by' },
                    { name: 'detail', type: 'text', label: 'Detail' }
                ]
            }
        }
    ]
}
