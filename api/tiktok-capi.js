// /api/tiktok-capi.js
// Server-side TikTok Events API (CAPI) endpoint.
// Call this from Zapier (or directly from your sms-proxy flow) AFTER
// phone verification succeeds, using the SAME event_id sent client-side
// via ttq.track() for proper deduplication.

const crypto = require('crypto');

const TIKTOK_PIXEL_CODE = process.env.TIKTOK_PIXEL_CODE;       // your pixel_code
const TIKTOK_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;   // generated in Pixel Settings
const TIKTOK_TEST_EVENT_CODE = process.env.TIKTOK_TEST_EVENT_CODE || null; // only during testing

function sha256(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

module.exports = async (req, res) => {
  // CORS headers — required for the browser to call this from compisrael.com
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Browsers send an OPTIONS preflight before the real POST — must return 200, not 405
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
      eventId,        // same ID used in client-side ttq.track() for dedup
      phone,           // E.164 format, e.g. +9725xxxxxxxx — optional for ViewContent
      email,           // optional, not currently collected
      pageUrl,         // landing page URL the lead came from
      ip,              // client IP (forward from request if available)
      userAgent,       // client user agent
      ttclid,          // TikTok click ID, if present in URL params on landing
      ttp,             // value of the _ttp first-party cookie (read client-side)
      contentName,     // 'dtp' | 'work' | 'medical'
      eventName = 'Lead', // 'ViewContent' | 'Contact' | 'Lead'
    } = req.body;

    if (!pageUrl) {
      res.status(400).json({ error: 'Missing required field: pageUrl' });
      return;
    }
    // Contact and Lead need a way to identify the person — ViewContent doesn't.
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
            external_id: hashedPhone || undefined, // reuse hashed phone as external_id
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
      console.error('TikTok CAPI error:', result);
      res.status(502).json({ error: 'TikTok CAPI rejected event', details: result });
      return;
    }

    console.log('TikTok CAPI success:', JSON.stringify(result));
    res.status(200).json({ success: true, tiktokResponse: result });
  } catch (err) {
    console.error('TikTok CAPI handler error:', err);
    res.status(500).json({ error: 'Internal error', details: err.message });
  }
};
