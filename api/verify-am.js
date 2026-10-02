const CFG_KEY = 'AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0';
const CFG_IDT = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty';
const CFG_VFY = 'https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase';

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 10;
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

function spoofIP(headers) {
    const ip = randomIP();
    return {
        ...headers,
        'x-forwarded-for': ip,
        'x-real-ip': ip,
        'client-ip': ip,
        'x-client-ip': ip,
        'x-originating-ip': ip,
        'x-cluster-client-ip': ip
    };
};

function buildHeaders() {
    return spoofIP({
        'content-type': 'application/json',
        'x-android-package': 'com.alightcreative.motion',
        'x-android-cert': 'ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8',
        'user-agent': 'dalvik/2.1.0 (linux; u; android 15; 23127pn0cc build/bp1a.250505.005)'
    });
};

async function fetchJSON(url, options, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
        response = await fetch(url, { ...options, signal: controller.signal });
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

    return await fetchJSON(url, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(payload)
    });
};

async function verifyAndGetToken(email, oobCode) {
    const urlAuth = `${CFG_IDT}/emailLinkSignin?key=${CFG_KEY}`;
    const payload = {
        email: email,
        oobCode: oobCode,
        clientType: 'CLIENT_TYPE_ANDROID'
    };

    const authData = await fetchJSON(urlAuth, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(payload)
    });

    if (!authData.idToken) {
        throw new Error('idToken tidak ditemukan di response login');
    };

    return {
        idToken: authData.idToken,
        refreshToken: authData.refreshToken,
        localId: authData.localId,
        isNewUser: authData.isNewUser
    };
};

async function promoteToPremium(idToken) {
    const randomHex = () => {
        const bytes = new Uint8Array(6);
        crypto.getRandomValues(bytes);
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    const orderId = 'neo-' + randomHex();

    const payload = {
        data: {
            productId: 'am.full.sub.annual.19q4',
            token: 'mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw',
            skuType: 'subs',
            orderId: orderId
        }
    };

    const headers = spoofIP({
        'content-type': 'application/json; charset=utf-8',
        'user-agent': 'okhttp/3.12.1',
        'accept-encoding': 'gzip',
        'authorization': 'Bearer ' + idToken,
        'firebase-instance-id-token': 'cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI'
    });

    const result = await fetchJSON(CFG_VFY, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
    });

    return { orderId, result };
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
        });
    };

    const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

    if (!checkRateLimit(clientIP)) {
        return res.status(429).json({
            status: false,
            error: 'Terlalu banyak request. Coba lagi dalam 1 menit.'
        });
    };

    let body = req.body || {};
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = {};
        };
    };

    const action = (body.action || 'send').trim();

    try {
        if (action === 'verif') {
            const email = (body.email || '').trim();
            const code = (body.code || '').trim();

            if (!email || !code) {
                return res.status(400).json({
                    status: false,
                    error: 'Parameter "email" dan "code" wajib diisi.'
                });
            };

            const tokenData = await verifyAndGetToken(email, code);

            return res.status(200).json({
                status: true,
                message: 'Login berhasil.',
                email: email,
                idToken: tokenData.idToken,
                refreshToken: tokenData.refreshToken,
                uid: tokenData.localId,
                isNewUser: tokenData.isNewUser
            });
        };

        if (action === 'promote') {
            const idToken = (body.idToken || '').trim();

            if (!idToken) {
                return res.status(400).json({
                    status: false,
                    error: 'Parameter "idToken" wajib diisi.'
                });
            };

            const promoResult = await promoteToPremium(idToken);

            return res.status(200).json({
                status: true,
                message: 'Akun berhasil dipremium.',
                orderId: promoResult.orderId,
                data: promoResult.result
            });
        };

        const email = (body.email || '').trim();
        if (!email) {
            return res.status(400).json({
                status: false,
                error: 'Parameter "email" wajib diisi.'
            });
        };

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                status: false,
                error: 'Format email tidak valid.'
            });
        };

        const result = await sendLoginLink(email);

        return res.status(200).json({
            status: true,
            message: 'Link login berhasil dikirim.',
            email: email,
            data: result
        });
    } catch (err) {
        return res.status(500).json({
            status: false,
            error: err.message
        });
    };
};
