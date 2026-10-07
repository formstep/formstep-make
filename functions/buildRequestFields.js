/**
 * Builds the Create a request inputs that depend on the form, from `fields.list`.
 *
 * `requests.create` addresses every question by field key, so the module cannot
 * know its inputs until a form is picked. This function turns the published
 * field list into three mappable parameters: a `prefill` collection with one
 * input per prefillable field, a `context` collection with one input per
 * hidden field, and a multi-select of prefillable keys for `readonly`. A
 * collection whose form has no such field is left out.
 *
 * Called from `rpcs/get_request_fields/api.imljson` as
 * `{{buildRequestFields(body.data.items)}}`, the nested RPC of the form
 * picker. With no items (a form that is not published yet) it returns nothing:
 * `requests.create` refuses an unpublished form anyway.
 */
function buildRequestFields(items) {
    // Formstep question type -> Make parameter type for a single-valued prefill.
    // Anything unlisted falls back to `text`.
    var TYPE_BY_INPUT_TYPE = {
        text: 'text',
        textarea: 'text',
        email: 'email',
        phone: 'text',
        url: 'url',
        number: 'number',
        rating: 'number',
        scale: 'number',
        switch: 'boolean'
    }
    // Value formats the API expects that Make has no native input for.
    var HELP_BY_INPUT_TYPE = {
        date: 'YYYY-MM-DD, for example 2026-03-04.',
        time: 'HH:MM, for example 09:30.'
    }
    // Choice questions: one option key, or a list of option keys.
    var SINGLE_OPTION_TYPES = { radio: true, select: true }
    var MULTI_OPTION_TYPES = { checkbox: true, 'picture-choice': true, ranking: true }

    function label(field) {
        return field.title || field.key
    }

    function optionList(options) {
        var list = []
        for (var i = 0; i < (options || []).length; i++) {
            list.push({ label: options[i].label || options[i].key, value: options[i].key })
        }
        return list
    }

    // The input for one prefillable field's value.
    function prefillField(field) {
        var base = { name: field.key, label: label(field), required: false }
        if (SINGLE_OPTION_TYPES[field.type]) {
            base.type = 'select'
            base.options = optionList(field.options)
            return base
        }
        if (MULTI_OPTION_TYPES[field.type]) {
            base.type = 'select'
            base.multiple = true
            base.options = optionList(field.options)
            return base
        }
        if (field.type === 'matrix') {
            // A matrix answer is `{ row_key: column_key }`: one select per row.
            var rowSpec = []
            var columns = optionList(field.columns)
            for (var r = 0; r < (field.rows || []).length; r++) {
                var row = field.rows[r]
                rowSpec.push({ name: row.key, type: 'select', label: row.label || row.key, required: false, options: columns })
            }
            base.type = 'collection'
            base.spec = rowSpec
            return base
        }
        base.type = TYPE_BY_INPUT_TYPE[field.type] || 'text'
        if (HELP_BY_INPUT_TYPE[field.type]) base.help = HELP_BY_INPUT_TYPE[field.type]
        return base
    }

    var list = Array.isArray(items) ? items : []
    var prefillSpec = []
    var contextSpec = []
    var readonlyOptions = []

    for (var index = 0; index < list.length; index++) {
        var item = list[index]
        if (!item || typeof item.key !== 'string') continue

        // A repeating group is prefilled as an array of rows, each row keyed by
        // member field key. The group has no title of its own, so its key
        // labels it.
        if (Array.isArray(item.members)) {
            var memberSpec = []
            for (var m = 0; m < item.members.length; m++) {
                var member = item.members[m]
                if (!member || typeof member.key !== 'string' || member.prefillable === false) continue
                memberSpec.push(prefillField(member))
            }
            if (memberSpec.length === 0) continue
            prefillSpec.push({ name: item.key, type: 'array', label: item.key, required: false, spec: memberSpec })
            readonlyOptions.push({ label: item.key, value: item.key })
            continue
        }

        if (item.context === true) {
            contextSpec.push({ name: item.key, type: 'text', label: label(item), required: false })
            continue
        }

        // Calculated fields and file, signature, payment, appointment and
        // documents questions cannot be sent.
        if (item.prefillable !== true) continue

        prefillSpec.push(prefillField(item))
        readonlyOptions.push({ label: label(item), value: item.key })
    }

    var fields = []
    if (prefillSpec.length > 0) {
        fields.push({
            name: 'prefill',
            type: 'collection',
            label: 'Prefill',
            help: 'Initial answers the recipient sees, one input per field key. A choice question takes the option key, a date YYYY-MM-DD, a repeating group one row per instance.',
            spec: prefillSpec
        })
    }
    if (contextSpec.length > 0) {
        fields.push({
            name: 'context',
            type: 'collection',
            label: 'Context',
            help: 'Values for the hidden fields of the form. The recipient never sees or edits them; they come back in the answers under the same field key.',
            spec: contextSpec
        })
    }
    if (readonlyOptions.length > 0) {
        fields.push({
            name: 'readonly',
            type: 'select',
            multiple: true,
            label: 'Read-only fields',
            help: 'Prefilled fields the recipient may see but not change. Every selected field must also be prefilled.',
            options: readonlyOptions
        })
    }
    return fields
}
