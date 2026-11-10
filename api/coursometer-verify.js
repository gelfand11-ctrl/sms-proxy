import nodemailer from 'nodemailer'

const LOW_PACKAGE_THRESHOLD = 8

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

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/* ---------------- WhatsApp ---------------- */

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

/* ---------------- Airtable ---------------- */

function airtable() {
    const token = process.env.AIRTABLE_TOKEN_COURSOMETER
    const baseId = process.env.AIRTABLE_BASE_ID_COURSOMETER
    if (!token || !baseId) throw new Error('Airtable env variables missing')

    async function call(path, options = {}) {
        const res = await fetch(`https://api.airtable.com/v0/${baseId}/${path}`, {
            ...options,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
            throw new Error(`Airtable ${res.status}: ${JSON.stringify(data.error || data)}`)
        }
        return data
    }

    return {
        async findOne(table, { formula, view }) {
            const params = new URLSearchParams({ maxRecords: '1' })
            if (formula) params.set('filterByFormula', formula)
            if (view) params.set('view', view)
            const data = await call(`${encodeURIComponent(table)}?${params.toString()}`)
            return data.records && data.records.length ? data.records[0] : null
        },
        async create(table, fields) {
            return call(encodeURIComponent(table), {
                method: 'POST',
                body: JSON.stringify({ records: [{ fields }], typecast: true }),
            }).then((d) => d.records[0])
        },
        async update(table, id, fields) {
            return call(`${encodeURIComponent(table)}/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ fields, typecast: true }),
            })
        },
    }
}

/* ---------------- Email ---------------- */

function mailer() {
    const user = process.env.GMAIL_USER_COURSOMETER
    const pass = process.env.GMAIL_APP_PASSWORD_COURSOMETER
    if (!user || !pass) throw new Error('Gmail env variables missing')
    const transport = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
    })
    return {
        admin: user,
        async send({ to, subject, html }) {
            await transport.sendMail({
                from: `"Coursometer" <${user}>`,
                to,
                subject,
                html,
            })
        },
    }
}

function leadDetailsHtml(lead) {
    const row = (label, value) =>
        value ? `<b>${label}:</b> ${escapeHtml(value)}<br>` : ''
    return (
        row('שם', lead.name) +
        row('טלפון', lead.phone_local) +
        row('מועד בחינה', lead.exam_date) +
        row('פעם ראשונה או שיפור', lead.first_time) +
        row('ציון קודם', lead.previous_score) +
        row('ציון יעד', lead.target_score) +
        row('אזור', lead.area) +
        row('מה עושה כרגע', lead.current_status)
    )
}

function clientEmailHtml(lead) {
    return `<div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.7;">
<h2 style="color:#1F6BFF;">ליד חדש מקורסומטר</h2>
<p>${leadDetailsHtml(lead)}</p>
<p style="color:#64748B; font-size:13px;">הטלפון אומת בקוד SMS. מומלץ לחזור לליד בהקדם האפשרי.</p>
</div>`
}

function alertEmailHtml(title, text, lead) {
    return `<div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.7;">
<h2 style="color:#DC2626;">${escapeHtml(title)}</h2>
<p>${escapeHtml(text)}</p>
<p>${leadDetailsHtml(lead)}<b>סיווג:</b> ${escapeHtml(lead.intent)}</p>
</div>`
}

function lowPackageEmailHtml(clientName, remaining, packageSize) {
    return `<div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.7;">
<h2 style="color:#D97706;">החבילה של ${escapeHtml(clientName)} מתקרבת לסיום</h2>
<p>נשארו <b>${escapeHtml(remaining)}</b> לידים מתוך חבילה של ${escapeHtml(packageSize)}.</p>
<p>כדאי לפנות ללקוח לגבי המשך או חבילה חדשה, לפני שהלידים נעצרים.</p>
</div>`
}

/* ---------------- Lead processing ---------------- */

async function processLead(lead) {
    const db = airtable()
    const mail = mailer()

    // 1. Duplicate check: same phone in the last 90 days
    const duplicate = await db.findOne('Leads', {
        formula: `AND({Phone}='${lead.phone}', IS_AFTER({Submitted At}, DATEADD(NOW(), -90, 'days')))`,
    })
    if (duplicate) {
        console.log('Coursometer: duplicate lead, skipping', lead.phone)
        return { status: 'duplicate' }
    }

    // 2. Save the lead
    const record = await db.create('Leads', {
        'Name': lead.name,
        'Phone': lead.phone,
        'Phone Local': lead.phone_local,
        'Intent': lead.intent,
        'First Time': lead.first_time,
        'Previous Score': lead.previous_score,
        'Target Score': lead.target_score,
        'Exam Date': lead.exam_date,
        'Study Mode': lead.study_mode,
        'Area': lead.area,
        'Current Status': lead.current_status,
        'Platform': lead.platform,
        'UTM Source': lead.utm_source,
        'UTM Medium': lead.utm_medium,
        'UTM Campaign': lead.utm_campaign,
        'UTM Content': lead.utm_content,
        'UTM Term': lead.utm_term,
        'GCLID': lead.gclid,
        'FBCLID': lead.fbclid,
        'TTCLID': lead.ttclid,
        'Event ID': lead.event_id,
        'Summary': lead.summary,
        'Submitted At': lead.submitted_at,
        'WhatsApp Sent': lead.whatsapp_sent,
    })

    // 3. Find the next eligible client
    const client = await db.findOne('Clients', {
        view: 'Eligible',
        formula: `OR('${lead.intent}'='high', {Accepts Low Intent})`,
    })

    if (!client) {
        await mail.send({
            to: mail.admin,
            subject: `ליד בלי מכון זמין: ${lead.name}`,
            html: alertEmailHtml(
                'נכנס ליד ואין מכון זמין לקבל אותו',
                'הליד נשמר ב-Airtable בלי שיוך. צריך לשייך אותו ידנית או להפעיל מכון.',
                lead
            ),
        })
        return { status: 'no_client' }
    }

    const cf = client.fields || {}
    const method = cf['Delivery Method'] || 'Email'

    // 4. Assign the lead and move the client to the end of the queue
    await db.update('Leads', record.id, { 'Client': [client.id] })
    await db.update('Clients', client.id, { 'Last Lead At': lead.submitted_at })

    // 5. Deliver
    let delivered = false

    if ((method === 'Email' || method === 'Both') && cf['Email']) {
        await mail.send({
            to: cf['Email'],
            subject: `ליד חדש מקורסומטר: ${lead.name}`,
            html: clientEmailHtml(lead),
        })
        delivered = true
    }

    if (method === 'CRM' || method === 'Both') {
        const url = cf['CRM Webhook URL']
        if (url) {
            const crmRes = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: lead.name,
                    phone: lead.phone_local,
                    exam_date: lead.exam_date,
                    first_time: lead.first_time,
                    previous_score: lead.previous_score,
                    target_score: lead.target_score,
                    area: lead.area,
                    current_status: lead.current_status,
                    intent: lead.intent,
                    lead_id: lead.event_id,
                    source: 'Coursometer',
                }),
            })
            if (crmRes.ok) {
                delivered = true
            } else {
                await mail.send({
                    to: mail.admin,
                    subject: `שליחה למערכת של מכון נכשלה: ${lead.name}`,
                    html: alertEmailHtml(
                        `השליחה למערכת של ${cf['Client Name'] || 'המכון'} נכשלה`,
                        `המערכת החזירה שגיאה ${crmRes.status}. צריך להעביר את הליד ידנית.`,
                        lead
                    ),
                })
            }
        } else {
            await mail.send({
                to: mail.admin,
                subject: `למכון אין כתובת מערכת: ${lead.name}`,
                html: alertEmailHtml(
                    `למכון ${cf['Client Name'] || ''} אין כתובת מערכת`,
                    'המכון מוגדר לשליחה למערכת, אבל בטבלת המכונים אין לו כתובת. צריך להעביר את הליד ידנית.',
                    lead
                ),
            })
        }
    }

    // 6. Mark as sent
    if (delivered) {
        await db.update('Leads', record.id, { 'Sent To Client': true })
    }

    // 7. Low package alert (to admin only)
    try {
        const remainingBefore = Number(cf['Remaining'])
        if (Number.isFinite(remainingBefore)) {
            const remainingAfter = remainingBefore - 1
            if (remainingAfter === LOW_PACKAGE_THRESHOLD) {
                const clientName = cf['Client Name'] || 'המכון'
                await mail.send({
                    to: mail.admin,
                    subject: `לחבילה של ${clientName} נשארו ${remainingAfter} לידים`,
                    html: lowPackageEmailHtml(
                        clientName,
                        remainingAfter,
                        cf['Package Size'] ?? ''
                    ),
                })
            }
        }
    } catch (err) {
        console.log('Coursometer low package alert failed:', err.message)
    }

    return { status: delivered ? 'sent' : 'not_delivered', client: cf['Client Name'] }
}

/* ---------------- Handler ---------------- */

export default async function handler(req, res) {
    setCors(res)
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') {
        return res.status(405).json({ valid: false, error: 'method_not_allowed' })
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    const serviceSid = process.env.TWILIO_SERVICE_SID_COURSOMETER
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
    const lowIntent = examDate.includes('מאוחר') || examDate.includes('לא החלטתי')
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
        target_score: findAnswer(answers, 'מכוו'),
        exam_date: examDate,
        study_mode: findAnswer(answers, 'ללמוד'),
        area: findAnswer(answers, 'אזור'),
        current_status: findAnswer(answers, 'עושה כרגע'),
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
        whatsapp_sent: whatsappSent,
        submitted_at: new Date().toISOString(),
    }

    let summary = `ליד חדש מאומת מקורסומטר\n`
    summary += `סטטוס: ${intent === 'high' ? 'ליד חם' : 'מועד רחוק'}\n`
    summary += `שם: ${lead.name}\nטלפון: ${lead.phone_local}\n\n`
    Object.keys(answers).forEach((key) => {
        summary += `${key}\n← ${toText(answers[key])}\n\n`
    })
    lead.summary = summary

    try {
        const result = await processLead(lead)
        console.log('Coursometer lead processed:', result.status, result.client || '')
    } catch (err) {
        console.log('Coursometer lead processing error:', err.message)
        try {
            const mail = mailer()
            await mail.send({
                to: mail.admin,
                subject: `תקלה בטיפול בליד: ${lead.name}`,
                html: alertEmailHtml(
                    'הייתה תקלה בטיפול בליד',
                    `השגיאה: ${err.message}. צריך לבדוק את הליד ולטפל בו ידנית.`,
                    lead
                ),
            })
        } catch (mailErr) {
            console.log('Coursometer alert email failed:', mailErr.message)
        }
    }

    return res.status(200).json({ valid: true, intent })
}
