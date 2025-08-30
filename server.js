require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const config = require('./config');
const { initializeDatabase, OrdersDB, PurchaseHistoryDB, AdminProductsDB } = require('./database');

const app = express();
const PORT = config.PORT;
const TELEGRAM_BOT_TOKEN = config.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = config.TELEGRAM_ADMIN_CHAT_ID;

// Хранилище заказов (в продакшене заменить на базу данных)
let orders = new Map();
let orderCounter = 0; // Начинаем с 0 для нового пользователя

// 🔥 ТАЙМЕРЫ ДЛЯ АВТОМАТИЧЕСКОЙ ОТМЕНЫ ЗАКАЗОВ (30 минут)
let orderTimers = new Map();

// 🔧 ХРАНИЛИЩЕ ТОВАРОВ ДЛЯ АДМИН ПАНЕЛИ
let adminProducts = new Map();

app.use(express.json());

// 🔧 CORS для админ панели
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Admin-Password');
    
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Функции для работы с заказами
function createOrder(orderData) {
    orderCounter++;
    const orderId = orderCounter.toString();
    
    const order = {
        id: orderId,
        status: 'new', // new, accepted, preparing, delivering, completed, cancelled, expired
        paymentStatus: 'pending', // pending, paid, cancelled, expired
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 минут
        ...orderData
    };
    
    orders.set(orderId, order);
    
    // 🔥 ЗАПУСКАЕМ ТАЙМЕР АВТООТМЕНЫ НА 30 МИНУТ
    const timer = setTimeout(() => {
        autoExpireOrder(orderId);
    }, 30 * 60 * 1000); // 30 минут
    
    orderTimers.set(orderId, timer);
    
    console.log(`🔥 Заказ ${orderId} создан. Автоотмена через 30 минут.`);
    
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

// 🔥 ФУНКЦИЯ АВТОМАТИЧЕСКОЙ ОТМЕНЫ ЗАКАЗА
function autoExpireOrder(orderId) {
    const order = orders.get(orderId);
    if (!order) {
        console.log(`⚠️ Заказ ${orderId} не найден для автоотмены`);
        return;
    }
    
    // Проверяем, не был ли заказ уже оплачен
    if (order.paymentStatus === 'paid') {
        console.log(`✅ Заказ ${orderId} уже оплачен, отмена отменена`);
        clearOrderTimer(orderId);
        return;
    }
    
    // Отменяем заказ
    order.status = 'expired';
    order.paymentStatus = 'expired';
    order.updatedAt = new Date();
    orders.set(orderId, order);
    
    // Очищаем таймер
    clearOrderTimer(orderId);
    
    console.log(`⏰ Заказ ${orderId} автоматически отменен (время истекло)`);
}

// Функция очистки таймера заказа
function clearOrderTimer(orderId) {
    const timer = orderTimers.get(orderId);
    if (timer) {
        clearTimeout(timer);
        orderTimers.delete(orderId);
    }
}

// Функция отмены таймера при оплате
function cancelOrderTimer(orderId) {
    clearOrderTimer(orderId);
    console.log(`🔥 Таймер заказа ${orderId} отменен (заказ оплачен)`);
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
        
        console.log(`📝 Заказ #${order.id} создан, ожидает оплаты в течение 30 минут`);
        
        // 🔥 НЕ ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ В АДМИН ГРУППУ
        // Уведомление будет отправлено только после успешной оплаты!
        
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
        const orderId = req.params.orderId;
        
        // 🔥 ОБРАБАТЫВАЕМ СПЕЦИАЛЬНЫЕ СТАТУСЫ
        if (status === 'cancelled' || status === 'expired') {
            // Отменяем таймер при ручной отмене или истечении времени
            clearOrderTimer(orderId);
        }
        
        const order = updateOrderStatus(orderId, status);
        
        if (order) {
            console.log(`📝 Статус заказа ${orderId} изменен на: ${status}`);
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
        
        // 🔥 ОТМЕНЯЕМ ТАЙМЕР АВТООТМЕНЫ
        cancelOrderTimer(orderId);
        
        // Обновляем статус заказа на "оплачен"
        order.paymentStatus = 'paid';
        order.paymentId = payment.id;
        order.updatedAt = new Date();
        orders.set(orderId, order);
        
        // 🔥 ТЕПЕРЬ ОТПРАВЛЯЕМ ПОЛНОЕ УВЕДОМЛЕНИЕ В АДМИН ГРУППУ
        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_CHAT_ID) {
            const totalAmount = order.totals?.total || 0;
            const itemsCount = order.cartItems?.length || 0;
            
            const message = `💰 ОПЛАЧЕННЫЙ ЗАКАЗ #${orderId}

👤 ${order.customerName || 'Клиент'}
📍 ${order.address.street}, ${order.address.house}${order.address.apartment ? `, кв.${order.address.apartment}` : ''} (${order.deliveryZone === 'moscow' ? 'Москва' : 'МО'})
💰 ${totalAmount}₽ ✅ ОПЛАЧЕНО
📦 ${itemsCount} товаров

📋 Состав заказа:
${order.cartItems.map(item => `• ${item.name} x${item.quantity} - ${item.price * item.quantity}₽`).join('\n')}

📱 Телефон: ${order.phone}
💬 Комментарий: ${order.comment || 'нет'}

💳 ID платежа: ${payment.id}
⏰ Время оплаты: ${new Date().toLocaleString('ru-RU')}

Заказ готов к выполнению!`;

            // Создаем кнопки для управления оплаченным заказом
            const inlineKeyboard = {
                inline_keyboard: [
                    [
                        { text: '🟡 Принять', callback_data: `accept_${order.id}` },
                        { text: '🔵 Готовится', callback_data: `preparing_${order.id}` }
                    ]
                ]
            };
            
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_ADMIN_CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                reply_markup: inlineKeyboard
            });
        }
        
        console.log(`✅ Платеж для заказа ${orderId} обработан. Уведомление отправлено админам.`);
        
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

