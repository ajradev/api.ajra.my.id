const AXIOS = require('axios');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const BASE_KLICKAUD = 'https://www.klickaud.org';

async function RESOLVE_SC_URL(url) {
    if (!url.includes('on.soundcloud.com')) return url;

    try {
        const res = await AXIOS.get(url, {
            maxRedirects: 0,
            validateStatus: (s) => s >= 200 && s < 400,
            headers: { 'User-Agent': USER_AGENT }
        });

        if (res.headers['location']) {
            return res.headers['location'].split('?')[0];
        };

        const html = res.data || '';
        const match = html.match(/<meta\s+property="(?:og:url|al:web:url)"\s+content="([^"]+)"/i);
        return match ? match[1].split('?')[0] : url;
    } catch (err) {
        const loc = err.response?.headers?.location;
        return loc ? loc.split('?')[0] : url;
    }
};

function CLEAN_TITLE(raw) {
    return raw.replace(/_(?:KLICKAUD|forhub_soundcloud_to_mp3)\.mp3$/i, '').replace(/\.mp3$/i, '').replace(/_/g, ' ').trim();
};

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const RAW_URL = req.query.url;
    if (!RAW_URL) {
        return res.status(400).json({ status: false, message: 'Parameter query url wajib disertakan.' });
    };

    try {
        const TARGET_URL = await RESOLVE_SC_URL(RAW_URL);
        const COOKIES = [];

        const UPDATE_COOKIES = (response) => {
            (response.headers['set-cookie'] || []).forEach((c) => {
                const val = c.split(';')[0];
                if (val) COOKIES.push(val);
            })
        };

        const GET_COOKIE = () => COOKIES.join('; ');

        const TOKEN_RES = await AXIOS.get(`${BASE_KLICKAUD}/csrf-token-endpoint.php`, {
            headers: { 'User-Agent': USER_AGENT, Referer: `${BASE_KLICKAUD}/en17/`, Accept: 'application/json' },
            timeout: 10000
        });

        UPDATE_COOKIES(TOKEN_RES);

        const CSRF_TOKEN = TOKEN_RES.data?.csrf_token;
        if (!CSRF_TOKEN) {
            return res.status(502).json({ status: false, message: 'Gagal mengambil CSRF token Klickaud.' });
        };

        const PARAMS = new URLSearchParams({ value: TARGET_URL, csrf_token: CSRF_TOKEN });
        const POST_RES = await AXIOS.post(`${BASE_KLICKAUD}/download.php`, PARAMS.toString(), {
            headers: {
                'User-Agent': USER_AGENT,
                Referer: `${BASE_KLICKAUD}/en17/`,
                Origin: BASE_KLICKAUD,
                'Content-Type': 'application/x-www-form-urlencoded',
                Cookie: GET_COOKIE()
            },
            timeout: 15000
        });

        UPDATE_COOKIES(POST_RES);

        const HTML = POST_RES.data || '';
        const DOWNLOAD_MODE = (HTML.match(/const\s+downloadMode\s*=\s*["']([^"']+)["']/) || [])[1] || '';
        const DIRECT_URL = (HTML.match(/const\s+directDownloadUrl\s*=\s*["']([^"']*)["']/) || [])[1] || '';
        const DEFAULT_FILE = (HTML.match(/const\s+defaultFileName\s*=\s*["']([^"']+)["']/) || [])[1] || 'SoundCloud Track';
        const SSE_GRANT = (HTML.match(/const\s+sseGrant\s*=\s*["']([^"']+)["']/) || [])[1] || '';

        if (DOWNLOAD_MODE === 'direct' && DIRECT_URL) {
            return res.status(200).json({
                status: true,
                title: CLEAN_TITLE(DEFAULT_FILE),
                download_url: DIRECT_URL
            })
        };

        if (!SSE_GRANT) {
            return res.status(502).json({ status: false, message: 'Gagal mengambil session grant dari Klickaud.' });
        };

        const CAP_RES = await AXIOS.post(`${BASE_KLICKAUD}/sse_capability.php`, { grant: SSE_GRANT, url: TARGET_URL }, {
            headers: {
                'User-Agent': USER_AGENT,
                Referer: `${BASE_KLICKAUD}/download.php`,
                Origin: BASE_KLICKAUD,
                'Content-Type': 'application/json',
                Cookie: GET_COOKIE()
            },
            timeout: 10000
        });

        UPDATE_COOKIES(CAP_RES);

        const CAPABILITY = CAP_RES.data?.capability;
        if (!CAPABILITY) {
            return res.status(502).json({ status: false, message: 'Gagal mengotorisasi capability download.' });
        };

        const SSE_URL = `${BASE_KLICKAUD}/worker_sse.php?url=${encodeURIComponent(TARGET_URL)}&cap=${encodeURIComponent(CAPABILITY)}`;
        const WORKER_RES = await AXIOS.get(SSE_URL, {
            headers: {
                'User-Agent': USER_AGENT,
                Referer: `${BASE_KLICKAUD}/download.php`,
                Cookie: GET_COOKIE(),
                Accept: 'text/event-stream'
            },
            timeout: 30000,
            responseType: 'text'
        });

        const SSE_TEXT = WORKER_RES.data || '';
        let FINAL_DOWNLOAD_URL = null;
        let FINAL_TITLE = CLEAN_TITLE(DEFAULT_FILE);

        const READY_MATCH = SSE_TEXT.match(/event:\s*ready\s+data:\s*({.+})/);
        if (READY_MATCH) {
            try {
                const PARSED = JSON.parse(READY_MATCH[1]);
                FINAL_DOWNLOAD_URL = PARSED.download_url;
                if (PARSED.file_name) FINAL_TITLE = CLEAN_TITLE(PARSED.file_name);
            } catch (e) {}
        };

        if (!FINAL_DOWNLOAD_URL) {
            const FALLBACK = SSE_TEXT.match(/"download_url":"([^"]+)"/i);
            if (FALLBACK) FINAL_DOWNLOAD_URL = FALLBACK[1].replace(/\\/g, '');
        };

        if (!FINAL_DOWNLOAD_URL) {
            return res.status(502).json({ status: false, message: 'URL download MP3 tidak ditemukan di worker stream.' });
        };

        return res.status(200).json({
            status: true,
            title: FINAL_TITLE,
            download_url: FINAL_DOWNLOAD_URL
        })
    } catch (err) {
        return res.status(500).json({
            status: false,
            message: err.message || 'Server error saat memproses link SoundCloud.'
        })
    }
};
