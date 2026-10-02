const CFG_KEY = 'AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0';
const CFG_IDT = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty';

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

    const response = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(payload)
    });

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
