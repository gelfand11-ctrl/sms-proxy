module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
        return res.status(200).end()
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' })
    }
    const { phone } = req.body
    if (!phone) {
        return res.status(400).json({ error: 'Missing phone number' })
    }
    const cleanPhone = phone.toString().trim().replace(/\s+/g, '').replace(/\n/g, '').replace(/\r/g, '')
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    try {
        const waResponse = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
            {
                method: 'POST',
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    From: 'whatsapp:+972535661893',
                    To: `whatsapp:${cleanPhone}`,
                    ContentSid: 'HX24b6e5b5ea54603b826237c5a54cef2a'
                }).toString()
            }
        )
        const waData = await waResponse.json()
        console.log('WhatsApp result:', JSON.stringify(waData))
        return res.status(200).json({ success: true })
    } catch (err) {
        console.log('WhatsApp error:', err.message)
        return res.status(500).json({ error: err.message })
    }
}
