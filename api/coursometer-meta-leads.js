import crypto from 'crypto'
import {
    getVertical,
    normalizeIsraeliMobile,
    toText,
    sendWhatsApp,
    mailer,
    alertEmailHtml,
    processLead,
} from './coursometer-verify.js'

// Meta signs the raw body, so Vercel must not parse it first
export const config = { maxDuration: 30, api: { bodyParser: false } }

const META_API_VERSION = 'v23.0'

/* ---------------- Helpers ---------------- */

async function readRawBody(req) {
    const chunks = []
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
    return Buffer.concat(chunks)
}

function validSignature(rawBody, header, appSecret) {
    if (!header || !appSecret) return false
    const expected =
        'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(String(header))
    return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Meta may replace spaces with underscores in question names and answers
function clean(s) {
    return String(s || '').replace(/_/g, ' ').trim()
}

function findAnswer(answers, keyword) {
    const key = Object.keys(answers).find((k) => k.includes(keyword))
    return key ? answers[key] : ''
}

// Which vertical a form belongs to. Forms listed in META_FORM_IDS_BAGRUT are bagrut,
// every other form is psychometric.
function verticalForForm(formId) {
    const bagrutIds = String(process.env.META_FORM_IDS_BAGRUT || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    return getVertical(bagrutIds.includes(String(formId)) ? 'bagrut' : 'psychometric')
}

// The Meta form has no year in the exam date, so the nearest upcoming year is added,
// written exactly like the Tally answers
const EXAM_SEASONS = [
    { key: 'חורף', month: 12, label: (y) => `חורף - דצמבר  ${y}` },
    { key: 'אביב', month: 4, label: (y) => `אביב - אפריל ${y}` },
    { key: 'קיץ', month: 7, label: (y) => `קיץ - יולי  ${y}` },
    { key: 'סתיו', month: 9, label: (y) => `סתיו - ספטמבר ${y}` },
]

function israelNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }))
}

function examDateWithYear(answer) {
    const season = EXAM_SEASONS.find((s) => answer.includes(s.key))
    if (!season) return answer
    const now = israelNow()
    const year = season.month >= now.getMonth() + 1 ? now.getFullYear() : now.getFullYear() + 1
    return season.label(year)
}

// Bagrut has two sittings. Written exactly like the Tally answers:
// "חורף (דצמבר 2026 - פברואר 2027)" and "קיץ 2027"
function bagrutExamDateWithYear(answer) {
    const now = israelNow()
    const month = now.getMonth() + 1
    const year = now.getFullYear()
    if (answer.includes('חורף')) {
        // Jan-Feb still belong to the winter sitting that started last December
        const start = month <= 2 ? year - 1 : year
        return `חורף (דצמבר ${start} - פברואר ${start + 1})`
    }
    if (answer.includes('קיץ')) {
        return `קיץ ${month <= 7 ? year : year + 1}`
    }
    return answer
}

