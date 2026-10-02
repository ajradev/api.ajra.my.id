export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'Query parameter ?url= wajib diisi' });
    }

    try {
        const upstreamRes = await fetch(`https://cutefish.my.id/api/tiktok-fps?url=${encodeURIComponent(url)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!upstreamRes.ok) {
            throw new Error(`Upstream error ${upstreamRes.status}`);
        }

        const data = await upstreamRes.json();
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({
        error: 'Gagal mengambil metadata video',
        details: error.message
        });
    }
}
