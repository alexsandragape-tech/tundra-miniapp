// Конфигурация для Tundra Gourmet

module.exports = {
    // 🔑 ПАРОЛЬ АДМИН ПАНЕЛИ
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'TundraAdmin2024!',
    
    // 🤖 TELEGRAM BOT
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID || '',
    
    // 💳 YOOKASSA
    YOOKASSA_SHOP_ID: process.env.YOOKASSA_SHOP_ID || '',
    YOOKASSA_SECRET_KEY: process.env.YOOKASSA_SECRET_KEY || '',
    
    // 🌐 FRONTEND URL
    FRONTEND_URL: process.env.FRONTEND_URL || 'https://nodejs-production-64ed.up.railway.app',
    
    // 🔧 ПОРТ СЕРВЕРА
    PORT: process.env.PORT || 3000
};
