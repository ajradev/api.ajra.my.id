const CFG_KEY = 'AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0';
const CFG_IDT = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty';

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateLimitStore = new Map();

function checkRateLimit(ip) {
    const now = Date.now();
    const entry = rateLimitStore.get(ip);

    if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
        rateLimitStore.set(ip, { start: now, count: 1 });
        return true;
    };

    if (entry.count >= RATE_LIMIT_MAX) {
        return false;
    };

    entry.count++;
    return true;
}

function randomIP() {
    const oct = () => Math.floor(Math.random() * 254) + 1;
    return `${oct()}.${oct()}.${oct()}.${oct()}`;
};

function buildHeaders() {
    const ip = randomIP();
    return {
        'content-type': 'application/json',
        'x-android-package': 'com.alightcreative.motion',
        'x-android-cert': 'ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8',
        'user-agent': 'dalvik/2.1.0 (linux; u; android 15; 23127pn0cc build/bp1a.250505.005)',
        'x-forwarded-for': ip,
        'x-real-ip': ip,
        'client-ip': ip,
        'x-client-ip': ip,
        'x-originating-ip': ip,
        'x-cluster-client-ip': ip
    }
};

async function sendLoginLink(email) {
    const payload = {
        requestType: 6,
        email: email,
        androidInstallApp: true,
        canHandleCodeInApp: true,
        continueUrl: 'https://alightcreative.com?ui_sid=0366624874&ui_sd=0',
        iosBundleId: 'com.alightcreative.motion',
        androidPackageName: 'com.alightcreative.motion',
        androidMinimumVersion: '585',
        clientType: 'CLIENT_TYPE_ANDROID'
    };

    const url = `${CFG_IDT}/getOobConfirmationCode?key=${CFG_KEY}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify(payload),
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeoutId);
    }

    const text = await response.text();

    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        data = { raw: text };
    };

    if (!response.ok) {
        const msg = data?.error?.message || data?.error || 'Gagal menghubungi server';
        throw new Error(msg);
    };

    return data;
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    };

    if (req.method !== 'POST') {
        return res.status(405).json({
            status: false,
            error: 'Method not allowed. Gunakan POST.'
        })
    };

    const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

    if (!checkRateLimit(clientIP)) {
        return res.status(429).json({
            status: false,
            error: 'Terlalu banyak request. Coba lagi dalam 1 menit.'
        })
    };

    let body = req.body || {};
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = {};
        }
    };

    const email = (body.email || '').trim();
    if (!email) {
        return res.status(400).json({
            status: false,
            error: 'Parameter "email" wajib diisi.'
        })
    };

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            status: false,
            error: 'Format email tidak valid.'
        })
    };

    try {
        const result = await sendLoginLink(email);

        return res.status(200).json({
            status: true,
            message: 'Link login berhasil dikirim.',
            email: email,
            data: result
        })
    } catch (err) {
        return res.status(500).json({
            status: false,
            error: err.message
        })
    }
};
