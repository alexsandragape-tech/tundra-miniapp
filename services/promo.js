const { PromoCodesDB } = require('../database');

const SUPPORTED_TYPES = new Set(['percent', 'fixed', 'free_delivery']);

function normalizeCode(code = '') {
    return code.trim().toUpperCase();
}

function mapPromoRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        code: row.code,
        discountType: row.discount_type,
        discountValue: row.discount_value,
        description: row.description,
        isActive: row.is_active,
        maxPerUser: row.max_per_user,
        startsAt: row.starts_at,
        expiresAt: row.expires_at,
        usageCount: row.usage_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function calculateDiscountAmount(promo, subtotal) {
    if (!promo || subtotal <= 0) {
        return { amount: 0, appliesToDelivery: false };
    }

    const type = promo.discountType;
    const value = promo.discountValue;

    if (type === 'percent') {
        const percent = Math.max(0, Math.min(value, 100));
        const amount = Math.floor((subtotal * percent) / 100);
        return { amount, appliesToDelivery: false };
    }

    if (type === 'fixed') {
        const amount = Math.max(0, Math.min(value, subtotal));
        return { amount, appliesToDelivery: false };
    }

    if (type === 'free_delivery') {
        // Логика доставки будет решаться на клиенте/сервере отдельно,
        // здесь возвращаем 0 чтобы не менять стоимость товаров.
        return { amount: 0, appliesToDelivery: true };
    }

    return { amount: 0, appliesToDelivery: false };
}

async function getPromoByCode(code) {
    if (!code) return null;
    const normalized = normalizeCode(code);
    const row = await PromoCodesDB.getByCode(normalized);
    return mapPromoRow(row);
}

function isPromoActive(promo) {
    if (!promo) return { ok: false, reason: 'not_found' };
    if (!SUPPORTED_TYPES.has(promo.discountType)) {
        return { ok: false, reason: 'unsupported_type' };
    }
    if (!promo.isActive) {
        return { ok: false, reason: 'inactive' };
    }

    const now = new Date();
    if (promo.startsAt && now < promo.startsAt) {
        return { ok: false, reason: 'not_started' };
    }
    if (promo.expiresAt && now > promo.expiresAt) {
        return { ok: false, reason: 'expired' };
    }

    return { ok: true };
}

async function validatePromoCode({ code, userId, subtotal }) {
    const normalized = normalizeCode(code);
    const promo = await getPromoByCode(normalized);

    const activeCheck = isPromoActive(promo);
    if (!activeCheck.ok) {
        return {
            ok: false,
            reason: activeCheck.reason,
            promo: promo || null
        };
    }

    if (!userId) {
        return { ok: false, reason: 'missing_user', promo };
    }

    const usageRow = await PromoCodesDB.getUsage(promo.id, userId);
    const usageCount = usageRow?.usage_count || 0;

    if (promo.maxPerUser !== null && promo.maxPerUser >= 0) {
        if (usageCount >= promo.maxPerUser) {
            return { ok: false, reason: 'usage_limit_reached', promo };
        }
    }

    const discount = calculateDiscountAmount(promo, subtotal);

    return {
        ok: true,
        promo,
        usageCount,
        remainingUses: promo.maxPerUser !== null && promo.maxPerUser >= 0
            ? Math.max(0, promo.maxPerUser - (usageCount + 1))
            : null,
        discount
    };
}

async function registerPromoUsage({ promoId, userId, increment = 1 }) {
    if (!promoId || !userId) return null;
    const usage = await PromoCodesDB.incrementUsage(promoId, userId, increment);
    return usage;
}

module.exports = {
    normalizeCode,
    getPromoByCode,
    validatePromoCode,
    calculateDiscountAmount,
    registerPromoUsage,
    mapPromoRow,
    SUPPORTED_TYPES
};

