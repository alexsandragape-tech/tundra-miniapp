require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

app.use(express.json());

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
        
        // Формируем сообщение для админа
        const message = `�� Новый заказ!\n\n�� Сумма: ${orderData.total}₽\n📦 Товаров: ${orderData.items.length}\n🚚 Зона доставки: ${orderData.deliveryZone}\n📱 Телефон: ${orderData.phone}\n\n�� Детали заказа:\n${orderData.items.map(item => `• ${item.name} x${item.quantity}`).join('\n')}`;
        
        // Отправляем уведомление в Telegram
        if (TELEGRAM_BOT_TOKEN && TELEGRAM_ADMIN_CHAT_ID) {
            try {
                await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: TELEGRAM_ADMIN_CHAT_ID,
                    text: message,
                    parse_mode: 'HTML'
                });
            } catch (telegramError) {
                console.error('Ошибка отправки в Telegram:', telegramError.message);
            }
        }
        
        res.json({ ok: true, orderId: Date.now().toString() });
    } catch (error) {
        console.error('Ошибка обработки заказа:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Webhook для Telegram
app.post('/api/telegram/webhook', (req, res) => {
    console.log('Telegram webhook received:', req.body);
    res.json({ ok: true });
});

// Webhook для ЮKassa
app.post('/api/yookassa/webhook', (req, res) => {
    console.log('ЮKassa webhook received:', req.body);
    res.json({ ok: true });
});

// SPA fallback - все остальные маршруты ведут на index.html
app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(webRoot, 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📁 Статические файлы из: ${webRoot}`);
    console.log(`�� Health check: http://localhost:${PORT}/health`);
});

// Keep-alive механизм для Railway
setInterval(() => {
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    console.log(`💓 Keep-alive ping: ${new Date().toISOString()}, Uptime: ${Math.floor(uptime)}s, Memory: ${Math.round(memory.heapUsed / 1024 / 1024)}MB`);
}, 5 * 60 * 1000); // Каждые 5 минут

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('�� Получен сигнал SIGTERM, завершаем работу...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('�� Получен сигнал SIGINT, завершаем работу...');
    process.exit(0);
});
