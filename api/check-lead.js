module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', '*')

    if (req.method === 'OPTIONS') {
        return res.status(200).end()
    }

    const { phone, vertical } = req.body
    const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID
    const TABLE_ID = "tblOBla0U6ddbwzHP"

    const VERTICAL_MAP = {
        "Car Accidents": "CAR ACCIEDNTS",
        "Medical Malpractice": "MEDICAL",
        "Work Injuries": "WORK ACCIEDNTS",
    }
    const airtableVertical = VERTICAL_MAP[vertical] || vertical

    try {
        const filterFormula = encodeURIComponent(
            `AND({Phone Number} = "${phone}", {Vertical} = "${airtableVertical}", IS_AFTER({Timestamp}, DATEADD(NOW(), -90, 'days')))`
        )
        const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE_ID}?filterByFormula=${filterFormula}`

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${AIRTABLE_API_KEY}`
            }
        })
        const data = await response.json()
        const alreadyExists = Boolean(data.records && data.records.length > 0)

        return res.status(200).json({ alreadyExists })
    } catch (err) {
        console.log('Check-lead error:', err.message)
        return res.status(200).json({ alreadyExists: false })
    }
}
