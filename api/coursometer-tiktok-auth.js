export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store')

    const expectedKey = process.env.CAPACITY_KEY_COURSOMETER
    const key = String((req.query && req.query.key) || '')
    if (!expectedKey || key !== expectedKey) {
        return res.status(401).json({ error: 'unauthorized' })
    }

    const appId = process.env.TIKTOK_APP_ID_COURSOMETER
    const secret = process.env.TIKTOK_APP_SECRET_COURSOMETER
    if (!appId || !secret) {
        return res.status(500).json({ error: 'missing TikTok app env variables' })
    }

    const authCode = String((req.query && req.query.auth_code) || '')
    if (!authCode) {
        return res.status(400).json({ error: 'missing auth_code' })
    }

    try {
        const r = await fetch('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: appId, secret, auth_code: authCode }),
        })
        const data = await r.json().catch(() => ({}))
        return res.status(200).json({
            code: data.code,
            message: data.message,
            advertiser_ids: data.data ? data.data.advertiser_ids : null,
            access_token: data.data ? data.data.access_token : null,
        })
    } catch (err) {
        return res.status(500).json({ error: err.message })
    }
}
