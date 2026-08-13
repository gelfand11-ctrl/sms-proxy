const { google } = require('googleapis')

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', '*')
    if (req.method === 'OPTIONS') {
        return res.status(200).end()
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' })
    }

    const { sheetId, name, phone, vertical } = req.body

    if (!sheetId) {
        return res.status(400).json({ error: 'Missing sheetId' })
    }

    try {
        const auth = new google.auth.JWT(
            process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            null,
            process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            ['https://www.googleapis.com/auth/spreadsheets']
        )

        const sheets = google.sheets({ version: 'v4', auth })

        await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: 'גיליון1!A:C',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
                values: [[name || '', phone || '', vertical || '']]
            }
        })

        return res.status(200).json({ success: true })
    } catch (err) {
        console.log('add-lead-to-sheet error:', err.message)
        return res.status(500).json({ error: err.message })
    }
}
