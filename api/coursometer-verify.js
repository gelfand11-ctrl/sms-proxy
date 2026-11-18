import nodemailer from 'nodemailer'

export const config = { maxDuration: 30 }

const LOW_PACKAGE_THRESHOLD = 8
const META_API_VERSION = 'v23.0'
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3'

/* ---------------- Verticals ---------------- */

const VERTICALS = {
    psychometric: {
        key: 'psychometric',
        label: 'פסיכומטרי',
        leadsTable: 'Leads',
        clientsTable: 'Clients',
        waTemplateEnv: 'TWILIO_WA_TEMPLATE_COURSOMETER',
        metaAccountEnv: 'META_AD_ACCOUNT_ID_COURSOMETER',
        tiktokAdvertiserEnv: 'TIKTOK_ADVERTISER_ID_COURSOMETER',
        subjectPrefix: '',
    },
    bagrut: {
        key: 'bagrut',
        label: 'בגרויות',
        leadsTable: 'Leads Bagrut',
        clientsTable: 'Clients Bagrut',
        waTemplateEnv: 'TWILIO_WA_TEMPLATE_COURSOMETER_BAGRUT',
        metaAccountEnv: 'META_AD_ACCOUNT_ID_COURSOMETER_BAGRUT',
        tiktokAdvertiserEnv: 'TIKTOK_ADVERTISER_ID_COURSOMETER_BAGRUT',
        subjectPrefix: 'בגרויות: ',
    },
}

export function getVertical(value) {
    return String(value || '').toLowerCase() === 'bagrut'
        ? VERTICALS.bagrut
        : VERTICALS.psychometric
}

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export function normalizeIsraeliMobile(input) {
    if (!input) return null
    let d = String(input).replace(/\D/g, '')
    if (d.startsWith('00972')) d = d.slice(5)
    else if (d.startsWith('972')) d = d.slice(3)
    if (d.startsWith('0')) d = d.slice(1)
    if (!/^5\d{8}$/.test(d)) return null
    return '+972' + d
}

