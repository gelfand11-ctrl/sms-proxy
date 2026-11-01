// /api/coursometer-tiktok-events.js
// TikTok Events API endpoint - Coursometer only.
const crypto = require('crypto');

const PIXEL_CODE = 'DBJR0HBC77U0QK5QEBF0';
const TOKEN = process.env.TIKTOK_EVENTS_TOKEN_COURSOMETER;
const TEST_EVENT_CODE = process.env.TIKTOK_TEST_EVENT_CODE_COURSOMETER;
const ALLOWED_EVENTS = ['ViewContent', 'Contact', 'Lead'];
const ENDPOINT = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// TikTok expects E.164 (+972...) before hashing
function toE164(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return undefined;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('972')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  if (!/^5\d{8}$/.test(d)) return undefined;
  return '+972' + d;
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
  if (!TOKEN) {
    console.error('Coursometer TikTok: missing TIKTOK_EVENTS_TOKEN_COURSOMETER');
    res.status(500).json({ error: 'Server not configured' });
    return;
  }

  try {
    let body = req.body || {};
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body || '{}');
      } catch {
        body = {};
      }
    }

    const { eventName, eventId, phone, pageUrl, referrer, userAgent, ttclid, ttp } = body;

    if (!eventName || !ALLOWED_EVENTS.includes(eventName) || !pageUrl || !eventId) {
      res.status(400).json({ error: 'Missing or invalid fields' });
      return;
    }

    const ip =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.socket?.remoteAddress;

    const user = {
      ip: ip || undefined,
      user_agent: userAgent || req.headers['user-agent'] || undefined,
    };
    if (ttclid) user.ttclid = String(ttclid);
    if (ttp) user.ttp = String(ttp);

    const e164 = toE164(phone);
    if (e164) {
      const hashed = sha256(e164);
      user.phone = hashed;
      user.external_id = hashed;
    }

    const payload = {
      event_source: 'web',
      event_source_id: PIXEL_CODE,
      data: [
        {
          event: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: String(eventId),
          user,
          page: {
            url: pageUrl,
            referrer: referrer || undefined,
          },
          properties: {
            content_type: 'product',
            contents: [
              { content_id: 'psychometric', content_name: 'psychometric_course' },
            ],
          },
        },
      ],
    };
    if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': TOKEN,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.code !== 0) {
      console.error(`Coursometer TikTok error [${eventName}]:`, JSON.stringify(result));
      res.status(502).json({ error: 'TikTok rejected event', details: result });
      return;
    }

    console.log(`Coursometer TikTok success [${eventName}]:`, JSON.stringify(result));
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Coursometer TikTok handler error:', err);
    res.status(500).json({ error: 'Internal error', details: err.message });
  }
};
