module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', '*')
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end()
    }
    const { phone, code, answers } = req.body
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    const serviceSid = process.env.TWILIO_SERVICE_SID
    const response = await fetch(
        `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`,
        {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `To=${encodeURIComponent(phone)}&Code=${encodeURIComponent(code)}`
        }
    )
    const data = await response.json()
    const valid = data.status === 'approved'
    if (valid) {
        let summary = `Новый подтвержденный лид!\nТелефон: ${phone}\n\n`
        if (answers) {
            for (const key in answers) {
                summary += `${key}\n→ ${answers[key]}\n\n`
            }
        }
        await fetch("https://hooks.zapier.com/hooks/catch/26370661/43nnwm6/", {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ phone, summary })
        }).catch(() => {})
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
                        To: `whatsapp:${phone}`,
                        ContentSid: 'HX80028d41a2729b64eb7573fc19c0630e'
                    }).toString()
                }
            )
            const waData = await waResponse.json()
            console.log('WhatsApp result:', JSON.stringify(waData))
        } catch (err) {
            console.log('WhatsApp error:', err.message)
        }
    }
    return res.status(200).json({ valid })
}