export function toText(value) {
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

export async function sendWhatsApp({ accountSid, authToken, from, templateSid, to, firstName }) {
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

function leadRecordFields(lead) {
    const common = {
        'Name': lead.name,
        'Phone': lead.phone,
        'Phone Local': lead.phone_local,
        'Intent': lead.intent,
        'Exam Date': lead.exam_date,
        'Study Mode': lead.study_mode,
        'Area': lead.area,
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
    }
    if (lead.vertical === 'bagrut') {
        return {
            ...common,
            'Looking For': lead.looking_for,
            'Subjects': lead.subjects,
            'Math Units': lead.math_units,
            'English Units': lead.english_units,
        }
    }
    return {
        ...common,
        'First Time': lead.first_time,
        'Previous Score': lead.previous_score,
        'Target Score': lead.target_score,
        'Current Status': lead.current_status,
    }
}

function crmPayload(lead) {
    if (lead.vertical === 'bagrut') {
        return {
            name: lead.name,
            phone: lead.phone_local,
            looking_for: lead.looking_for,
            subjects: lead.subjects,
            math_units: lead.math_units,
            english_units: lead.english_units,
            exam_date: lead.exam_date,
            study_mode: lead.study_mode,
            area: lead.area,
            intent: lead.intent,
            lead_id: lead.event_id,
            source: 'Coursometer',
            vertical: 'bagrut',
        }
    }
    return {
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
    }
}

/* ---------------- Email ---------------- */

export function mailer() {
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
    if (lead.vertical === 'bagrut') {
        return (
            row('שם', lead.name) +
            row('טלפון', lead.phone_local) +
            row('מה מחפש', lead.looking_for) +
            row('מקצועות', lead.subjects) +
            row('יחידות במתמטיקה', lead.math_units) +
            row('יחידות באנגלית', lead.english_units) +
            row('מועד בחינה', lead.exam_date) +
            row('איך נוח ללמוד', lead.study_mode) +
            row('אזור', lead.area)
        )
    }
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
    const title = lead.vertical === 'bagrut' ? 'ליד בגרויות חדש מקורסומטר' : 'ליד חדש מקורסומטר'
    return `<div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.7;">
<h2 style="color:#1F6BFF;">${title}</h2>
<p>${leadDetailsHtml(lead)}</p>
<p style="color:#64748B; font-size:13px;">הטלפון אומת בקוד SMS. מומלץ לחזור לליד בהקדם האפשרי.</p>
</div>`
}

export function alertEmailHtml(title, text, lead) {
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

/* ---------------- Meta + TikTok: immediate pause when no capacity is left ---------------- */

async function pauseMetaCampaigns(v) {
    const token = process.env.META_ADS_TOKEN_COURSOMETER
    const accountId = process.env[v.metaAccountEnv]
    if (!token || !accountId) {
        return { skipped: true, paused: [], failed: [] }
    }

    const listParams = new URLSearchParams({
        fields: 'id,name,status',
        limit: '200',
        access_token: token,
    })
    const listRes = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/act_${accountId}/campaigns?${listParams.toString()}`
    )
    const listData = await listRes.json().catch(() => ({}))
    if (!listRes.ok) {
        throw new Error(`Meta list ${listRes.status}: ${JSON.stringify(listData.error || listData)}`)
    }

    const active = (listData.data || []).filter((c) => c.status === 'ACTIVE')
    const paused = []
    const failed = []

    for (const c of active) {
        const r = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${c.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ status: 'PAUSED', access_token: token }).toString(),
        })
        const d = await r.json().catch(() => ({}))
        if (r.ok && d.success !== false) {
            paused.push(c.name)
        } else {
            failed.push(c.name)
            console.log('Coursometer: Meta pause failed', c.id, JSON.stringify(d.error || d))
        }
    }

    return { skipped: false, paused, failed }
}

async function tiktokListCampaigns(path, advertiserId, token, withFields) {
    const params = new URLSearchParams({
        advertiser_id: advertiserId,
        page: '1',
        page_size: '1000',
    })
    if (withFields) {
        params.set('fields', JSON.stringify(['campaign_id', 'campaign_name', 'operation_status']))
    }
    const r = await fetch(`${TIKTOK_API_BASE}${path}?${params.toString()}`, {
        headers: { 'Access-Token': token },
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d.code !== 0) {
        throw new Error(`TikTok ${path} ${r.status}: ${d.code} ${d.message || ''}`)
    }
    return (d.data && d.data.list) || []
}

async function tiktokDisableBatch(path, advertiserId, token, campaigns, paused, failed) {
    for (let i = 0; i < campaigns.length; i += 20) {
        const batch = campaigns.slice(i, i + 20)
        const r = await fetch(`${TIKTOK_API_BASE}${path}`, {
            method: 'POST',
            headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                advertiser_id: advertiserId,
                campaign_ids: batch.map((c) => String(c.campaign_id)),
                operation_status: 'DISABLE',
            }),
        })
        const d = await r.json().catch(() => ({}))
        const names = batch.map((c) => c.campaign_name || String(c.campaign_id))
        if (r.ok && d.code === 0) {
            names.forEach((n) => paused.push(n))
        } else {
            names.forEach((n) => failed.push(n))
            console.log('Coursometer: TikTok pause failed', path, d.code, d.message)
        }
    }
}

async function pauseTikTokCampaigns(v) {
    const token = process.env.TIKTOK_ADS_TOKEN_COURSOMETER
    const advertiserId = process.env[v.tiktokAdvertiserEnv]
    if (!token || !advertiserId) {
        return { skipped: true, paused: [], failed: [] }
    }

    let smartList = []
    let smartError = ''
    try {
        smartList = await tiktokListCampaigns('/smart_plus/campaign/get/', advertiserId, token, false)
    } catch (err) {
        smartError = err.message
    }

    const standardList = await tiktokListCampaigns('/campaign/get/', advertiserId, token, true)

    const smartIds = new Set(smartList.map((c) => String(c.campaign_id)))
    const smartActive = smartList.filter((c) => c.operation_status === 'ENABLE')
    const standardActive = standardList.filter(
        (c) => c.operation_status === 'ENABLE' && !smartIds.has(String(c.campaign_id))
    )

    const paused = []
    const failed = []

    await tiktokDisableBatch('/smart_plus/campaign/status/update/', advertiserId, token, smartActive, paused, failed)
    await tiktokDisableBatch('/campaign/status/update/', advertiserId, token, standardActive, paused, failed)

    if (smartError) {
        failed.push(`לא הצלחתי לבדוק קמפייני Smart+, כדאי לבדוק ידנית (${smartError})`)
    }

    return { skipped: false, paused, failed }
}

async function runSafely(fn) {
    try {
        return await fn()
    } catch (err) {
        return { skipped: false, paused: [], failed: [], error: err.message }
    }
}

function nameListHtml(items) {
    return items.map((n) => `• ${escapeHtml(n)}`).join('<br>')
}

function hasNews(result) {
    if (result.error) return true
    if (result.skipped) return false
    return result.paused.length > 0 || result.failed.length > 0
}

function platformSectionHtml(platformName, result) {
    if (result.error) {
        return `<p style="color:#DC2626;"><b>${platformName}: ההשהיה נכשלה, צריך להשהות ידנית.</b><br>השגיאה: ${escapeHtml(result.error)}</p>`
    }
    if (result.skipped) return ''
    let html = ''
    if (result.paused.length > 0) {
        html += `<p><b>${platformName}, הושהו:</b><br>${nameListHtml(result.paused)}</p>`
    }
    if (result.failed.length > 0) {
        html += `<p style="color:#DC2626;"><b>${platformName}, לא הצלחתי להשהות, צריך להשהות ידנית:</b><br>${nameListHtml(result.failed)}</p>`
    }
    return html
}

async function pauseSocialIfNoCapacity(db, mail, excludeClientId, v) {
    try {
        const formula = excludeClientId ? `RECORD_ID()!='${excludeClientId}'` : ''
        const other = await db.findOne(v.clientsTable, { view: 'Eligible', formula })
        if (other) return
    } catch (err) {
        console.log('Coursometer: capacity check before pause failed:', err.message)
        return
    }

    const meta = await runSafely(() => pauseMetaCampaigns(v))
    const tiktok = await runSafely(() => pauseTikTokCampaigns(v))

    if (!hasNews(meta) && !hasNews(tiktok)) return

    const isBagrut = v.key === 'bagrut'
    const title = isBagrut
        ? 'בגרויות: אין לקוח פנוי, הקמפיינים של הבגרויות הושהו'
        : 'אין מכון פנוי, הקמפיינים הושהו'

    let html = `<div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.7;">`
    html += `<h2 style="color:#DC2626;">${title}</h2>`
    html += platformSectionHtml('מטא', meta)
    html += platformSectionHtml('טיקטוק', tiktok)
    if (!isBagrut) {
        html += `<p>הקמפיינים בגוגל יושהו בבדיקה השעתית הקרובה.</p>`
    }
    html += `<p>כשתגדיל חבילה או תפעיל לקוח, צריך להפעיל את הקמפיינים במטא ובטיקטוק בחזרה ידנית.</p></div>`

    try {
        await mail.send({
            to: mail.admin,
            subject: isBagrut
                ? 'קורסומטר בגרויות: אין לקוח פנוי, הקמפיינים הושהו'
                : 'קורסומטר: אין מכון פנוי, הקמפיינים הושהו',
            html,
        })
    } catch (err) {
        console.log('Coursometer: pause email failed:', err.message)
    }
}

/* ---------------- Lead processing ---------------- */

export async function processLead(lead, v) {
    const db = airtable()
    const mail = mailer()
    const prefix = v.subjectPrefix

    // 1. Duplicate check: same phone in the last 90 days, in this vertical only
    const duplicate = await db.findOne(v.leadsTable, {
        formula: `AND({Phone}='${lead.phone}', IS_AFTER({Submitted At}, DATEADD(NOW(), -90, 'days')))`,
    })
    if (duplicate) {
        console.log('Coursometer: duplicate lead, skipping', v.key, lead.phone)
        return { status: 'duplicate' }
    }

    // 2. Save the lead
    const record = await db.create(v.leadsTable, leadRecordFields(lead))

    // 3. Find the next eligible client in this vertical
    const client = await db.findOne(v.clientsTable, {
        view: 'Eligible',
        formula: `OR('${lead.intent}'='high', {Accepts Low Intent})`,
    })

    if (!client) {
        await mail.send({
            to: mail.admin,
            subject: `${prefix}ליד בלי לקוח זמין: ${lead.name}`,
            html: alertEmailHtml(
                'נכנס ליד ואין לקוח זמין לקבל אותו',
                'הליד נשמר ב-Airtable בלי שיוך. צריך לשייך אותו ידנית או להפעיל לקוח.',
                lead
            ),
        })
        await pauseSocialIfNoCapacity(db, mail, null, v)
        return { status: 'no_client' }
    }

    const cf = client.fields || {}
    const method = cf['Delivery Method'] || 'Email'

    // 4. Assign the lead and move the client to the end of the queue
    await db.update(v.leadsTable, record.id, { 'Client': [client.id] })
    await db.update(v.clientsTable, client.id, { 'Last Lead At': lead.submitted_at })

    // 5. Deliver
    let delivered = false

    if ((method === 'Email' || method === 'Both') && cf['Email']) {
        await mail.send({
            to: cf['Email'],
            subject:
                lead.vertical === 'bagrut'
                    ? `ליד בגרויות חדש מקורסומטר: ${lead.name}`
                    : `ליד חדש מקורסומטר: ${lead.name}`,
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
                body: JSON.stringify(crmPayload(lead)),
            })
            if (crmRes.ok) {
                delivered = true
            } else {
                await mail.send({
                    to: mail.admin,
                    subject: `${prefix}שליחה למערכת של לקוח נכשלה: ${lead.name}`,
                    html: alertEmailHtml(
                        `השליחה למערכת של ${cf['Client Name'] || 'הלקוח'} נכשלה`,
                        `המערכת החזירה שגיאה ${crmRes.status}. צריך להעביר את הליד ידנית.`,
                        lead
                    ),
                })
            }
        } else {
            await mail.send({
                to: mail.admin,
                subject: `${prefix}ללקוח אין כתובת מערכת: ${lead.name}`,
                html: alertEmailHtml(
                    `ללקוח ${cf['Client Name'] || ''} אין כתובת מערכת`,
                    'הלקוח מוגדר לשליחה למערכת, אבל בטבלת הלקוחות אין לו כתובת. צריך להעביר את הליד ידנית.',
                    lead
                ),
            })
        }
    }

    // 6. Mark as sent
    if (delivered) {
        await db.update(v.leadsTable, record.id, { 'Sent To Client': true })
    }

    // 7. Low package alert (to admin only)
    const remainingBefore = Number(cf['Remaining'])
    try {
        if (Number.isFinite(remainingBefore)) {
            const remainingAfter = remainingBefore - 1
            if (remainingAfter === LOW_PACKAGE_THRESHOLD) {
                const clientName = cf['Client Name'] || 'הלקוח'
                await mail.send({
                    to: mail.admin,
                    subject: `${prefix}לחבילה של ${clientName} נשארו ${remainingAfter} לידים`,
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

    // 8. If this lead closed the client's package, pause this vertical's Meta and TikTok
    //    campaigns right away when no other client in this vertical is free
    if (Number.isFinite(remainingBefore) && remainingBefore - 1 <= 0) {
        await pauseSocialIfNoCapacity(db, mail, client.id, v)
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

    if (!accountSid || !authToken || !serviceSid) {
        console.log('Coursometer verify: missing env variables')
        return res.status(500).json({ valid: false, error: 'server_config' })
    }

    const body = req.body || {}
    const v = getVertical(body.vertical)
    const waTemplate = process.env[v.waTemplateEnv]
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

    const isBagrut = v.key === 'bagrut'

    // Intent: bagrut is low only for "עוד לא החלטתי"; psychometric is unchanged
    const examDate = isBagrut ? findAnswer(answers, 'מועד') : findAnswer(answers, 'להיבחן')
    const lowIntent = isBagrut
        ? examDate.includes('לא החלטתי')
        : examDate.includes('מאוחר') || examDate.includes('לא החלטתי')
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
        vertical: v.key,
        phone,
        phone_local: '0' + phone.slice(4),
        name,
        intent,
        exam_date: examDate,
        study_mode: findAnswer(answers, 'ללמוד'),
        area: findAnswer(answers, 'אזור'),
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

    if (isBagrut) {
        lead.looking_for = findAnswer(answers, 'מחפש')
        lead.subjects = findAnswer(answers, 'מקצועות')
        lead.math_units = findAnswer(answers, 'במתמטיקה')
        lead.english_units = findAnswer(answers, 'באנגלית')
    } else {
        lead.first_time = findAnswer(answers, 'הפעם הראשונה')
        lead.previous_score = findAnswer(answers, 'הציון הקודם')
        lead.target_score = findAnswer(answers, 'מכוו')
        lead.current_status = findAnswer(answers, 'עושה כרגע')
    }

    let summary = isBagrut
        ? `ליד בגרויות חדש מאומת מקורסומטר\n`
        : `ליד חדש מאומת מקורסומטר\n`
    if (isBagrut) {
        summary += `סטטוס: ${intent === 'high' ? 'ליד חם' : 'עוד לא החליט על מועד'}\n`
    } else {
        summary += `סטטוס: ${intent === 'high' ? 'ליד חם' : 'מועד רחוק'}\n`
    }
    summary += `שם: ${lead.name}\nטלפון: ${lead.phone_local}\n\n`
    Object.keys(answers).forEach((key) => {
        summary += `${key}\n← ${toText(answers[key])}\n\n`
    })
    lead.summary = summary

    try {
        const result = await processLead(lead, v)
        console.log('Coursometer lead processed:', v.key, result.status, result.client || '')
    } catch (err) {
        console.log('Coursometer lead processing error:', v.key, err.message)
        try {
            const mail = mailer()
            await mail.send({
                to: mail.admin,
                subject: `${v.subjectPrefix}תקלה בטיפול בליד: ${lead.name}`,
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
