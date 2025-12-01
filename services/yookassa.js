// 💳 МОДУЛЬ YOOKASSA: инициализация и создание платежа (без изменения логики)
const crypto = require('crypto');
const axios = require('axios');
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
        const response = await axios.post(url, paymentData, { headers, auth, timeout: 30000 });
        return response.data;
    }

    async getPayment(paymentId) {
        const auth = {
            username: this.shopId,
            password: this.secretKey
        };
        const url = `${this.baseURL}/payments/${paymentId}`;
        const response = await axios.get(url, { auth, timeout: 20000 });
        return response.data;
    }
}

let checkout = null;

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
    const formattedPhone = formatPhoneForYooKassa(customerInfo.phone);
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
    const idempotenceKey = crypto.randomUUID();
    try {
        const payment = await checkout.createPayment(fullPaymentData, idempotenceKey);
        return payment;
    } catch (error) {
        // Автоматический дауншифт до минимального payload
        if (error.response && [400, 403].includes(error.response.status)) {
            const payment = await checkout.createPayment(minimalPaymentData, crypto.randomUUID());
            return payment;
        }
        throw error;
    }
}

module.exports = {
    initYooKassa,
    createYooKassaPayment,
    formatPhoneForYooKassa,
};


