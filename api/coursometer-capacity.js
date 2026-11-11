import nodemailer from 'nodemailer'

const META_API_VERSION = 'v23.0'

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

async function pauseMetaCampaigns() {
    const token = process.env.META_ADS_TOKEN_COURSOMETER
    const accountId = process.env.META_AD_ACCOUNT_ID_COURSOMETER
    if (!token || !accountId) {
        return { skipped: true }
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

    return { paused, failed }
}

function listHtml(items) {
    return items.map((n) => `• ${String(n).replace(/</g, '&lt;')}`).join('<br>')
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
        try {
            const meta = await pauseMetaCampaigns()
            if (!meta.skipped && (meta.paused.length > 0 || meta.failed.length > 0)) {
                let html = `<div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.7;">`
                html += `<h2 style="color:#DC2626;">אין מכון פנוי, הקמפיינים במטא הושהו</h2>`
                if (meta.paused.length > 0) {
                    html += `<p><b>הושהו:</b><br>${listHtml(meta.paused)}</p>`
                }
                if (meta.failed.length > 0) {
                    html += `<p style="color:#DC2626;"><b>לא הצלחתי להשהות, צריך להשהות ידנית:</b><br>${listHtml(meta.failed)}</p>`
                }
                html += `<p>כשתגדיל חבילה או תפעיל מכון, צריך להפעיל את הקמפיינים במטא בחזרה ידנית.</p></div>`
                await sendAdminEmail('קורסומטר: הקמפיינים במטא הושהו', html)
            }
        } catch (err) {
            console.log('Coursometer capacity: Meta error', err.message)
            try {
                await sendAdminEmail(
                    'קורסומטר: לא הצלחתי להשהות את הקמפיינים במטא',
                    `<div dir="rtl" style="font-family: Arial, sans-serif; font-size: 15px;">אין מכון פנוי, אבל ההשהיה במטא נכשלה. צריך להשהות ידנית.<br><br>השגיאה: ${String(err.message).replace(/</g, '&lt;')}</div>`
                )
            } catch {}
        }
    }

    return res.status(200).json({ available })
}
