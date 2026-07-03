// /api/tiktok-capi.js
// Server-side TikTok Events API (CAPI) endpoint.

const crypto = require('crypto');

const TIKTOK_PIXEL_CODE = process.env.TIKTOK_PIXEL_CODE;
const TIKTOK_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;
const TIKTOK_TEST_EVENT_CODE = process.env.TIKTOK_TEST_EVENT_CODE || null;

function sha256(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const {
      eventId,
      phone,
      email,
      pageUrl,
      ip,
      userAgent,
      ttclid,
      ttp,
      contentName,
      eventName = 'Lead',
    } = req.body;

    if (!pageUrl) {
      res.status(400).json({ error: 'Missing required field: pageUrl' });
      return;
    }

    if (eventName !== 'ViewContent' && !phone) {
      res.status(400).json({ error: 'phone is required for Contact/Lead events' });
      return;
    }

    const hashedPhone = sha256(phone);

    const payload = {
      event_source: 'web',
      event_source_id: TIKTOK_PIXEL_CODE,
      data: [
        {
          event: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          user: {
            phone_number: hashedPhone || undefined,
            email: sha256(email) || undefined,
            external_id: hashedPhone || undefined,
            ip: ip || undefined,
            user_agent: userAgent || undefined,
            ttclid: ttclid || undefined,
            ttp: ttp || undefined,
          },
          page: {
            url: pageUrl,
          },
          properties: {
            content_id: contentName ? `lead_form_${contentName}` : 'lead_form',
            content_name: contentName || undefined,
          },
        },
      ],
    };

    if (TIKTOK_TEST_EVENT_CODE) {
      payload.test_event_code = TIKTOK_TEST_EVENT_CODE;
    }

    const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': TIKTOK_ACCESS_TOKEN,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (result.code !== 0) {
      console.error(`TikTok CAPI error [${eventName}]:`, result);
      res.status(502).json({ error: 'TikTok CAPI rejected event', details: result });
      return;
    }

    console.log(`TikTok CAPI success [${eventName}]:`, JSON.stringify(result));
    res.status(200).json({ success: true, tiktokResponse: result });
  } catch (err) {
    console.error('TikTok CAPI handler error:', err);
    res.status(500).json({ error: 'Internal error', details: err.message });
  }
};
