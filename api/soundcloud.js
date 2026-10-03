const axios = require('axios');

async function resolveSoundCloudUrl(rawUrl) {
    if (!rawUrl.includes('on.soundcloud.com')) {
        return rawUrl;
    }

    try {
        const res = await axios.get(rawUrl, {
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
            },
            validateStatus: (status) => status >= 200 && status < 400
        });

        const finalUrl = res.request?.res?.responseUrl || res.config?.url;
        return finalUrl || rawUrl;
    } catch (e) {
        return rawUrl;
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    let targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ status: false, message: 'Parameter url wajib disertakan.' });
    }

    try {
        targetUrl = await resolveSoundCloudUrl(targetUrl);

        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
        let cookies = [];

        const updateCookies = (response) => {
            const setCookie = response.headers['set-cookie'] || [];
            setCookie.forEach((c) => {
                const val = c.split(';')[0];
                if (val) cookies.push(val);
            });
        };

        const getCookieHeader = () => cookies.join('; ');

        const tokenRes = await axios.get('https://www.klickaud.org/csrf-token-endpoint.php', {
            headers: {
                'User-Agent': ua,
                Referer: 'https://www.klickaud.org/en17/',
                Accept: 'application/json',
            },
            timeout: 10000,
        });
        updateCookies(tokenRes);

        const csrfToken = tokenRes.data?.csrf_token;
        if (!csrfToken) {
            return res.status(502).json({ status: false, message: 'Gagal mengambil CSRF token Klickaud.' });
        }

        const params = new URLSearchParams();
        params.append('value', targetUrl);
        params.append('csrf_token', csrfToken);

        const postRes = await axios.post('https://www.klickaud.org/download.php', params.toString(), {
            headers: {
                'User-Agent': ua,
                Referer: 'https://www.klickaud.org/en17/',
                Origin: 'https://www.klickaud.org',
                'Content-Type': 'application/x-www-form-urlencoded',
                Cookie: getCookieHeader(),
            },
            timeout: 15000,
        });
        updateCookies(postRes);

        const html = postRes.data || '';
        const downloadMode = (html.match(/name="download_mode"\s+value="([^"]+)"/i) || [])[1] || '';
        const step2 = (html.match(/name="step2"\s+value="([^"]+)"/i) || [])[1] || '';
        const titleMatch = html.match(/<td[^>]*>Title:<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
        const title = titleMatch ? titleMatch[1].trim() : 'SoundCloud Track';

        const thumbMatch = html.match(/<img[^>]+src="([^">]+\.(?:jpg|jpeg|png))"/i);
        const thumbnail = thumbMatch ? thumbMatch[1] : '';

        if (!downloadMode || !step2) {
            return res.status(502).json({ status: false, message: 'Gagal mengekstrak step2 download token. Pastikan link lagu masih aktif dan publik.' });
        }

        await axios.get('https://www.klickaud.org/sse_capability.php?mode=sse', {
            headers: {
                'User-Agent': ua,
                Referer: 'https://www.klickaud.org/en17/',
                Cookie: getCookieHeader(),
            },
            timeout: 8000,
        }).catch(() => {});

        const workerUrl = `https://www.klickaud.org/worker_sse.php?step2=${encodeURIComponent(step2)}&download_mode=${encodeURIComponent(downloadMode)}`;
        const workerRes = await axios.get(workerUrl, {
            headers: {
                'User-Agent': ua,
                Referer: 'https://www.klickaud.org/en17/',
                Accept: 'text/event-stream',
                Cookie: getCookieHeader(),
            },
            timeout: 25000,
            responseType: 'text',
        });

        const sseText = workerRes.data || '';
        const downloadMatch = sseText.match(/"download_url":"([^"]+)"/i) || sseText.match(/download_url\s*:\s*"([^"]+)"/i);
        let downloadUrl = downloadMatch ? downloadMatch[1].replace(/\\/g, '') : null;

        if (!downloadUrl) {
            const genericUrlMatch = sseText.match(/https?:\/\/[^\s"']+\.mp3[^\s"']*/i);
            if (genericUrlMatch) downloadUrl = genericUrlMatch[0];
        }

        if (!downloadUrl) {
            return res.status(502).json({ status: false, message: 'URL stream MP3 tidak ditemukan.' });
        }

        return res.status(200).json({
            status: true,
            title: title,
            thumbnail: thumbnail,
            quality: '128 kbps (MP3)',
            download_url: downloadUrl
        });

    } catch (err) {
        return res.status(500).json({
            status: false,
            message: err.message || 'Server error saat memproses audio SoundCloud.'
        });
    }
};
