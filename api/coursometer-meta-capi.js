// /api/coursometer-meta-capi.js
// Meta Conversions API endpoint - Coursometer only.
const crypto = require('crypto');

const PIXEL_ID = '1104022719046538';
const TOKEN = process.env.META_CAPI_TOKEN_COURSOMETER;
const ALLOWED_EVENTS = ['ViewContent', 'Contact', 'Lead'];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return undefined;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '972' + d.slice(1);
  else if (d.length === 9 && d.startsWith('5')) d = '972' + d;
  return d.startsWith('972') && d.length >= 11 ? d : undefined;
}

function buildFbc(fbc, fbclid) {
  if (fbc) return fbc;
  if (fbclid) return `fb.1.${Date.now()}.${fbclid}`;
  return undefined;
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
    console.error('Coursometer CAPI: missing META_CAPI_TOKEN_COURSOMETER');
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

    const {
      eventName,
      eventId,
      phone,
      pageUrl,
      userAgent,
      fbclid,
      fbc,
      fbp,
      customData,
    } = body;

    if (!eventName || !ALLOWED_EVENTS.includes(eventName) || !pageUrl) {
      res.status(400).json({ error: 'Missing or invalid fields' });
      return;
    }

    const ip =
      req.headers['x-forwarded-for']?.split(',')[0].trim() ||
      req.socket?.remoteAddress;

    const user_data = {
      client_ip_address: ip || undefined,
      client_user_agent: userAgent || req.headers['user-agent'] || undefined,
      fbc: buildFbc(fbc, fbclid),
      fbp: fbp || undefined,
      country: [sha256('il')],
    };

    const ph = normalizePhone(phone);
    if (ph) {
      const hashed = sha256(ph);
      user_data.ph = [hashed];
      user_data.external_id = [hashed];
    }

    const custom_data = {
      content_name: 'psychometric',
      content_category: 'psychometric_course',
    };
    if (customData && (customData.intent === 'high' || customData.intent === 'low')) {
      custom_data.intent = customData.intent;
    }

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId || undefined,
          event_source_url: pageUrl,
          action_source: 'website',
          user_data,
          custom_data,
        },
      ],
    };

    const response = await fetch(
      `https://graph.facebook.com/v23.0/${PIXEL_ID}/events?access_token=${TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    const result = await response.json();

    if (result.error) {
      console.error(`Coursometer CAPI error [${eventName}]:`, result.error);
      res.status(502).json({ error: 'Meta rejected event', details: result.error });
      return;
    }

    console.log(`Coursometer CAPI success [${eventName}]:`, JSON.stringify(result));
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Coursometer CAPI handler error:', err);
    res.status(500).json({ error: 'Internal error', details: err.message });
  }
};
