const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());

// Раздача статики фронта
const webRoot = path.join(__dirname, 'webapp');
app.use(express.static(webRoot));

// Приём заказов с фронта (минимальный логгер)
app.post('/api/orders', async (req, res) => {
  try {
    const order = req.body || {};

    // Отправка уведомления в админ-группу (если задан chat_id)
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (botToken && adminChatId) {
      const { totals = {}, cartItems = [], deliveryZone, phone } = order;
      const total = totals.total ?? 0;
      const itemsText = cartItems
        .map(i => `• ${i.name} × ${i.quantity}`)
        .slice(0, 6)
        .join('\n');

      const text = `🆕 НОВЫЙ ЗАКАЗ\n💰 ${total}₽\n📦 ${cartItems.length} поз.\n🚚 ${deliveryZone || ''}\n📞 ${phone || ''}\n\n${itemsText}`;
      await axios.post(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        { chat_id: adminChatId, text }
      );
    }

    res.json({ ok: true, orderId: Date.now().toString() });
  } catch (err) {
    console.error('orders error', err?.message);
    res.status(500).json({ ok: false });
  }
});

// Вебхук Telegram (заглушка)
app.post('/api/telegram/webhook', (req, res) => {
  res.json({ ok: true });
});

// Вебхук ЮKassa (заглушка для будущей интеграции)
app.post('/api/yookassa/webhook', (req, res) => {
  res.json({ ok: true });
});

// SPA fallback для всего, кроме /api
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(webRoot, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server listening on', PORT);
});