// 🔧 MIDDLEWARE ДЛЯ ЗАЩИТЫ АДМИН API
function requireAdminAuth(req, res, next) {
    const providedPassword = req.headers['x-admin-password'] || req.query.password;
    const adminPassword = config.ADMIN_PASSWORD;
    
    if (providedPassword !== adminPassword) {
        return res.status(401).json({ 
            ok: false, 
            error: 'Unauthorized. Admin password required.' 
        });
    }
    
    next();
}

// 🔧 API ДЛЯ ОСНОВНОГО ПРИЛОЖЕНИЯ

// Получение товаров для основного приложения (публичный API)
app.get('/api/products', async (req, res) => {
    try {
        // 🗄️ ЗАГРУЖАЕМ ИЗ БАЗЫ ДАННЫХ
        let allProducts = await AdminProductsDB.loadAll();
        
        // Если в БД нет товаров, используем данные из памяти
        if (Object.keys(allProducts).length === 0 && adminProducts.size > 0) {
            allProducts = Object.fromEntries(adminProducts);
        }
        
        // Фильтруем только доступные товары для клиентов
        const productsObj = {};
        for (const [categoryId, categoryProducts] of Object.entries(allProducts)) {
            const availableProducts = categoryProducts.filter(product => product.available !== false);
            if (availableProducts.length > 0) {
                productsObj[categoryId] = availableProducts;
            }
        }
        
        res.json({ ok: true, products: productsObj });
        
    } catch (error) {
        console.error('❌ Ошибка получения товаров:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔧 API ДЛЯ АДМИН ПАНЕЛИ

// Получение всех товаров для админ панели
app.get('/api/admin/products', requireAdminAuth, async (req, res) => {
    try {
        // 🗄️ ЗАГРУЖАЕМ ИЗ БАЗЫ ДАННЫХ
        let products = await AdminProductsDB.loadAll();
        
        // Если в БД нет товаров, используем fallback
        if (Object.keys(products).length === 0 && adminProducts.size === 0) {
            // Заглушка с товарами
            const defaultProducts = {
                'kolbasy': [
                    {
                        id: 'salame-oreh',
                        name: 'Салями из мяса северного оленя с кедровым орехом',
                        price: 2350,
                        unit: '/кг',
                        maxQty: 3,
                        image: '🌭',
                        imageUrl: 'images/products/kolbasy/salame-oreh.jpg',
                        composition: 'мясо северного оленя 1 сорт, жир олений, орех кедровый, соль поваренная пищевая, сахар-песок, перец черный молотый, мускатный орех, чеснок сушеный, кориандр, оболочка искусственная',
                        nutrition: 'белки - 20 г, жиры - 16 г',
                        storage: '15 суток',
                        available: true
                    }
                ]
            };
            products = defaultProducts;
        } else if (Object.keys(products).length === 0) {
            // Если в БД нет товаров, но есть в памяти
            products = Object.fromEntries(adminProducts);
        }
        
        res.json({ ok: true, products });
    } catch (error) {
        console.error('Ошибка получения товаров:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Обновление товаров через админ панель
app.put('/api/admin/products', requireAdminAuth, async (req, res) => {
    try {
        const { products } = req.body;
        
        // 🗄️ СОХРАНЯЕМ В БАЗУ ДАННЫХ
        await AdminProductsDB.saveAll(products);
        
        // Обновляем локальный кэш для совместимости
        adminProducts.clear();
        Object.entries(products).forEach(([categoryId, categoryProducts]) => {
            adminProducts.set(categoryId, categoryProducts);
        });
        
        console.log('🔧 Товары обновлены через админ панель и сохранены в БД');
        res.json({ ok: true, message: 'Товары успешно обновлены и сохранены в базе данных' });
        
    } catch (error) {
        console.error('❌ Ошибка обновления товаров:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Переключение доступности товара
app.patch('/api/admin/products/:categoryId/:productId/toggle', requireAdminAuth, (req, res) => {
    try {
        const { categoryId, productId } = req.params;
        
        const categoryProducts = adminProducts.get(categoryId);
        if (!categoryProducts) {
            return res.status(404).json({ ok: false, error: 'Категория не найдена' });
        }
        
        const product = categoryProducts.find(p => p.id === productId);
        if (!product) {
            return res.status(404).json({ ok: false, error: 'Товар не найден' });
        }
        
        // Переключаем доступность
        product.available = !product.available;
        
        console.log(`🔧 Товар ${productId} ${product.available ? 'показан' : 'скрыт'}`);
        res.json({ ok: true, product, available: product.available });
        
    } catch (error) {
        console.error('Ошибка переключения товара:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// SPA fallback - все остальные маршруты ведут на index.html
app.get(/^\/(?!api).*/, (req, res) => {
    const requestedPath = req.path;
    
    // Если запрашивается admin.html, проверяем пароль
    if (requestedPath === '/admin' || requestedPath === '/admin.html') {
        const adminPassword = config.ADMIN_PASSWORD;
        const providedPassword = req.query.password;
        
        if (providedPassword !== adminPassword) {
            res.status(401).send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Вход в админ панель</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            background: linear-gradient(135deg, #0b5c56, #2C5530);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
        }
        .login-container {
            background: rgba(255,255,255,0.1);
            padding: 40px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
            box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 400px;
            width: 90%;
        }
        .login-icon { font-size: 60px; margin-bottom: 20px; }
        .login-title { font-size: 28px; font-weight: 700; margin-bottom: 10px; }
        .login-subtitle { opacity: 0.9; margin-bottom: 30px; }
        .login-form { margin-top: 30px; }
        .login-input {
            width: 100%;
            padding: 15px;
            border: none;
            border-radius: 12px;
            font-size: 16px;
            margin-bottom: 20px;
            background: rgba(255,255,255,0.9);
            color: #2c3e50;
        }
        .login-btn {
            width: 100%;
            background: #D4A574;
            color: #1A1F2E;
            border: none;
            padding: 15px;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        .login-btn:hover { background: #c19660; transform: translateY(-2px); }
        .error-msg {
            background: rgba(231, 76, 60, 0.2);
            color: #ff6b6b;
            padding: 15px;
            border-radius: 12px;
            margin-bottom: 20px;
            border: 1px solid rgba(231, 76, 60, 0.3);
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="login-icon">🔐</div>
        <div class="login-title">Админ панель</div>
        <div class="login-subtitle">Tundra Gourmet</div>
        
        ${providedPassword ? '<div class="error-msg">❌ Неверный пароль</div>' : ''}
        
        <form class="login-form" method="GET">
            <input type="password" 
                   name="password" 
                   class="login-input" 
                   placeholder="Введите пароль" 
                   required 
                   autofocus>
            <button type="submit" class="login-btn">🚀 Войти</button>
        </form>
        
        <div style="margin-top: 30px; font-size: 14px; opacity: 0.7;">
            💡 Если забыли пароль, обратитесь к разработчику
        </div>
    </div>
</body>
</html>
            `);
            return;
        }
        
        res.sendFile(path.join(webRoot, 'admin.html'));
        return;
    }
    
    // Остальные маршруты ведут на основное приложение
    res.sendFile(path.join(webRoot, 'index.html'));
});

// Запуск сервера с инициализацией БД
async function startServer() {
    try {
        // Инициализируем базу данных
        await initializeDatabase();
        
        // Загружаем товары из БД если есть
        try {
            const dbProducts = await AdminProductsDB.loadAll();
            if (Object.keys(dbProducts).length > 0) {
                console.log('✅ Товары загружены из базы данных');
                // Преобразуем в Map для совместимости с текущим кодом
                adminProducts.clear();
                for (const [categoryId, products] of Object.entries(dbProducts)) {
                    adminProducts.set(categoryId, products);
                }
            }
        } catch (error) {
            console.log('⚠️ Товары из БД не загружены, используем fallback');
        }
        
        // Запускаем сервер
        app.listen(PORT, () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}`);
            console.log(`📁 Статические файлы из: ${webRoot}`);
            console.log(`🔗 Health check: http://localhost:${PORT}/health`);
            console.log(`🗄️ База данных подключена`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка запуска сервера:', error);
        process.exit(1);
    }
}

startServer();

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
