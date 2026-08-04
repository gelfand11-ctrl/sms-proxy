// /api/meta-capi.js
// Server-side Meta Conversions API (CAPI) endpoint.
const crypto = require('crypto');
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_CAPI_ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;

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
      eventName,
      eventId,
      phone,
      pageUrl,
      userAgent,
      ip,
      fbclid,
      fbc,
      fbp,
      contentName,
    } = req.body;

    if (!pageUrl || !eventName) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const finalIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const finalUserAgent = userAgent || req.headers['user-agent'];

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          event_source_url: pageUrl,
          action_source: 'website',
          user_data: {
            ph: sha256(phone),
            client_ip_address: finalIp || undefined,
            client_user_agent: finalUserAgent || undefined,
            fbc: fbc || undefined,
            fbp: fbp || undefined,
          },
          custom_data: {
            content_name: contentName || undefined,
            content_category: 'lead',
          },
        },
      ],
    };

    const response = await fetch(
      `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_CAPI_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();

    if (result.error) {
      console.error(`Meta CAPI error [${eventName}]:`, result.error);
      res.status(502).json({ error: 'Meta CAPI rejected event', details: result.error });
      return;
    }

    console.log(`Meta CAPI success [${eventName}]:`, JSON.stringify(result));
    res.status(200).json({ success: true, metaResponse: result });
  } catch (err) {
    console.error('Meta CAPI handler error:', err);
    res.status(500).json({ error: 'Internal error', details: err.message });
  }
};
