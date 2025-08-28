require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

// Хранилище заказов (в продакшене заменить на базу данных)
let orders = new Map();
let orderCounter = 125; // Начинаем с 125 как в приложении

app.use(express.json());

// Функции для работы с заказами
function createOrder(orderData) {
    orderCounter++;
    const orderId = orderCounter.toString();
    
    const order = {
        id: orderId,
        status: 'new', // new, accepted, preparing, delivering, completed, cancelled
        createdAt: new Date(),
        updatedAt: new Date(),
        ...orderData
    };
    
    orders.set(orderId, order);
    return order;
}

function updateOrderStatus(orderId, newStatus) {
    const order = orders.get(orderId);
    if (order) {
        order.status = newStatus;
        order.updatedAt = new Date();
        orders.set(orderId, order);
        return order;
    }
    return null;
}

function getOrder(orderId) {
    return orders.get(orderId);
}

function getAllOrders() {
    return Array.from(orders.values()).sort((a, b) => b.createdAt - a.createdAt);
}

// Настройка статических файлов
const webRoot = path.join(__dirname, 'webapp');
app.use(express.static(webRoot));

// Health check endpoints
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// API для заказов
app.post('/api/orders', async (req, res) => {
    try {
        const orderData = req.body;
        
        // Создаем заказ
        const order = createOrder(orderData);
        
        // Формируем красивое сообщение для админа
        const totalAmount = orderData.totals?.total || 0;
        const itemsCount = orderData.cartItems?.length || 0;
        
        const message = `🆕 НОВЫЙ ЗАКАЗ #${order.id}

👤 ${orderData.customerName || 'Клиент'}
📍 ${orderData.address.street}, ${orderData.address.house}${orderData.address.apartment ? `, кв.${orderData.address.apartment}` : ''} (${orderData.deliveryZone === 'moscow' ? 'Москва' : 'МО'})
💰 ${totalAmount}₽ (ожидает оплаты ⏳)
📦 ${itemsCount} товаров

📋 Состав заказа:
${orderData.cartItems.map(item => `• ${item.name} x${item.quantity} - ${item.price * item.quantity}₽`).join('\n')}

📱 Телефон: ${orderData.phone}
💬 Комментарий: ${orderData.comment || 'нет'}

[🟡 Принять] [🔴 Отменить]`;

        // Создаем inline-кнопки для управления заказом
        const inlineKeyboard = {
            inline_keyboard: [
                [
                    { text: '🟡 Принять', callback_data: `accept_${order.id}` },
                    { text: '🔴 Отменить', callback_data: `cancel_${order.id}` }
                ]
            ]
        };
        
        // Отправляем уведомление в Telegram с кнопками
        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_CHAT_ID) {
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: TELEGRAM_ADMIN_CHAT_ID,
                    text: message,
                    parse_mode: 'HTML',
                    reply_markup: inlineKeyboard
                });
            } catch (telegramError) {
                console.error('Ошибка отправки в Telegram:', telegramError.message);
            }
        }
        
        res.json({ ok: true, orderId: order.id });
    } catch (error) {
        console.error('Ошибка обработки заказа:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// API для получения всех заказов
app.get('/api/orders', (req, res) => {
    try {
        const allOrders = getAllOrders();
        res.json({ ok: true, orders: allOrders });
    } catch (error) {
        console.error('Ошибка получения заказов:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// API для получения конкретного заказа
app.get('/api/orders/:orderId', (req, res) => {
    try {
        const order = getOrder(req.params.orderId);
        if (order) {
            res.json({ ok: true, order });
        } else {
            res.status(404).json({ ok: false, error: 'Заказ не найден' });
        }
    } catch (error) {
        console.error('Ошибка получения заказа:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// API для обновления статуса заказа
app.put('/api/orders/:orderId/status', (req, res) => {
    try {
        const { status } = req.body;
        const order = updateOrderStatus(req.params.orderId, status);
        
        if (order) {
            res.json({ ok: true, order });
        } else {
            res.status(404).json({ ok: false, error: 'Заказ не найден' });
        }
    } catch (error) {
        console.error('Ошибка обновления статуса:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Webhook для Telegram
app.post('/api/telegram/webhook', (req, res) => {
    try {
        const { message, callback_query } = req.body;
        
        if (callback_query) {
            // Обрабатываем нажатие на inline-кнопку
            handleCallbackQuery(callback_query);
        } else if (message) {
            // Обрабатываем обычные сообщения
            console.log('Получено сообщение:', message.text);
        }
        
        res.json({ ok: true });
    } catch (error) {
        console.error('Ошибка обработки Telegram webhook:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Функция обработки callback query (нажатия на кнопки)
async function handleCallbackQuery(callbackQuery) {
    try {
        const { data, message, from } = callbackQuery;
        const [action, orderId] = data.split('_');
        
        console.log(`Обработка действия: ${action} для заказа ${orderId}`);
        
        let order = getOrder(orderId);
        if (!order) {
            console.error(`Заказ ${orderId} не найден`);
            return;
        }
        
        let newStatus, statusText, statusEmoji;
        
        switch (action) {
            case 'accept':
                newStatus = 'accepted';
                statusText = 'Принят';
                statusEmoji = '🟡';
                break;
            case 'cancel':
                newStatus = 'cancelled';
                statusText = 'Отменен';
                statusEmoji = '🔴';
                break;
            case 'preparing':
                newStatus = 'preparing';
                statusText = 'Готовится';
                statusEmoji = '🔵';
                break;
            case 'delivering':
                newStatus = 'delivering';
                statusText = 'В доставке';
                statusEmoji = '🚚';
                break;
            case 'completed':
                newStatus = 'completed';
                statusText = 'Доставлен';
                statusEmoji = '✅';
                break;
            default:
                console.error(`Неизвестное действие: ${action}`);
                return;
        }
        
        // Обновляем статус заказа
        order = updateOrderStatus(orderId, newStatus);
        
        // Обновляем сообщение в админ-группе
        await updateOrderMessage(message.chat.id, message.message_id, order, newStatus);
        
        // Отправляем подтверждение
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackQuery.id,
            text: `Статус заказа #${orderId} изменен на "${statusText}"`
        });
        
        console.log(`Статус заказа ${orderId} изменен на ${newStatus}`);
        
    } catch (error) {
        console.error('Ошибка обработки callback query:', error);
    }
}

// Функция обновления сообщения с заказом
async function updateOrderMessage(chatId, messageId, order, newStatus) {
    try {
        const statusEmojis = {
            'new': '⏳',
            'accepted': '🟡',
            'preparing': '🔵',
            'delivering': '🚚',
            'completed': '✅',
            'cancelled': '🔴'
        };
        
        const statusTexts = {
            'new': 'Новый',
            'accepted': 'Принят',
            'preparing': 'Готовится',
            'delivering': 'В доставке',
            'completed': 'Доставлен',
            'cancelled': 'Отменен'
        };
        
        // Формируем обновленное сообщение
        const message = `🆕 ЗАКАЗ #${order.id} - ${statusEmojis[newStatus]} ${statusTexts[newStatus]}

👤 ${order.customerName || 'Клиент'}
📍 ${order.address.street}, ${order.address.house}${order.address.apartment ? `, кв.${order.address.apartment}` : ''} (${order.deliveryZone === 'moscow' ? 'Москва' : 'МО'})
💰 ${order.totals?.total || 0}₽
📦 ${order.cartItems?.length || 0} товаров

📋 Состав заказа:
${order.cartItems.map(item => `• ${item.name} x${item.quantity} - ${item.price * item.quantity}₽`).join('\n')}

📱 Телефон: ${order.phone}
💬 Комментарий: ${order.comment || 'нет'}

[🟡 Принять] [🔵 Готовится] [🚚 Доставке] [✅ Доставлен]`;

        // Создаем обновленные кнопки в зависимости от статуса
        let inlineKeyboard;
        if (newStatus === 'new') {
            inlineKeyboard = {
                inline_keyboard: [
                    [
                        { text: '🟡 Принять', callback_data: `accept_${order.id}` },
                        { text: '🔴 Отменить', callback_data: `cancel_${order.id}` }
                    ]
                ]
            };
        } else if (newStatus === 'accepted') {
            inlineKeyboard = {
                inline_keyboard: [
                    [
                        { text: '🔵 Готовится', callback_data: `preparing_${order.id}` },
                        { text: '🔴 Отменить', callback_data: `cancel_${order.id}` }
                    ]
                ]
            };
        } else if (newStatus === 'preparing') {
            inlineKeyboard = {
                inline_keyboard: [
                    [
                        { text: '🚚 В доставку', callback_data: `delivering_${order.id}` }
                    ]
                ]
            };
        } else if (newStatus === 'delivering') {
            inlineKeyboard = {
                inline_keyboard: [
                    [
                        { text: '✅ Доставлен', callback_data: `completed_${order.id}` }
                    ]
                ]
            };
        } else {
            // Для завершенных или отмененных заказов убираем кнопки
            inlineKeyboard = { inline_keyboard: [] };
        }
        
        // Обновляем сообщение
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
            chat_id: chatId,
            message_id: messageId,
            text: message,
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard
        });
        
    } catch (error) {
        console.error('Ошибка обновления сообщения:', error);
    }
}

// Webhook для ЮKassa
app.post('/api/yookassa/webhook', (req, res) => {
    try {
        const { event, object } = req.body;
        console.log('ЮKassa webhook received:', { event, object });
        
        if (event === 'payment.succeeded') {
            // Платеж успешно проведен
            handlePaymentSuccess(object);
        } else if (event === 'payment.canceled') {
            // Платеж отменен
            handlePaymentCanceled(object);
        }
        
        res.json({ ok: true });
    } catch (error) {
        console.error('Ошибка обработки ЮKassa webhook:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Функция обработки успешного платежа
async function handlePaymentSuccess(payment) {
    try {
        const orderId = payment.metadata?.orderId;
        if (!orderId) {
            console.error('Не найден orderId в платеже');
            return;
        }
        
        const order = getOrder(orderId);
        if (!order) {
            console.error(`Заказ ${orderId} не найден`);
            return;
        }
        
        // Обновляем статус заказа на "оплачен"
        order.paymentStatus = 'paid';
        order.paymentId = payment.id;
        order.updatedAt = new Date();
        orders.set(orderId, order);
        
        // Отправляем уведомление в админ-группу
        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_CHAT_ID) {
            const message = `💰 ПЛАТЕЖ ПОЛУЧЕН!

🆕 ЗАКАЗ #${orderId}
💳 ID платежа: ${payment.id}
💵 Сумма: ${payment.amount.value} ${payment.amount.currency}
✅ Статус: Оплачен

Теперь можно приступать к выполнению заказа!`;
            
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_ADMIN_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            });
        }
        
        console.log(`Платеж для заказа ${orderId} успешно обработан`);
        
    } catch (error) {
        console.error('Ошибка обработки успешного платежа:', error);
    }
}

// Функция обработки отмененного платежа
async function handlePaymentCanceled(payment) {
    try {
        const orderId = payment.metadata?.orderId;
        if (!orderId) {
            console.error('Не найден orderId в платеже');
            return;
        }
        
        const order = getOrder(orderId);
        if (!order) {
            console.error(`Заказ ${orderId} не найден`);
            return;
        }
        
        // Обновляем статус заказа
        order.paymentStatus = 'canceled';
        order.updatedAt = new Date();
        orders.set(orderId, order);
        
        // Отправляем уведомление в админ-группу
        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_CHAT_ID) {
            const message = `❌ ПЛАТЕЖ ОТМЕНЕН!

🆕 ЗАКАЗ #${orderId}
💳 ID платежа: ${payment.id}
💵 Сумма: ${payment.amount.value} ${payment.amount.currency}
❌ Статус: Отменен

Клиент отменил оплату заказа.`;
            
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_ADMIN_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            });
        }
        
        console.log(`Платеж для заказа ${orderId} отменен`);
        
    } catch (error) {
        console.error('Ошибка обработки отмененного платежа:', error);
    }
}

// API для создания платежа через ЮKassa
app.post('/api/payments/create', async (req, res) => {
    try {
        const { orderId, amount, description } = req.body;
        
        // Проверяем существование заказа
        const order = getOrder(orderId);
        if (!order) {
            return res.status(404).json({ ok: false, error: 'Заказ не найден' });
        }
        
        // Создаем платеж в ЮKassa
        const paymentData = {
            amount: {
                value: amount.toString(),
                currency: 'RUB'
            },
            capture: true,
            confirmation: {
                type: 'redirect',
                return_url: `${process.env.FRONTEND_URL || 'https://your-domain.com'}/payment-success`
            },
            description: description || `Заказ #${orderId}`,
            metadata: {
                orderId: orderId
            }
        };
        
        // В продакшене здесь будет реальный запрос к ЮKassa API
        // Пока возвращаем заглушку
        const mockPayment = {
            id: `payment_${Date.now()}`,
            status: 'pending',
            confirmation_url: `https://yoomoney.ru/checkout/payments/v2/contract?orderId=${orderId}`,
            ...paymentData
        };
        
        res.json({ ok: true, payment: mockPayment });
        
    } catch (error) {
        console.error('Ошибка создания платежа:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// SPA fallback - все остальные маршруты ведут на index.html
app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(webRoot, 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📁 Статические файлы из: ${webRoot}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

// Keep-alive механизм для Railway
setInterval(() => {
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    console.log(`💓 Keep-alive ping: ${new Date().toISOString()}, Uptime: ${Math.floor(uptime)}s, Memory: ${Math.round(memory.heapUsed / 1024 / 1024)}MB`);
}, 5 * 60 * 1000); // Каждые 5 минут

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Получен сигнал SIGTERM, завершаем работу...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Получен сигнал SIGINT, завершаем работу...');
    process.exit(0);
});
