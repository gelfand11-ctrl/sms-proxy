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

export default async function handler(req, res) {
    setCors(res)
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'method_not_allowed' })
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    const serviceSid = process.env.TWILIO_SERVICE_SID_COURSOMETER

    if (!accountSid || !authToken || !serviceSid) {
        console.log('Coursometer send: missing env variables')
        return res.status(500).json({ ok: false, error: 'server_config' })
    }

    const phone = normalizeIsraeliMobile(req.body && req.body.phone)
    if (!phone) {
        return res.status(400).json({ ok: false, error: 'invalid_phone' })
    }

    try {
        const response = await fetch(
            `https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`,
            {
                method: 'POST',
                headers: {
                    Authorization:
                        'Basic ' +
                        Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    To: phone,
                    Channel: 'sms',
                    Locale: 'he',
                }).toString(),
            }
        )

        const data = await response.json()

        if (!response.ok) {
            console.log('Coursometer send: Twilio error', data.code, data.message)
            let error = 'send_failed'
            if (data.code === 60200) error = 'invalid_phone'
            if (data.code === 60203) error = 'too_many_attempts'
            return res.status(400).json({ ok: false, error })
        }

        return res.status(200).json({ ok: data.status === 'pending', phone })
    } catch (err) {
        console.log('Coursometer send: exception', err.message)
        return res.status(500).json({ ok: false, error: 'server_error' })
    }
}
