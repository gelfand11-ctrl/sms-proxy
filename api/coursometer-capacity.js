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
        const available = Array.isArray(data.records) && data.records.length > 0
        return res.status(200).json({ available })
    } catch (err) {
        console.log('Coursometer capacity: exception', err.message)
        return res.status(500).json({ error: 'server_error' })
    }
}
