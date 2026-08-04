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
  test_event_code: 'TEST83201', // TEMPORARY — remove after testing
};
