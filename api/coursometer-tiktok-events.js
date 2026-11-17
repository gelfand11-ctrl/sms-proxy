// /api/coursometer-tiktok-events.js
// TikTok Events API endpoint - Coursometer only.
// psychometric (default): same pixel, token and test code as before.
// bagrut: uses TIKTOK_PIXEL_CODE_COURSOMETER_BAGRUT + TIKTOK_EVENTS_TOKEN_COURSOMETER_BAGRUT
//         (optional TIKTOK_TEST_EVENT_CODE_COURSOMETER_BAGRUT).
//         If pixel code or token is missing, the event is skipped (never sent to the psychometric pixel).
const crypto = require('crypto');

const PIXEL_CODE = 'DBJR0HBC77U0QK5QEBF0';
const TOKEN = process.env.TIKTOK_EVENTS_TOKEN_COURSOMETER;
const TEST_EVENT_CODE = process.env.TIKTOK_TEST_EVENT_CODE_COURSOMETER;
const BAGRUT_PIXEL_CODE = process.env.TIKTOK_PIXEL_CODE_COURSOMETER_BAGRUT;
const BAGRUT_TOKEN = process.env.TIKTOK_EVENTS_TOKEN_COURSOMETER_BAGRUT;
const BAGRUT_TEST_EVENT_CODE = process.env.TIKTOK_TEST_EVENT_CODE_COURSOMETER_BAGRUT;
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

  try {
    let body = req.body || {};
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body || '{}');
      } catch {
        body = {};
      }
    }

    const isBagrut = body.vertical === 'bagrut';

    let pixelCode;
    let token;
    let testEventCode;
    if (isBagrut) {
      if (!BAGRUT_PIXEL_CODE || !BAGRUT_TOKEN) {
        console.log('Coursometer TikTok: bagrut pixel not configured, event skipped');
        res.status(200).json({ skipped: true });
        return;
      }
      pixelCode = BAGRUT_PIXEL_CODE;
      token = BAGRUT_TOKEN;
      testEventCode = BAGRUT_TEST_EVENT_CODE;
    } else {
      if (!TOKEN) {
        console.error('Coursometer TikTok: missing TIKTOK_EVENTS_TOKEN_COURSOMETER');
        res.status(500).json({ error: 'Server not configured' });
        return;
      }
      pixelCode = PIXEL_CODE;
      token = TOKEN;
      testEventCode = TEST_EVENT_CODE;
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

    const contentId = isBagrut ? 'bagrut' : 'psychometric';

    const payload = {
      event_source: 'web',
      event_source_id: pixelCode,
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
              { content_id: contentId, content_name: contentId + '_course' },
            ],
          },
        },
      ],
    };
    if (testEventCode) payload.test_event_code = testEventCode;

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': token,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.code !== 0) {
      console.error(`Coursometer TikTok error [${contentId}] [${eventName}]:`, JSON.stringify(result));
      res.status(502).json({ error: 'TikTok rejected event', details: result });
      return;
    }

    console.log(`Coursometer TikTok success [${contentId}] [${eventName}]:`, JSON.stringify(result));
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Coursometer TikTok handler error:', err);
    res.status(500).json({ error: 'Internal error', details: err.message });
  }
};
