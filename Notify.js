export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { playerIds, title, message, icon } = req.body;
  if (!playerIds?.length) return res.status(400).json({ error: 'No playerIds' });

  try {
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${process.env.ONESIGNAL_REST_KEY}`
      },
      body: JSON.stringify({
        app_id: '170c02fd-b728-4181-a84e-79094708c3df',
        include_player_ids: playerIds,
        headings: { en: title },
        contents: { en: message },
        small_icon: 'notification_icon',
        large_icon: icon || '',
        chrome_web_icon: icon || 'https://raw.githubusercontent.com/epicactsuperplayer/ByteChat/main/Bytestorm%20Logo.png',
        firefox_icon: icon || 'https://raw.githubusercontent.com/epicactsuperplayer/ByteChat/main/Bytestorm%20Logo.png',
        url: 'https://bytestormchat.vercel.app',
        web_url: 'https://bytestormchat.vercel.app',
        data: { url: 'https://bytestormchat.vercel.app' }
      })
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
