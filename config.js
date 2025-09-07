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
    FRONTEND_URL: process.env.FRONTEND_URL || 'https://tundra-miniapp-production.up.railway.app',
    
    // 🔧 ПОРТ СЕРВЕРА
    PORT: process.env.PORT || 3000,
    
    // 🗄️ DATABASE
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://localhost:5432/tundra_gourmet',
    
    // 📊 КОНСТАНТЫ ПРИЛОЖЕНИЯ
    ORDER_TIMEOUT_MINUTES: parseInt(process.env.ORDER_TIMEOUT_MINUTES) || 30,
    MIN_ORDER_AMOUNT: parseInt(process.env.MIN_ORDER_AMOUNT) || 3500,
    MAX_ITEM_QUANTITY: parseInt(process.env.MAX_ITEM_QUANTITY) || 50,
    
    // 🏆 ЛОЯЛЬНОСТЬ
    LOYALTY_LEVELS: {
        BRONZE: { threshold: 10000, discount: 3 },
        SILVER: { threshold: 25000, discount: 5 },
        GOLD: { threshold: 50000, discount: 10 }
    },
    
    // 🧹 ОЧИСТКА ПАМЯТИ
    MEMORY_CLEANUP_INTERVAL_HOURS: parseInt(process.env.MEMORY_CLEANUP_INTERVAL_HOURS) || 1,
    ORDER_MEMORY_RETENTION_HOURS: parseInt(process.env.ORDER_MEMORY_RETENTION_HOURS) || 24,
    ORDER_DB_RETENTION_DAYS: parseInt(process.env.ORDER_DB_RETENTION_DAYS) || 30,
    
    // 🔄 RETRY ЛОГИКА
    DB_RETRY_ATTEMPTS: parseInt(process.env.DB_RETRY_ATTEMPTS) || 3,
    DB_RETRY_DELAY_MS: parseInt(process.env.DB_RETRY_DELAY_MS) || 1000,
    
    // 📝 ЛОГИРОВАНИЕ
    LOG_LEVEL: process.env.LOG_LEVEL || 'DEBUG', // ERROR, WARN, INFO, DEBUG
    
    // 🛡️ БЕЗОПАСНОСТЬ
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'https://t.me,https://web.telegram.org',
    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 минут
    RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
};
