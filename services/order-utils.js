// 🧭 Утилиты заказов: мапперы и фильтры без изменения поведения

// Используем глобальный logger если доступен, чтобы не терять предупреждения
const log = global.logger || { warn: () => {} };

function safeParseJson(value, fallback, what) {
    try {
        if (value == null) return fallback;
        return typeof value === 'string' ? JSON.parse(value) : (value || fallback);
    } catch (e) {
        try { log.warn('⚠️ Ошибка парсинга ' + what + ' в mapDbOrderToApi:', e.message); } catch (_) {}
        return fallback;
    }
}

function mapDbOrderToApi(dbOrder) {
    if (!dbOrder) return null;
    const promoData = safeParseJson(dbOrder.promo_data, null, 'promo_data');
    return {
        id: dbOrder.order_id || dbOrder.id || dbOrder.orderId,
        status: dbOrder.status,
        paymentStatus: dbOrder.payment_status || dbOrder.paymentStatus,
        totals: {
            total: parseFloat(dbOrder.total_amount || dbOrder.totalAmount || 0),
            promoDiscount: dbOrder.promo_discount || 0,
            promoCode: dbOrder.promo_code || null
        },
        items: safeParseJson(dbOrder.items, [], 'items'),
        address: safeParseJson(dbOrder.address, {}, 'address'),
        phone: dbOrder.phone,
        customerName: dbOrder.user_name || dbOrder.customerName,
        createdAt: dbOrder.created_at || dbOrder.createdAt,
        payment_id: dbOrder.payment_id || dbOrder.paymentId,
        telegramUserId: dbOrder.user_id || dbOrder.telegramUserId,
        appliedPromo: promoData
    };
}

function mapDbOrderToList(dbOrder) {
    return {
        order_id: dbOrder.order_id,
        amount: dbOrder.total_amount || dbOrder.totalAmount || 0,
        purchase_date: dbOrder.created_at || dbOrder.createdAt,
        items: dbOrder.items || [],
        status: dbOrder.status,
        payment_status: dbOrder.payment_status
    };
}

function isOrderCompletedOrPaid(order) {
    return (
        order.payment_status === 'paid' ||
        order.status === 'completed' ||
        order.status === 'delivered' ||
        order.status === 'accepted' ||
        (order.payment_id && order.payment_id !== '')
    );
}

module.exports = { mapDbOrderToApi, mapDbOrderToList, isOrderCompletedOrPaid };


