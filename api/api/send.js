export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', '*')
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end()
    }

    try {
        const { phone } = req.body

        const accountSid = process.env.TWILIO_ACCOUNT_SID
        const authToken = process.env.TWILIO_AUTH_TOKEN
        const serviceSid = process.env.TWILIO_SERVICE_SID

        const response = await fetch(
            `https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`,
            {
                method: 'POST',
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: `To=${encodeURIComponent(phone)}&Channel=sms`
            }
        )

        const data = await response.json()
        return res.status(200).json({ status: data.status })
    } catch (err) {
        return res.status(500).json({ error: err.message })
    }
}
