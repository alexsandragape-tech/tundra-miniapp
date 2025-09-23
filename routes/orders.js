// 📦 Роуты заказов. Без изменения контрактов ответов
const express = require('express');
const router = express.Router();

const { OrdersDB } = require('../database');
const { mapDbOrderToApi, mapDbOrderToList, isOrderCompletedOrPaid } = require('../services/order-utils');

module.exports = (logger) => {
    // Получение конкретного заказа
    router.get('/orders/:orderId', async (req, res) => {
        try {
            const { orderId } = req.params;
            logger.info('🔍 API: Запрос статуса заказа ' + orderId);
            let order = await OrdersDB.getById(orderId);
            if (order) {
                order = mapDbOrderToApi(order);
            } else {
                return res.status(404).json({ ok: false, error: 'Заказ не найден' });
            }
            return res.json({ ok: true, order });
        } catch (error) {
            logger.error('❌ API /api/orders/:orderId ошибка:', error.message);
            return res.status(500).json({ ok: false, error: error.message });
        }
    });

    // Списки заказов пользователя (два старых пути унифицированы)
    router.get('/user-orders/:userId', async (req, res) => {
        try {
            const { userId } = req.params;
            const orders = await OrdersDB.getByUserId(userId);
            const formattedOrders = orders.filter(isOrderCompletedOrPaid).map(mapDbOrderToList);
            res.json({ ok: true, orders: formattedOrders });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    router.get('/orders/user/:userId', async (req, res) => {
        try {
            const { userId } = req.params;
            const orders = await OrdersDB.getByUserId(userId);
            const formattedOrders = orders.filter(isOrderCompletedOrPaid).map(mapDbOrderToList);
            res.json({ ok: true, orders: formattedOrders });
        } catch (error) {
            logger.error('❌ Ошибка загрузки заказов пользователя:', error.message);
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    return router;
};


