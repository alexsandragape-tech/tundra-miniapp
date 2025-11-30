// 🔶 МОДУЛЬ ЛОЯЛЬНОСТИ: чистые функции без изменения поведения API
const { PurchaseHistoryDB, OrdersDB } = require('../database');

async function updateClientLoyalty(order, logger) {
    try {
        logger?.info && logger.info('🔥 ЛОЯЛЬНОСТЬ: Начало обработки заказа для лояльности:', {
            orderId: order.id,
            telegramUserId: order.telegramUserId,
            totalsTotal: order.totals?.total
        });

        if (!order.telegramUserId || !order.totals?.total) {
            logger?.warn && logger.warn('⚠️ Не удалось обновить лояльность: нет telegramUserId или суммы заказа', {
                telegramUserId: order.telegramUserId,
                totalsTotal: order.totals?.total
            });
            return;
        }

        const userId = order.telegramUserId;
        const existingPurchase = await PurchaseHistoryDB.getByOrderId(order.id);
        if (existingPurchase) return; // уже есть

        await PurchaseHistoryDB.add({ orderId: order.id, userId, amount: order.totals.total, purchaseDate: new Date() });
    } catch (error) {
        logger?.error && logger.error('❌ Ошибка обновления лояльности:', error.message);
    }
}

async function getLoyaltyStats(userId) {
    const stats = await PurchaseHistoryDB.getUserStats(userId);
    return stats;
}

function getDiscountPercent(totalSpent = 0) {
    if (totalSpent >= 50000) return 10;
    if (totalSpent >= 25000) return 5;
    if (totalSpent >= 10000) return 3;
    return 0;
}

async function migrateOldOrdersToLoyalty(userId, logger) {
    const orders = userId ? await OrdersDB.getByUserId(userId) : await OrdersDB.getAll();
    const completedOrders = orders.filter(order =>
        (order.payment_status === 'paid' || order.payment_id) &&
        (order.status === 'completed' || order.status === 'delivered') &&
        order.user_id && order.user_id !== 'unknown' &&
        order.total_amount && order.total_amount > 0
    );
    let migrated = 0, skipped = 0;
    for (const order of completedOrders) {
        const exists = await PurchaseHistoryDB.getByOrderId(order.order_id);
        if (exists) { skipped++; continue; }
        await PurchaseHistoryDB.add({ orderId: order.order_id, userId: order.user_id, amount: order.total_amount });
        migrated++;
    }
    return { migrated, skipped };
}

module.exports = {
    updateClientLoyalty,
    getLoyaltyStats,
    getDiscountPercent,
    migrateOldOrdersToLoyalty
};


