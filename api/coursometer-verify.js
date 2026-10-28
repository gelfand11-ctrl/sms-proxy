function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function normalizeIsraeliMobile(input) {
    if (!input) return null
    let d = String(input).replace(/\D/g, '')
    if (d.startsWith('00972')) d = d.slice(5)
    else if (d.startsWith('972')) d = d.slice(3)
    if (d.startsWith('0')) d = d.slice(1)
    if (!/^5\d{8}$/.test(d)) return null
    return '+972' + d
}

function toText(value) {
    if (value === null || value === undefined) return ''
    if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
}

function findAnswer(answers, keyword) {
    if (!answers || typeof answers !== 'object') return ''
    const key = Object.keys(answers).find((k) => k.includes(keyword))
    return key ? toText(answers[key]) : ''
}

async function sendWhatsApp({ accountSid, authToken, from, templateSid, to, firstName }) {
    if (!from || !templateSid) {
        console.log('Coursometer WhatsApp: missing env variables, skipping')
        return false
    }
    try {
        const response = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
            {
                method: 'POST',
                headers: {
                    Authorization:
                        'Basic ' +
                        Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    From: from,
                    To: 'whatsapp:' + to,
                    ContentSid: templateSid,
                    ContentVariables: JSON.stringify({ 1: firstName || 'שלום' }),
                }).toString(),
            }
        )
        const data = await response.json()
        if (!response.ok) {
            console.log('Coursometer WhatsApp: Twilio error', data.code, data.message)
            return false
        }
        return true
    } catch (err) {
        console.log('Coursometer WhatsApp: exception', err.message)
        return false
    }
}

export default async function handler(req, res) {
    setCors(res)
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') {
        return res.status(405).json({ valid: false, error: 'method_not_allowed' })
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    const serviceSid = process.env.TWILIO_SERVICE_SID_COURSOMETER
    const zapierHook = process.env.ZAPIER_HOOK_COURSOMETER
    const waFrom = process.env.TWILIO_WA_FROM_COURSOMETER
    const waTemplate = process.env.TWILIO_WA_TEMPLATE_COURSOMETER

    if (!accountSid || !authToken || !serviceSid) {
        console.log('Coursometer verify: missing env variables')
        return res.status(500).json({ valid: false, error: 'server_config' })
    }

    const body = req.body || {}
    const phone = normalizeIsraeliMobile(body.phone)
    const code = String(body.code || '').replace(/\D/g, '')
    const answers = body.answers || {}
    const attribution = body.attribution || {}

    if (!phone || !code) {
        return res.status(400).json({ valid: false, error: 'missing_fields' })
    }

    let valid = false
    try {
        const response = await fetch(
            `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`,
            {
                method: 'POST',
                headers: {
                    Authorization:
                        'Basic ' +
                        Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({ To: phone, Code: code }).toString(),
            }
        )
        const data = await response.json()

        if (!response.ok) {
            console.log('Coursometer verify: Twilio error', data.code, data.message)
            const error = data.code === 20404 ? 'expired' : 'verify_failed'
            return res.status(200).json({ valid: false, error })
        }

        valid = data.status === 'approved'
    } catch (err) {
        console.log('Coursometer verify: exception', err.message)
        return res.status(500).json({ valid: false, error: 'server_error' })
    }

    if (!valid) {
        return res.status(200).json({ valid: false, error: 'wrong_code' })
    }

    const examDate = findAnswer(answers, 'להיבחן')
    const lowIntent =
        examDate.includes('מאוחר') || examDate.includes('לא החלטתי')
    const intent = lowIntent ? 'low' : 'high'

    const name = findAnswer(answers, 'שם מלא')
    const firstName = name.trim().split(/\s+/)[0] || ''

    const whatsappSent = await sendWhatsApp({
        accountSid,
        authToken,
        from: waFrom,
        templateSid: waTemplate,
        to: phone,
        firstName,
    })

    const lead = {
        phone,
        phone_local: '0' + phone.slice(4),
        name,
        intent,
        first_time: findAnswer(answers, 'הפעם הראשונה'),
        previous_score: findAnswer(answers, 'הציון הקודם'),
        exam_date: examDate,
        study_mode: findAnswer(answers, 'ללמוד'),
        area: findAnswer(answers, 'אזור'),
        current_status: findAnswer(answers, 'עושה כרגע'),
        marketing_consent: findAnswer(answers, 'דיוור') ? 'כן' : 'לא',
        utm_source: toText(attribution.utm_source),
        utm_medium: toText(attribution.utm_medium),
        utm_campaign: toText(attribution.utm_campaign),
        utm_content: toText(attribution.utm_content),
        utm_term: toText(attribution.utm_term),
        gclid: toText(attribution.gclid),
        fbclid: toText(attribution.fbclid),
        ttclid: toText(attribution.ttclid),
        platform: toText(body.platform),
        event_id: toText(body.eventId),
        whatsapp_sent: whatsappSent ? 'true' : 'false',
        submitted_at: new Date().toISOString(),
    }

    let summary = `ליד חדש מאומת מקורסומטר\n`
    summary += `סטטוס: ${intent === 'high' ? 'ליד חם' : 'מועד רחוק'}\n`
    summary += `שם: ${lead.name}\nטלפון: ${lead.phone_local}\n\n`
    Object.keys(answers).forEach((key) => {
        summary += `${key}\n← ${toText(answers[key])}\n\n`
    })
    lead.summary = summary

    if (zapierHook) {
        try {
            await fetch(zapierHook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(lead),
            })
        } catch (err) {
            console.log('Coursometer verify: Zapier error', err.message)
        }
    } else {
        console.log('Coursometer verify: ZAPIER_HOOK_COURSOMETER not set, skipping')
    }

    return res.status(200).json({ valid: true, intent })
}