async function fetchLead(leadgenId, token) {
    const params = new URLSearchParams({
        fields: 'field_data,created_time,form_id,ad_name,adset_name,campaign_name,platform',
        access_token: token,
    })
    const r = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${leadgenId}?${params.toString()}`
    )
    const d = await r.json().catch(() => ({}))
    if (!r.ok) {
        throw new Error(`Meta lead ${r.status}: ${JSON.stringify(d.error || d)}`)
    }
    return d
}

/* ---------------- One lead ---------------- */

async function handleLeadgen(change) {
    const value = change.value || {}
    const leadgenId = value.leadgen_id
    if (!leadgenId) return

    const pageToken = process.env.META_LEADS_PAGE_TOKEN
    if (!pageToken) throw new Error('META_LEADS_PAGE_TOKEN missing')

    const data = await fetchLead(leadgenId, pageToken)
    const v = verticalForForm(data.form_id || value.form_id)
    const isBagrut = v.key === 'bagrut'

    // Turn Meta's field list into { question: answer }
    const answers = {}
    for (const f of data.field_data || []) {
        answers[clean(f.name)] = clean(toText(f.values))
    }

    const name = answers['full name'] || findAnswer(answers, 'name') || ''
    const rawPhone = answers['phone number'] || findAnswer(answers, 'phone') || ''
    const phone = normalizeIsraeliMobile(rawPhone)

    if (!phone) {
        const mail = mailer()
        await mail.send({
            to: mail.admin,
            subject: `${v.subjectPrefix}ליד ממטא עם טלפון לא תקין: ${name}`,
            html: alertEmailHtml(
                'נכנס ליד מהשאלון במטא עם מספר טלפון שאינו נייד ישראלי',
                `המספר שהתקבל: ${rawPhone}. הליד לא נשמר ולא נשלח ללקוח, צריך לטפל בו ידנית.`,
                { vertical: v.key, name, phone_local: rawPhone, intent: '' }
            ),
        })
        return
    }

    const examDate = isBagrut
        ? bagrutExamDateWithYear(findAnswer(answers, 'מועד'))
        : examDateWithYear(findAnswer(answers, 'להיבחן'))
    const lowIntent = isBagrut
        ? examDate.includes('לא החלטתי')
        : examDate.includes('מאוחר') || examDate.includes('לא החלטתי')
    const intent = lowIntent ? 'low' : 'high'

    const firstName = name.trim().split(/\s+/)[0] || ''
    const whatsappSent = await sendWhatsApp({
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        from: process.env.TWILIO_WA_FROM_COURSOMETER,
        templateSid: process.env[v.waTemplateEnv],
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
        utm_source: 'meta',
        utm_medium: 'instant_form',
        utm_campaign: toText(data.campaign_name),
        utm_content: toText(data.ad_name),
        utm_term: toText(data.adset_name),
        gclid: '',
        fbclid: '',
        ttclid: '',
        platform: data.platform === 'ig' ? 'instagram' : 'facebook',
        event_id: 'meta-' + leadgenId,
        whatsapp_sent: whatsappSent,
        submitted_at: new Date().toISOString(),
    }

    if (isBagrut) {
        lead.looking_for = findAnswer(answers, 'מחפש')
        lead.subjects = findAnswer(answers, 'מקצוע')
        lead.math_units = findAnswer(answers, 'במתמטיקה')
        lead.english_units = findAnswer(answers, 'באנגלית')
    } else {
        lead.first_time = findAnswer(answers, 'הפעם הראשונה')
        lead.previous_score = findAnswer(answers, 'הציון הקודם')
        lead.target_score = findAnswer(answers, 'מכוו')
        lead.current_status = findAnswer(answers, 'עושה כרגע')
    }

    let summary = isBagrut
        ? `ליד בגרויות חדש מאומת מקורסומטר (שאלון מטא)\n`
        : `ליד חדש מאומת מקורסומטר (שאלון מטא)\n`
    if (isBagrut) {
        summary += `סטטוס: ${intent === 'high' ? 'ליד חם' : 'עוד לא החליט על מועד'}\n`
    } else {
        summary += `סטטוס: ${intent === 'high' ? 'ליד חם' : 'מועד רחוק'}\n`
    }
    summary += `שם: ${lead.name}\nטלפון: ${lead.phone_local}\n\n`
    Object.keys(answers).forEach((key) => {
        if (key === 'full name' || key === 'phone number') return
        const shown = key === findKey(answers, isBagrut ? 'מועד' : 'להיבחן') ? examDate : answers[key]
        summary += `${key}\n← ${shown}\n\n`
    })
    lead.summary = summary

    try {
        const result = await processLead(lead, v)
        console.log('Coursometer Meta lead processed:', v.key, result.status, result.client || '')
    } catch (err) {
        console.log('Coursometer Meta lead processing error:', v.key, err.message)
        const mail = mailer()
        await mail.send({
            to: mail.admin,
            subject: `${v.subjectPrefix}תקלה בטיפול בליד ממטא: ${lead.name}`,
            html: alertEmailHtml(
                'הייתה תקלה בטיפול בליד מהשאלון במטא',
                `השגיאה: ${err.message}. צריך לבדוק את הליד ולטפל בו ידנית.`,
                lead
            ),
        })
    }
}

function findKey(answers, keyword) {
    return Object.keys(answers).find((k) => k.includes(keyword)) || null
}

/* ---------------- Handler ---------------- */

export default async function handler(req, res) {
    // 1. Meta checks the address once, when the webhook is set up
    if (req.method === 'GET') {
        const mode = req.query['hub.mode']
        const token = req.query['hub.verify_token']
        const challenge = req.query['hub.challenge']
        if (mode === 'subscribe' && token && token === process.env.META_LEADS_VERIFY_TOKEN) {
            return res.status(200).send(challenge)
        }
        return res.status(403).send('forbidden')
    }

    if (req.method !== 'POST') return res.status(405).end()

    // 2. Every new lead: check that it really came from Meta
    const rawBody = await readRawBody(req)
    if (
        !validSignature(
            rawBody,
            req.headers['x-hub-signature-256'],
            process.env.META_LEADS_APP_SECRET
        )
    ) {
        console.log('Coursometer Meta leads: bad signature')
        return res.status(401).send('bad signature')
    }

    let body = {}
    try {
        body = JSON.parse(rawBody.toString('utf8'))
    } catch {
        return res.status(400).send('bad json')
    }

    // 3. Handle every lead in the notification
    for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
            if (change.field !== 'leadgen') continue
            try {
                await handleLeadgen(change)
            } catch (err) {
                console.log('Coursometer Meta leads error:', err.message)
                try {
                    const mail = mailer()
                    await mail.send({
                        to: mail.admin,
                        subject: 'קורסומטר: תקלה בקבלת ליד מהשאלון במטא',
                        html: `<div dir="rtl" style="font-family: Arial, sans-serif;"><h2 style="color:#DC2626;">תקלה בקבלת ליד מהשאלון במטא</h2><p>השגיאה: ${String(err.message).replace(/</g, '&lt;')}</p><p>מזהה הליד במטא: ${String((change.value || {}).leadgen_id || '')}</p><p>את הליד אפשר למצוא במרכז הלידים של מטא ולהעביר ידנית.</p></div>`,
                    })
                } catch (mailErr) {
                    console.log('Coursometer Meta leads alert email failed:', mailErr.message)
                }
            }
        }
    }

    // Always answer 200, so Meta does not resend the same lead again and again
    return res.status(200).send('ok')
}
