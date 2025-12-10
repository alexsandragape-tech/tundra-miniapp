// 💳 МОДУЛЬ YOOKASSA: инициализация и создание платежа (без изменения логики)
const crypto = require('crypto');
const axios = require('axios');
const https = require('https');
const dns = require('dns');
const config = require('../config');

// Логгер ожидается из глобальной области server.js. На случай прямого импорта используем консоль.
const log = global.logger || {
    error: console.error,
    warn: console.warn,
    info: console.log,
    debug: console.log,
};

class YooKassaAPI {
    constructor(shopId, secretKey) {
        this.shopId = shopId;
        this.secretKey = secretKey;
        this.baseURL = 'https://api.yookassa.ru/v3';
        this.agent = new https.Agent({
            keepAlive: true,
            lookup: (hostname, options, callback) => {
                return dns.lookup(
                    hostname,
                    { ...options, family: 4, all: false },
                    callback
                );
            }
        });
        log.info('💳 YooKassa API инициализирована');
    }
    async createPayment(paymentData, idempotenceKey) {
        const headers = {
            'Idempotence-Key': idempotenceKey,
            'Content-Type': 'application/json'
        };
        const auth = {
            username: this.shopId,
            password: this.secretKey
        };
        const url = `${this.baseURL}/payments`;
        const response = await axios.post(url, paymentData, {
            headers,
            auth,
            timeout: 30000,
            httpsAgent: this.agent,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        return response.data;
    }

    async getPayment(paymentId) {
        const auth = {
            username: this.shopId,
            password: this.secretKey
        };
        const url = `${this.baseURL}/payments/${paymentId}`;
        const response = await axios.get(url, {
            auth,
            timeout: 20000,
            httpsAgent: this.agent
        });
        return response.data;
    }
}

let checkout = null;

const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error) {
    if (!error) return false;
    if (error.code === 'ECONNABORTED') return true;
    if (!error.response) return true; // сетевые ошибки без ответа
    return RETRYABLE_HTTP_STATUSES.has(error.response.status);
}

async function createPaymentWithRetry(paymentData, { attempts = 2, baseDelay = 1000, idempotenceKey: providedIdempotenceKey } = {}) {
    const totalAttempts = Math.max(1, attempts);
    let attempt = 0;
    let lastError = null;
    const idempotenceKey = providedIdempotenceKey || crypto.randomUUID();

    while (attempt < totalAttempts) {
        try {
            return await checkout.createPayment(paymentData, idempotenceKey);
        } catch (error) {
            lastError = error;
            attempt += 1;
            const canRetry = isRetryableError(error) && attempt < totalAttempts;
            log.warn(`⚠️ Ошибка создания платежа (попытка ${attempt} из ${totalAttempts}): ${error.message}`);

            if (!canRetry) {
                throw error;
            }

            const waitMs = Math.max(0, baseDelay) * attempt;
            if (waitMs > 0) {
                log.info(`⏳ Повторная попытка создания платежа через ${waitMs} мс`);
                await delay(waitMs);
            }
        }
    }

    throw lastError;
}

function formatPhoneForYooKassa(phone) {
    if (!phone) return '+79000000000';
    const digits = phone.toString().replace(/\D/g, '');
    if (digits.startsWith('8')) return '+7' + digits.slice(1);
    if (digits.startsWith('7')) return '+7' + digits.slice(1);
    if (digits.length === 10) return '+7' + digits;
    return '+' + digits;
}

async function initYooKassa() {
    if (!config.YOOKASSA_SHOP_ID || !config.YOOKASSA_SECRET_KEY) {
        log.warn('⚠️ ЮKassa ключи не заданы. Инициализация пропущена.');
        return null;
    }
    checkout = new YooKassaAPI(config.YOOKASSA_SHOP_ID, config.YOOKASSA_SECRET_KEY);
    return checkout;
}

async function createYooKassaPayment(orderId, amount, description, customerInfo, returnUrl) {
    if (!checkout) await initYooKassa();
    // Если URL возврата не передан, формируем из конфигурации
    if (!returnUrl) {
        const base = config.FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
        returnUrl = `${base.replace(/\/$/, '')}/payment-success?orderId=${orderId}`;
    }
    // Нормализуем IP, иначе не отправляем его вовсе, чтобы избежать "Invalid IP"
    const normalizeClientIp = (ip) => {
        if (!ip) return null;
        const str = String(ip).trim();
        const parts = str.split('.');
        if (parts.length !== 4) return null;
        for (const part of parts) {
            if (!/^\d+$/.test(part)) return null;
            const num = Number(part);
            if (num < 0 || num > 255) return null;
        }
        return parts.map(p => String(Number(p))).join('.');
    };
    // Берём IP из запроса, если он валиден, иначе ставим дефолт
    const clientIp = normalizeClientIp(customerInfo?.clientIp) || '95.31.18.119';
    const formattedPhone = formatPhoneForYooKassa(customerInfo.phone);
    // Логируем ключевые поля (без секретов)
    log.info('YK payload debug', {
        orderId,
        clientIp,
        amount: amount.toFixed(2),
        description
    });
    const fullPaymentData = {
        amount: { value: amount.toFixed(2), currency: 'RUB' },
        confirmation: { type: 'redirect', return_url: returnUrl },
        capture: true,
        description,
        receipt: {
            customer: { email: customerInfo.email || 'customer@example.com', phone: formattedPhone },
            items: [{ description, quantity: '1', amount: { value: amount.toFixed(2), currency: 'RUB' }, vat_code: 1, payment_mode: 'full_payment', payment_subject: 'commodity' }]
        },
        metadata: { orderId, customerName: customerInfo.customerName || 'Клиент', phone: customerInfo.phone || '' }
    };
    const minimalPaymentData = {
        amount: { value: amount.toFixed(2), currency: 'RUB' },
        confirmation: { type: 'redirect', return_url: returnUrl },
        capture: true,
        description,
        metadata: { orderId }
    };
    if (clientIp) {
        fullPaymentData.client_ip = clientIp;
        minimalPaymentData.client_ip = clientIp;
    }
    try {
        return await createPaymentWithRetry(fullPaymentData, { attempts: 2, baseDelay: 1200 });
    } catch (error) {
        if (error.response && [400, 403].includes(error.response.status)) {
            log.warn(`⚠️ YooKassa отклонила расширенный чек (статус ${error.response.status}). Пробуем упрощённые данные.`);
            return await createPaymentWithRetry(minimalPaymentData, { attempts: 1 });
        }
        if (isRetryableError(error)) {
            log.warn(`⚠️ Ошибка сети/таймаут при создании платежа: ${error.message}. Пробуем упрощённый payload.`);
            return await createPaymentWithRetry(minimalPaymentData, { attempts: 2, baseDelay: 1500 });
        }
        throw error;
    }
}

module.exports = {
    initYooKassa,
    createYooKassaPayment,
    formatPhoneForYooKassa,
};
