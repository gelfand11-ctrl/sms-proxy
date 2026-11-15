import nodemailer from 'nodemailer'

const META_API_VERSION = 'v23.0'
const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3'

async function sendAdminEmail(subject, html) {
    const user = process.env.GMAIL_USER_COURSOMETER
    const pass = process.env.GMAIL_APP_PASSWORD_COURSOMETER
    if (!user || !pass) return
    const transport = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
    })
    await transport.sendMail({
        from: `"Coursometer" <${user}>`,
        to: user,
        subject,
        html,
    })
}

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

async function pauseMetaCampaigns() {
    const token = process.env.META_ADS_TOKEN_COURSOMETER
    const accountId = process.env.META_AD_ACCOUNT_ID_COURSOMETER
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
            console.log('Coursometer capacity: Meta pause failed', c.id, JSON.stringify(d.error || d))
        }
    }

    return { skipped: false, paused, failed }
}

async function pauseTikTokCampaigns() {
    const token = process.env.TIKTOK_ADS_TOKEN_COURSOMETER
    const advertiserId = process.env.TIKTOK_ADVERTISER_ID_COURSOMETER
    if (!token || !advertiserId) {
        return { skipped: true, paused: [], failed: [] }
    }

    const params = new URLSearchParams({
        advertiser_id: advertiserId,
        page: '1',
        page_size: '1000',
        fields: JSON.stringify(['campaign_id', 'campaign_name', 'operation_status']),
    })
    const listRes = await fetch(`${TIKTOK_API_BASE}/campaign/get/?${params.toString()}`, {
        headers: { 'Access-Token': token },
    })
    const listData = await listRes.json().catch(() => ({}))
    if (!listRes.ok || listData.code !== 0) {
        throw new Error(`TikTok list ${listRes.status}: ${listData.code} ${listData.message || ''}`)
    }

    const list = (listData.data && listData.data.list) || []
    const active = list.filter((c) => c.operation_status === 'ENABLE')
    const paused = []
    const failed = []

    for (let i = 0; i < active.length; i += 20) {
        const batch = active.slice(i, i + 20)
        const r = await fetch(`${TIKTOK_API_BASE}/campaign/status/update/`, {
            method: 'POST',
            headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                advertiser_id: advertiserId,
                campaign_ids: batch.map((c) => c.campaign_id),
                operation_status: 'DISABLE',
            }),
        })
        const d = await r.json().catch(() => ({}))
        if (r.ok && d.code === 0) {
            batch.forEach((c) => paused.push(c.campaign_name))
        } else {
            batch.forEach((c) => failed.push(c.campaign_name))
            console.log('Coursometer capacity: TikTok pause failed', d.code, d.message)
        }
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

function listHtml(items) {
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
        html += `<p><b>${platformName}, הושהו:</b><br>${listHtml(result.paused)}</p>`
    }
    if (result.failed.length > 0) {
        html += `<p style="color:#DC2626;"><b>${platformName}, לא הצלחתי להשהות, צריך להשהות ידנית:</b><br>${listHtml(result.failed)}</p>`
    }
    return html
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store')

    const expectedKey = process.env.CAPACITY_KEY_COURSOMETER
    const key = String((req.query && req.query.key) || '')
    if (!expectedKey || key !== expectedKey) {
        return res.status(401).json({ error: 'unauthorized' })
    }

    const token = process.env.AIRTABLE_TOKEN_COURSOMETER
    const baseId = process.env.AIRTABLE_BASE_ID_COURSOMETER
    if (!token || !baseId) {
        return res.status(500).json({ error: 'server_config' })
    }

    let available
    try {
        const params = new URLSearchParams({ maxRecords: '1', view: 'Eligible' })
        const r = await fetch(
            `https://api.airtable.com/v0/${baseId}/${encodeURIComponent('Clients')}?${params.toString()}`,
            { headers: { Authorization: `Bearer ${token}` } }
        )
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
            console.log('Coursometer capacity: Airtable error', r.status, JSON.stringify(data.error || data))
            return res.status(502).json({ error: 'airtable_error' })
        }
        available = Array.isArray(data.records) && data.records.length > 0
    } catch (err) {
        console.log('Coursometer capacity: exception', err.message)
        return res.status(500).json({ error: 'server_error' })
    }

    if (!available) {
        const meta = await runSafely(pauseMetaCampaigns)
        const tiktok = await runSafely(pauseTikTokCampaigns)

        if (hasNews(meta) || hasNews(tiktok)) {
            let html = `<div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.7;">`
            html += `<h2 style="color:#DC2626;">אין מכון פנוי, הקמפיינים הושהו</h2>`
            html += platformSectionHtml('מטא', meta)
            html += platformSectionHtml('טיקטוק', tiktok)
            html += `<p>כשתגדיל חבילה או תפעיל מכון, צריך להפעיל את הקמפיינים במטא ובטיקטוק בחזרה ידנית.</p></div>`
            try {
                await sendAdminEmail('קורסומטר: אין מכון פנוי, הקמפיינים הושהו', html)
            } catch (err) {
                console.log('Coursometer capacity: pause email failed', err.message)
            }
        }
    }

    return res.status(200).json({ available })
}
