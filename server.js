// 🔧 СИСТЕМА ЛОГИРОВАНИЯ
const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};

const CURRENT_LOG_LEVEL = process.env.LOG_LEVEL || LOG_LEVELS.INFO;

function log(level, message, ...args) {
    if (level <= CURRENT_LOG_LEVEL) {
        const timestamp = new Date().toISOString();
        const levelNames = ['❌ ERROR', '⚠️ WARN', 'ℹ️ INFO', '🔍 DEBUG'];
        console.log(`[${timestamp}] ${levelNames[level]} ${message}`, ...args);
    }
}

// Алиасы для удобства
const logger = {
    error: (msg, ...args) => log(LOG_LEVELS.ERROR, msg, ...args),
    warn: (msg, ...args) => log(LOG_LEVELS.WARN, msg, ...args),
    info: (msg, ...args) => log(LOG_LEVELS.INFO, msg, ...args),
    debug: (msg, ...args) => log(LOG_LEVELS.DEBUG, msg, ...args)
};

logger.info('🚀 СТАРТ СЕРВЕРА - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ!');
logger.info('⏰ Время запуска:', new Date().toISOString());

require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
// 💳 СОБСТВЕННАЯ РЕАЛИЗАЦИЯ ЮKASSA API
class YooKassaAPI {
    constructor(shopId, secretKey) {
        this.shopId = shopId;
        this.secretKey = secretKey;
        this.baseURL = 'https://api.yookassa.ru/v3';
        
        logger.info('💳 YooKassa API инициализирована');
        
        // Проверяем формат ключей
        this.validateKeys();
    }
    
    validateKeys() {
        // Проверяем Shop ID
        if (!this.shopId || typeof this.shopId !== 'string' || !/^\d+$/.test(this.shopId)) {
            logger.error('❌ Shop ID неверный');
            return false;
        }
        
        // Проверяем Secret Key
        if (!this.secretKey || typeof this.secretKey !== 'string' || 
            (!this.secretKey.startsWith('test_') && !this.secretKey.startsWith('live_'))) {
            logger.error('❌ Secret Key неверный');
            return false;
        }
        
        logger.debug('✅ Формат ключей корректный');
        return true;
    }
    
    async createPayment(paymentData, idempotenceKey) {
        try {
            logger.debug('💳 Создаем платеж через ЮKassa API');
            
            // Проверяем, что ключи не пустые
            if (!this.shopId || !this.secretKey) {
                throw new Error('Ключи ЮKassa пустые!');
            }
            
            const response = await axios.post(`${this.baseURL}/payments`, paymentData, {
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotence-Key': idempotenceKey
                },
                auth: {
                    username: this.shopId,
                    password: this.secretKey
                },
                timeout: 30000
            });
            
            logger.info('✅ Платеж создан успешно:', response.data.id);
            return response.data;
            
        } catch (error) {
            logger.error('❌ Ошибка создания платежа ЮKassa:', error.message);
            
            if (error.response?.status === 401) {
                logger.error('🔍 Ошибка авторизации - проверьте ключи ЮKassa');
            }
            
            throw error;
        }
    }
}
const config = require('./config');
const { initializeDatabase, OrdersDB, PurchaseHistoryDB, AdminProductsDB } = require('./database');

const app = express();
const PORT = config.PORT;
const TELEGRAM_BOT_TOKEN = config.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = config.TELEGRAM_ADMIN_CHAT_ID;

// Настройка для работы с прокси (Railway)
app.set('trust proxy', 1);

// 🛡️ НАСТРОЙКИ БЕЗОПАСНОСТИ (ОТКЛЮЧЕНЫ ДЛЯ TELEGRAM WEB APP)
// Отключаем все ограничения безопасности для статических файлов

// CORS только для API (не для статических файлов)
const corsOrigins = config.CORS_ORIGIN.split(',');
const corsOptions = {
    origin: corsOrigins,
    credentials: true
};

// Защита от DDoS только для API (УПРОЩЕННАЯ)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // 100 запросов
    message: 'Слишком много запросов, попробуйте позже',
    trustProxy: true
});

// 💳 ИНИЦИАЛИЗАЦИЯ YOOKASSA
logger.info('🔧 Инициализация ЮKassa...');

let checkout = null;

// 🔧 АСИНХРОННАЯ ИНИЦИАЛИЗАЦИЯ ЮKASSA
async function initializeYooKassa() {
    try {
        if (!config.YOOKASSA_SHOP_ID || !config.YOOKASSA_SECRET_KEY) {
            throw new Error('Не настроены ключи ЮKassa');
        }
        
        checkout = new YooKassaAPI(config.YOOKASSA_SHOP_ID, config.YOOKASSA_SECRET_KEY);
        
        // Тестируем доступность API ЮKassa
        try {
            const testResponse = await axios.get('https://api.yookassa.ru/v3/me', {
                auth: {
                    username: config.YOOKASSA_SHOP_ID,
                    password: config.YOOKASSA_SECRET_KEY
                },
                timeout: 10000
            });
            
            if (testResponse.data.test) {
                logger.warn('⚠️ Используются ТЕСТОВЫЕ ключи ЮKassa');
            } else {
                logger.info('✅ Используются РАБОЧИЕ ключи ЮKassa');
            }
        } catch (testError) {
            logger.error('❌ Тест API ЮKassa провалился:', testError.response?.status);
        }
        
        logger.info('✅ ЮKassa инициализирована успешно');
    } catch (error) {
        logger.error('❌ Ошибка инициализации ЮKassa:', error.message);
        logger.warn('⚠️ Приложение запустится без ЮKassa');
    }
}

// Хранилище заказов (в продакшене заменить на базу данных)
let orders = new Map();
let orderCounter = 0; // Будет инициализирован из БД

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

// 🗄️ ПОЛНЫЙ КАТАЛОГ ТОВАРОВ (все 49 товаров из 8 категорий)
async function loadFullProductCatalog() {
    return {
        'kolbasy': [
            {
                id: 'chorizo-70',
                name: 'Колбаса из сыровяленая оленины "Чоризо"',
                price: 395,
                unit: '/70 гр.',
                maxQty: 20,
                image: '🌭',
                imageUrl: 'images/products/kolbasy/chorizo-70.jpg',
                composition: 'оленина, жир говяжий, соль поваренная пищевая, смесь 5 перцев, паприка копченая, кардамон, перец черный',
                nutrition: 'белок - 15 г, жир - 20 г',
                calories: '510 ккал/2140 кДж',
                storage: '180 суток',
                available: true
            },
            {
                id: 'trufel-70',
                name: 'Колбаса сыровяленая из оленины "С Трюфелем"',
                price: 411,
                unit: '/70 гр.',
                maxQty: 20,
                image: '🌭',
                imageUrl: 'images/products/kolbasy/trufel-70.jpg',
                composition: 'оленина, жир говяжий, соль поваренная пищевая, специи, перец, трюфель черный 0,02%, мускатный орех',
                nutrition: 'белок - 15 г, жир - 20 г',
                calories: '510 ккал/2140 кДж',
                storage: '180 суток',
                available: true
            },
            {
                id: 'kedr-70',
                name: 'Колбаса сыровяленая из оленины "Северная с кедровым орехом"',
                price: 405,
                unit: '/70 гр.',
                maxQty: 20,
                image: '🌭',
                imageUrl: 'images/products/kolbasy/kedr-70.jpg',
                composition: 'оленина, жир говяжий, орех кедровый, смесь специй и пряностей, соль поваренная пищевая',
                nutrition: 'белок - 15 г, жир - 20 г, углеводы - 8 г',
                calories: '540 ккал/2266 кДж',
                storage: '180 суток',
                available: true
            },
            {
                id: 'osobaya-70',
                name: 'Колбаса сыровяленая из оленины "Особая"',
                price: 390,
                unit: '/70 гр.',
                maxQty: 20,
                image: '🌭',
                imageUrl: 'images/products/kolbasy/osobaya-70.jpg',
                composition: 'оленина, жир говяжий, соль поваренная пищевая, сахар, специи, чеснок молотый, мускатный орех, перец, антиокислитель (аскорбиновая кислота), стартовые культуры (молочнокислые микроорганизмы)',
                nutrition: 'белок - 15 г, жир - 20 г',
                calories: '510 ккал/2140 кДж',
                storage: '180 суток',
                available: true
            },
            {
                id: 'chorizo-170',
                name: 'Колбаса сыровяленая из оленины "Чоризо"',
                price: 860,
                unit: '/170 гр.',
                maxQty: 15,
                image: '🌭',
                imageUrl: 'images/products/kolbasy/chorizo-170.jpg',
                composition: 'оленина, жир говяжий, соль поваренная пищевая, смесь 5 перцев, паприка копченая, кардамон, перец черный',
                nutrition: 'белок - 15 г, жир - 20 г',
                calories: '510 ккал/2140 кДж',
                storage: '180 суток',
                available: true
            },
            {
                id: 'trufel-200',
                name: 'Колбаса сыровяленая из оленины "С Трюфелем"',
                price: 980,
                unit: '/200 гр.',
                maxQty: 12,
                image: '🌭',
                imageUrl: 'images/products/kolbasy/trufel-200.jpg',
                composition: 'оленина, жир говяжий, соль поваренная пищевая, специи, перец, трюфель черный 0,02%, мускатный орех',
                nutrition: 'белок - 15 г, жир - 20 г',
                calories: '510 ккал/2140 кДж',
                storage: '180 суток',
                available: true
            },
            {
                id: 'osobaya-170',
                name: 'Колбаса сыровяленая из оленины "Особая"',
                price: 885,
                unit: '/170 гр.',
                maxQty: 12,
                image: '🌭',
                imageUrl: 'images/products/kolbasy/osobaya-170.jpg',
                composition: 'оленина, жир говяжий, соль поваренная пищевая, сахар, специи, чеснок молотый, мускатный орех, перец',
                nutrition: 'белок - 15 г, жир - 20 г',
                calories: '510 ккал/2140 кДж',
                storage: '180 суток',
                available: true
            },
            {
                id: 'kedr-160',
                name: 'Колбаса сыровяленая из оленины "Северная с кедровым орехом"',
                price: 910,
                unit: '/160 гр.',
                maxQty: 10,
                image: '🌭',
                imageUrl: 'images/products/kolbasy/kedr-160.jpg',
                composition: 'оленина, жир говяжий, орех кедровый, смесь специй и пряностей, соль поваренная пищевая',
                nutrition: 'белок - 15 г, жир - 20 г, углеводы - 8 г',
                calories: '540 ккал/2266 кДж',
                storage: '180 суток',
                available: true
            }
        ],
        'pashtet': [
            {
                id: 'riyet-olene-griby',
                name: 'Рийет из оленины с белыми грибами и трюфелем',
                price: 378,
                unit: '/85 гр.',
                maxQty: 15,
                image: '🥫',
                imageUrl: 'images/products/pashtet/riyet-olene-griby.jpg',
                composition: 'мясо северного оленя, грибы белые, трюфель черный 0,02%, жир олений, лук репчатый',
                nutrition: 'белки - 17,8 г, жиры - 19,8 г, углеводы - 2,6 г',
                calories: '259,8 ккал/1087 кДж',
                storage: '90 суток',
                available: true
            },
            {
                id: 'riyet-serdtse',
                name: 'Рийет из сердца оленя с шампиньонами, ягодами, можжевельника и розмарином',
                price: 360,
                unit: '/85 гр.',
                maxQty: 15,
                image: '🥫',
                imageUrl: 'images/products/pashtet/riyet-serdtse.jpg',
                composition: 'мясо северного оленя, морковь, лук, вино белое сухое, соль морская, масло растительное, масло сливочное, соль, ягоды можжевельника, перец',
                nutrition: 'белки - 12 г, жиры - 10 г, углеводы - 9 г',
                calories: '182 ккал/762 кДж',
                storage: '90 суток',
                available: true
            },
            {
                id: 'riyet-utka',
                name: 'Рийет из полярной утки с трюфелем',
                price: 378,
                unit: '/85 гр.',
                maxQty: 15,
                image: '🥫',
                imageUrl: 'images/products/pashtet/riyet-utka.jpg',
                composition: 'мясо утки, белые грибы, вино белое сухое, утиный жир, трюфель черный 0,02%, лук, соль морская, специи',
                nutrition: 'белки - 13,3 г, жиры - 45,9 г, углеводы - 2,3 г',
                calories: '496 ккал/2077 кДж',
                storage: '90 суток',
                available: true
            },
            {
                id: 'riyet-yagnenok',
                name: 'Рийет из ягненка',
                price: 365,
                unit: '/85 гр.',
                maxQty: 15,
                image: '🥫',
                imageUrl: 'images/products/pashtet/riyet-yagnenok.jpg',
                composition: 'мясо ягненка, масло растительное, лук, соль морская, специи',
                nutrition: 'белки - 15,7 г, жиры - 15,4 г, углеводы - 5,5 г',
                calories: '223,4 ккал/935 кДж',
                storage: '90 суток',
                available: true
            }
        ],
        'delikatesy': [
            {
                id: 'hamon-utka',
                name: 'Хамон из утки сыровяленый',
                price: 560,
                unit: '/70 гр.',
                maxQty: 12,
                image: '🥩',
                imageUrl: 'images/products/delikatesy/hamon-utka.jpg',
                composition: 'филе утиной грудки премиум, соль, специи',
                nutrition: 'белки - 18,9 г, жиры - 9 г, углеводы - 1,9 г',
                calories: '172 ккал/720,1 кДж',
                storage: '180 суток',
                available: true
            },
            {
                id: 'karpachcho-olene',
                name: 'Карпаччо из оленины высший сорт',
                price: 495,
                unit: '/70 гр.',
                maxQty: 12,
                image: '🥩',
                imageUrl: 'images/products/delikatesy/karpachcho-olene.jpg',
                composition: 'оленина высший сорт, специи, соль',
                nutrition: 'белки - 22 г, жиры - 6 г',
                calories: '160 ккал/620 кДж',
                storage: '180 суток',
                available: true
            },
            {
                id: 'sneki-okorok',
                name: 'Снеки из окорока оленя сыровяленые "Таёжные с дымком"',
                price: 170,
                unit: '/30 гр.',
                maxQty: 12,
                image: '🥩',
                imageUrl: 'images/products/delikatesy/sneki-okorok.jpg',
                composition: 'оленина 1 сорт, соль поваренная пищевая, BBQ паприка, мускатный орех',
                nutrition: 'белки - 20 г, жиры - 6 г',
                calories: '180 ккал/610 кДж',
                storage: '180 суток',
                available: true
            },
            {
                id: 'filey-olene',
                name: 'Филей оленя сыровяленый',
                price: 490,
                unit: '/70 гр.',
                maxQty: 12,
                image: '🥩',
                imageUrl: 'images/products/delikatesy/filey-olene.jpg',
                composition: 'оленина, сахар, экстракты пряностей (черный перец, кориандр), соль поваренная пищевая',
                nutrition: 'Белки - 20,0 г, жиры - 10,0 г, углеводы - 1,5 г',
                calories: '260 ккал/1090 кДж',
                storage: '180 суток',
                available: true
            },
            {
                id: 'pastila-filey',
                name: 'Пастила сыровяленая из филея оленя',
                price: 250,
                unit: '/50 гр.',
                maxQty: 15,
                image: '🥩',
                imageUrl: 'images/products/delikatesy/pastila-filey.jpg',
                composition: 'вырезка оленя высший сорт, сахар, соевый соус, соль поваренная пищевая, паприка BBQ, смесь специй, острый кайенский перец, нитритно-посолочная смесь',
                nutrition: 'белки - 25 г, жиры – 10 г, углеводы - 3 г',
                calories: '176 ккал/736 кДж',
                storage: '180 суток',
                available: true
            },
            {
                id: 'chipsy-olene',
                name: 'Чипсы из оленины сыровяленые',
                price: 230,
                unit: '/50 гр.',
                maxQty: 15,
                image: '🥩',
                imageUrl: 'images/products/delikatesy/chipsy-olene.jpg',
                composition: 'оленина 1 сорт, соль, соус ворчестер, специи, сахар',
                nutrition: 'белки - 18,0 г, жиры - 7,0 г, углеводы - 12,0 г',
                calories: '140 ккал/590 кДж',
                storage: '180 суток',
                available: true
            }
        ],
        'gotovye': [
            {
                id: 'koreyka-yagody',
                name: 'Корейка оленя запечённая в северных ягодах',
                price: 4880,
                unit: '/кг',
                maxQty: 5,
                image: '🔥',
                imageUrl: 'images/products/gotovye/koreyka-yagody.jpg',
                composition: 'корейка оленя высший сорт, маринад из Северных ягод (брусника, морошка), специи (розмарин, смесь перцев), соль поваренная пищевая',
                nutrition: 'белки - 22 г, жиры - 11 г',
                calories: '260 ккал/1190 кДж',
                storage: '20 суток',
                available: true
            },
            {
                id: 'koreyka-bbq',
                name: 'Корейка оленя запечённая "BBQ"',
                price: 4880,
                unit: '/кг',
                maxQty: 5,
                image: '🔥',
                imageUrl: 'images/products/gotovye/koreyka-bbq.jpg',
                composition: 'корейка оленя высший сорт, Паприка BBQ, соус ворчестер, специи, соль поваренная пищевая, нитритно-посолочная смесь',
                nutrition: 'белки - 22 г, жиры - 11 г',
                calories: '260 ккал/1190 кДж',
                storage: '20 суток',
                available: true
            },
            {
                id: 'okorok-vino',
                name: 'Окорок оленя томленый с вином и пряными травами',
                price: 4480,
                unit: '/кг',
                maxQty: 5,
                image: '🔥',
                imageUrl: 'images/products/gotovye/okorok-vino.jpg',
                composition: 'окорок северного оленя высший сорт, сахар, соевый соус, соль поваренная пищевая, тимьян, розмарин',
                nutrition: 'белки - 22 г, жиры - 6 г',
                calories: '160 ккал/620 кДж',
                storage: '20 суток',
                available: true
            },
            {
                id: 'okorok-trufel',
                name: 'Окорок оленя томленый с трюфелем',
                price: 4600,
                unit: '/кг',
                maxQty: 5,
                image: '🔥',
                imageUrl: 'images/products/gotovye/okorok-trufel.jpg',
                composition: 'окорок северного оленя высший сорт, маринад (соус ворчестер, Guinness), трюфель черный 0,02%, смесь специй (розмарин, мускатный орех, анис), соль поваренная пищевая',
                nutrition: 'белки - 22 г, жиры - 6 г',
                calories: '160 ккал/620 кДж',
                storage: '20 суток',
                available: true
            },
            {
                id: 'pastrami-trufel',
                name: 'Пастрами из окорока оленя с трюфелем',
                price: 4630,
                unit: '/кг',
                maxQty: 5,
                image: '🔥',
                imageUrl: 'images/products/gotovye/pastrami-trufel.jpg',
                composition: 'окорок северного оленя высший сорт, смесь специй (тимьян, розмарин, кориандр), маринад (вино красное сухое, мёд), соль поваренная пищевая',
                nutrition: 'белки - 22 г, жиры - 6 г',
                calories: '160 ккал/620 кДж',
                storage: '20 суток',
                available: true
            }
        ],
        'zamorozhennye': [
            {
                id: 'pelmeni-severnye',
                name: 'Пельмени «Северные» с трюфелем',
                price: 758,
                unit: '/500 гр.',
                maxQty: 8,
                image: '❄️',
                imageUrl: 'images/products/zamorozhennye/pelmeni-severnye.jpg',
                composition: 'фарш - оленина, соль, перец, трюфельное масло, Тесто - мука пшеничная в/с, вода, соль, яичный меланж, масло растительное',
                nutrition: 'белки - 16 г, жиры - 12 г, углеводы - 28 г',
                calories: '220 ккал/921 кДж',
                storage: '10 месяцев',
                available: true
            },
            {
                id: 'pelmeni-taymyrskie',
                name: 'Пельмени «Таймырские»',
                price: 758,
                unit: '/500 гр.',
                maxQty: 8,
                image: '❄️',
                imageUrl: 'images/products/zamorozhennye/pelmeni-taymyrskie.jpg',
                composition: 'оленина, лук, вода, соль поваренная, перец чёрный молотый. Тесто – мука пшеничная в/с, вода, соль, яичный меланж, масло растительное',
                nutrition: 'белки - 22 г, жиры - 6 г, углеводы - 28 г',
                calories: '220 ккал/921 кДж',
                storage: '10 месяцев',
                available: true
            },
            {
                id: 'pelmeni-los-griby',
                name: 'Пельмени с мясом лося и грибами',
                price: 780,
                unit: '/500 гр.',
                maxQty: 8,
                image: '❄️',
                imageUrl: 'images/products/zamorozhennye/pelmeni-los-griby.jpg',
                composition: 'мясо лося, говяжий жир, лук, вода, перец черный молотый, соль поваренная, грибы шампиньоны. Тесто: мука в/с, вода, яичный меланж, соль поваренная, масло растительное',
                nutrition: 'белки - 16 г, жиры - 12 г, углеводы - 28 г',
                calories: '220 ккал/921 кДж',
                storage: '10 месяцев',
                available: true
            },
            {
                id: 'pelmeni-chernye',
                name: 'Пельмени чёрные из оленины с трюфелем (ручная лепка)',
                price: 960,
                unit: '/500 гр.',
                maxQty: 6,
                image: '❄️',
                imageUrl: 'images/products/zamorozhennye/pelmeni-chernye.jpg',
                composition: 'фарш - оленина, масло сливочное, ежевика, соль, мускатный орех, орегано, трюфель -0,02%, Тесто – мука пшеничная в/с, вода, соль, яичный меланж, чернила каракатицы',
                nutrition: 'белки - 22 г, жиры - 6 г, углеводы - 28 г',
                calories: '220 ккал/921 кДж',
                storage: '10 месяцев',
                available: true
            }
        ],
        'polufabrikaty': [
            {
                id: 'okorok-olene',
                name: 'Окорок оленя',
                price: 1970,
                unit: '/кг',
                maxQty: 6,
                image: '🥓',
                imageUrl: 'images/products/polufabrikaty/okorok-olene.jpg',
                composition: 'оленина окорок высший сорт',
                nutrition: 'белки - 22 г, жиры - 11 г',
                calories: '260 ккал/1190 кДж',
                storage: '10 месяцев',
                available: true
            },
            {
                id: 'vyrezka-olene',
                name: 'Вырезка оленя',
                price: 3160,
                unit: '/кг',
                maxQty: 4,
                image: '🥓',
                imageUrl: 'images/products/polufabrikaty/vyrezka-olene.jpg',
                composition: 'вырезка оленя высший сорт',
                nutrition: 'Белки - 22 г, Жиры - 11 г',
                calories: '260 ккал/1190 кДж',
                storage: '10 месяцев',
                available: true
            },
            {
                id: 'koreyka-kost',
                name: 'Корейка оленя на кости',
                price: 3310,
                unit: '/кг',
                maxQty: 4,
                image: '🥓',
                imageUrl: 'images/products/polufabrikaty/koreyka-kost.jpg',
                composition: 'корейка оленя высший сорт',
                nutrition: 'Белки - 22 г, Жиры - 11 г',
                calories: '260 ккал/1190 кДж',
                storage: '10 месяцев',
                available: true
            },
            {
                id: 'kupaty-piknik',
                name: 'Купаты "Пикник"',
                price: 1268,
                unit: '/кг',
                maxQty: 8,
                image: '🥓',
                imageUrl: 'images/products/polufabrikaty/kupaty-piknik.jpg',
                composition: 'оленина, шпик, чеснок, сахар, экстракты пряностей, кориандр, черный перец, соль поваренная пищевая',
                nutrition: 'белки - 15,0 г, жиры - 21,0 г, углеводы - 1,5 г',
                calories: '260 ккал/1090 кДж',
                storage: '12 месяцев',
                available: true
            },
            {
                id: 'kupaty-tundra',
                name: 'Купаты "Тундра"',
                price: 1268,
                unit: '/кг',
                maxQty: 8,
                image: '🥓',
                imageUrl: 'images/products/polufabrikaty/kupaty-tundra.jpg',
                composition: 'оленина, шпик, лук, сахар, экстракты пряностей, соль поваренная пищевая',
                nutrition: 'белки - 15 г, жиры - 21 г, углеводы - 1 г',
                calories: '250 ккал/1050 кДж',
                storage: '12 месяцев',
                available: true
            },
            {
                id: 'kotleti-burger',
                name: 'Котлеты для бургера из мяса северного оленя',
                price: 290,
                unit: '/300 гр. (2 штуки)',
                maxQty: 10,
                image: '🥓',
                imageUrl: 'images/products/polufabrikaty/kotleti-burger.jpg',
                composition: 'мясо северного оленя рубленное, жир олений',
                nutrition: 'Белки - 17 г, Жиры - 12 г',
                calories: '270 ккал/980 кДж',
                storage: '10 месяцев',
                available: true
            },
            {
                id: 'lopatka-olene',
                name: 'Лопатка оленя без кости',
                price: 1770,
                unit: '/кг',
                maxQty: 6,
                image: '🥓',
                imageUrl: 'images/products/polufabrikaty/lopatka-olene.jpg',
                composition: 'оленина лопаточная часть без кости',
                nutrition: 'Белки - 19 г, Жиры - 4 г',
                calories: '112 ккал/780 кДж',
                storage: '10 месяцев',
                available: true
            }
        ],
        'pirogi-sytnye': [
            {
                id: 'pirog-ohotnichiy',
                name: 'Пирог с олениной охотничий',
                price: 880,
                unit: '/550 гр.',
                maxQty: 8,
                image: '🥧',
                imageUrl: 'images/products/pirogi-sytnye/pirog-ohotnichiy.jpg',
                composition: 'мука в/с, оленина в/с, томаты вяленые, масло оливковое, соль, сахар, яйцо, вода, дрожжи хлебопекарные, лук репчатый, морковь, специи',
                nutrition: 'Белки 11.55 г, Жиры 9.32 г, Углеводы 25.24 г',
                calories: '232.8 ккал/974.1 кДж',
                storage: '6 месяцев',
                available: true
            },
            {
                id: 'pirog-brusnika',
                name: 'Пирог с олениной и брусникой',
                price: 880,
                unit: '/550 гр.',
                maxQty: 8,
                image: '🥧',
                imageUrl: 'images/products/pirogi-sytnye/pirog-brusnika.jpg',
                composition: 'мука в/с, оленина в/с, брусника, соевый соус, соль, сахар, яйцо, вода, дрожжи хлебопекарные, масло растительное, лук репчатый, специи',
                nutrition: 'Белки 14.02 г, Жиры 9.12 г, Углеводы 23.42 г',
                calories: '233.2 ккал/917.6 кДж',
                storage: '6 месяцев',
                available: true
            },
            {
                id: 'pirog-griby-trufel',
                name: 'Пирог с олениной, грибами и трюфелем',
                price: 880,
                unit: '/550 гр.',
                maxQty: 8,
                image: '🥧',
                imageUrl: 'images/products/pirogi-sytnye/pirog-griby-trufel.jpg',
                composition: 'мука в/с, оленина в/с, шампиньоны свежие, трюфельная паста, масло оливковое, соль, сахар, яйцо, вода, дрожжи хлебопекарные, лук репчатый, специи',
                nutrition: 'Белки 13.02 г, Жиры 9.31 г, Углеводы 25.42 г',
                calories: '235.2 ккал/921.4 кДж',
                storage: '6 месяцев',
                available: true
            },
            {
                id: 'pirog-gribnoy',
                name: 'Пирог с грибным жюльеном',
                price: 964,
                unit: '/700 гр.',
                maxQty: 6,
                image: '🥧',
                imageUrl: 'images/products/pirogi-sytnye/pirog-gribnoy.jpg',
                composition: 'мука в/с, шампиньоны свежие, сливки натуральные, соль, сахар, яйцо, вода, дрожжи хлебопекарные, масло растительное, лук репчатый, специи',
                nutrition: 'Белки 8.8 г, Жиры 8.9 г, Углеводы 22.6 г',
                calories: '241.2 ккал/1009.68 кДж',
                storage: '6 месяцев',
                available: true
            },
            {
                id: 'pirog-kuritsa-griby',
                name: 'Пирог с курицей и грибами',
                price: 980,
                unit: '/700 гр.',
                maxQty: 6,
                image: '🥧',
                imageUrl: 'images/products/pirogi-sytnye/pirog-kuritsa-griby.jpg',
                composition: 'мука в/с, куриное филе, шампиньоны свежие, соль, сахар, яйцо, вода, дрожжи хлебопекарные, масло растительное, лук репчатый, специи',
                nutrition: 'Белки 11.4 г, Жиры 2.8 г, Углеводы 24.5 г',
                calories: '255.3 ккал/1085 кДж',
                storage: '6 месяцев',
                available: true
            },
            {
                id: 'pirog-kartofel-griby',
                name: 'Пирог с картофелем и грибами',
                price: 922,
                unit: '/700 гр.',
                maxQty: 6,
                image: '🥧',
                imageUrl: 'images/products/pirogi-sytnye/pirog-kartofel-griby.jpg',
                composition: 'мука в/с, картофель, шампиньоны свежие, соль, сахар, яйцо, вода, дрожжи хлебопекарные, масло растительное, лук репчатый, специи',
                nutrition: 'Белки 4.6 г, Жиры 7.8 г, Углеводы 18.4 г',
                calories: '154.8 ккал/904 кДж',
                storage: '6 месяцев',
                available: true
            },
            {
                id: 'pirog-krasnaya-ryba',
                name: 'Пирог с красной рыбой',
                price: 2460,
                unit: '/700 гр.',
                maxQty: 4,
                image: '🥧',
                imageUrl: 'images/products/pirogi-sytnye/pirog-krasnaya-ryba.jpg',
                composition: 'мука в/с, семга (лосось), соль, сахар, яйцо, вода, дрожжи хлебопекарные, масло растительное, лук репчатый, специи',
                nutrition: 'Белки 14.9 г, Жиры 13 г, Углеводы 24.6 г',
                calories: '274.7 ккал/1150.4 кДж',
                storage: '6 месяцев',
                available: true
            }
        ],
        'pirogi-sladkie': [
            {
                id: 'pirog-yabloko-smorodina',
                name: 'Пирог с яблоком и черной смородиной',
                price: 860,
                unit: '/700 гр.',
                maxQty: 6,
                image: '🧁',
                imageUrl: 'images/products/pirogi-sladkie/pirog-yabloko-smorodina.jpg',
                composition: 'мука в/с, яблоки натуральные, черная смородина натуральная, соль, сахар, яйцо, вода, масло растительное, дрожжи хлебопекарные',
                nutrition: 'Белки 6.2 г, Жиры 5.4 г, Углеводы 52.8 г',
                calories: '251.4 ккал/1163.3 кДж',
                storage: '6 месяцев',
                available: true
            },
            {
                id: 'pirog-vishnya',
                name: 'Пирог с вишней',
                price: 885,
                unit: '/700 гр.',
                maxQty: 6,
                image: '🧁',
                imageUrl: 'images/products/pirogi-sladkie/pirog-vishnya.jpg',
                composition: 'мука в/с, вишня натуральная, соль, сахар, яйцо, вода, масло растительное, дрожжи хлебопекарные',
                nutrition: 'Белки 6.5 г, Жиры 5.8 г, Углеводы 52.4 г',
                calories: '285.4 ккал/1195.4 кДж',
                storage: '6 месяцев',
                available: true
            },
            {
                id: 'pirog-tvorog-klubnika',
                name: 'Пирог с творогом и клубникой',
                price: 874,
                unit: '/700 гр.',
                maxQty: 6,
                image: '🧁',
                imageUrl: 'images/products/pirogi-sladkie/pirog-tvorog-klubnika.jpg',
                composition: 'мука в/с, клубника натуральная, крем ванильно-сливочный заварной, соль, сахар, яйцо, вода, масло растительное, дрожжи хлебопекарные',
                nutrition: 'Белки 8.3 г, Жиры 7.1 г, Углеводы 38.4 г',
                calories: '285.6 ккал/1049.2 кДж',
                storage: '6 месяцев',
                available: true
            },
            {
                id: 'pirog-tvorog-chernika',
                name: 'Пирог с творогом и черникой',
                price: 878,
                unit: '/700 гр.',
                maxQty: 6,
                image: '🧁',
                imageUrl: 'images/products/pirogi-sladkie/pirog-tvorog-chernika.jpg',
                composition: 'мука в/с, черника натуральная, крем ванильно-сливочный заварной соль, сахар, яйцо, вода, масло растительное, дрожжи хлебопекарные',
                nutrition: 'Белки 8.2 г, Жиры 6.8 г, Углеводы 37.8 г',
                calories: '258.6 ккал/1049.2 кДж',
                storage: '6 месяцев',
                available: true
            },
            {
                id: 'pirog-tvorog-malina',
                name: 'Пирог с творогом и малиной',
                price: 880,
                unit: '/700 гр.',
                maxQty: 6,
                image: '🧁',
                imageUrl: 'images/products/pirogi-sladkie/pirog-tvorog-malina.jpg',
                composition: 'мука в/с, малина натуральная, крем ванильно-сливочный заварной, соль, сахар, яйцо, вода, масло растительное, дрожжи хлебопекарные',
                nutrition: 'Белки 8.4 г, Жиры 7.2 г, Углеводы 38.1 г',
                calories: '250.8 ккал/1050 кДж',
                storage: '6 месяцев',
                available: true
            },
            {
                id: 'pirog-chernika',
                name: 'Пирог с черникой',
                price: 885,
                unit: '/700 гр.',
                maxQty: 6,
                image: '🧁',
                imageUrl: 'images/products/pirogi-sladkie/pirog-chernika.jpg',
                composition: 'мука в/с, черника натуральная, соль, сахар, яйцо, вода, масло растительное, дрожжи хлебопекарные',
                nutrition: 'Белки 2.7 г, Жиры 9.9 г, Углеводы 33.4 г',
                calories: '245.8 ккал/1026.18 кДж',
                storage: '6 месяцев',
                available: true
            },
            {
                id: 'pirog-yabloko-brusnika',
                name: 'Пирог с яблоком и брусникой',
                price: 868,
                unit: '/700 гр.',
                maxQty: 6,
                image: '🧁',
                imageUrl: 'images/products/pirogi-sladkie/pirog-yabloko-brusnika.jpg',
                composition: 'мука в/с, брусника натуральная, яблоки натуральные, соль, сахар, яйцо, вода, масло растительное, дрожжи хлебопекарные',
                nutrition: 'Белки 3.5 г, Жиры 4 г, Углеводы 35.7 г',
                calories: '192.3 ккал/805.25 кДж',
                storage: '6 месяцев',
                available: true
            },
            {
                id: 'pirog-yabloko',
                name: 'Пирог с яблоком',
                price: 860,
                unit: '/700 гр.',
                maxQty: 6,
                image: '🧁',
                imageUrl: 'images/products/pirogi-sladkie/pirog-yabloko.jpg',
                composition: 'мука в/с, яблоки натуральные, соль, сахар, яйцо, вода, масло растительное, дрожжи хлебопекарные',
                nutrition: 'Белки 9.2 г, Жиры 5.4 г, Углеводы 52.8 г',
                calories: '258.4 ккал/1184.3 кДж',
                storage: '6 месяцев',
                available: true
            }
        ]
        // ✅ ГОТОВО! ВСЕ 8 КАТЕГОРИЙ, 49 ТОВАРОВ!
    };
}

// 📞 ФУНКЦИЯ ФОРМАТИРОВАНИЯ НОМЕРА ТЕЛЕФОНА ДЛЯ YOOKASSA
function formatPhoneForYooKassa(phone) {
    if (!phone) return '+79000000000';
    
    // Убираем все символы кроме цифр
    let cleanPhone = phone.replace(/\D/g, '');
    
    // Если номер начинается с 8, заменяем на 7
    if (cleanPhone.startsWith('8')) {
        cleanPhone = '7' + cleanPhone.substring(1);
    }
    
    // Если номер начинается с 7 и имеет 11 цифр, добавляем +
    if (cleanPhone.startsWith('7') && cleanPhone.length === 11) {
        return '+' + cleanPhone;
    }
    
    // Если номер начинается с 7 и имеет 10 цифр, добавляем +7
    if (cleanPhone.startsWith('7') && cleanPhone.length === 10) {
        return '+7' + cleanPhone;
    }
    
    // Если номер не соответствует формату, возвращаем fallback
    logger.warn(`⚠️ Некорректный формат номера телефона: ${phone}, используем fallback`);
    return '+79000000000';
}

// 💳 ФУНКЦИЯ СОЗДАНИЯ ПЛАТЕЖА В YOOKASSA
async function createYooKassaPayment(orderId, amount, description, customerInfo) {
    try {
        const formattedPhone = formatPhoneForYooKassa(customerInfo.phone);
        logger.debug('💳 Создаем платеж ЮKassa с параметрами:', {
            amount: amount.toFixed(2) + ' RUB',
            description: description,
            customer: customerInfo.customerName,
            originalPhone: customerInfo.phone,
            formattedPhone: formattedPhone
        });
        
        const paymentData = {
            amount: {
                value: amount.toFixed(2),
                currency: 'RUB'
            },
            confirmation: {
                type: 'redirect',
                return_url: `https://tundra-miniapp-production.up.railway.app/payment/success?order=${orderId}`
            },
            capture: true,
            description: description,
            receipt: {
                customer: {
                    email: customerInfo.email || 'customer@example.com',
                    phone: formattedPhone
                },
                items: [
                    {
                        description: description,
                        quantity: '1',
                        amount: {
                            value: amount.toFixed(2),
                            currency: 'RUB'
                        },
                        vat_code: 1, // НДС 20%
                        payment_mode: 'full_payment',
                        payment_subject: 'commodity'
                    }
                ]
            },
            metadata: {
                orderId: orderId,
                customerName: customerInfo.customerName || 'Клиент',
                phone: customerInfo.phone || ''
            },
            // Добавляем webhook URL для уведомлений
            webhook_url: 'https://tundra-miniapp-production.up.railway.app/webhook/yookassa'
        };
        
        // Создаем уникальный ключ идемпотентности
        const idempotenceKey = crypto.randomUUID();
        logger.debug('🔑 Idempotence Key:', idempotenceKey);
        logger.debug('📋 Данные платежа для YooKassa:', JSON.stringify(paymentData, null, 2));
        
        const payment = await checkout.createPayment(paymentData, idempotenceKey);

        logger.info(`✅ Платеж создан в ЮKassa: ${payment.id} на сумму ${amount}₽`);
        logger.debug(`🔗 URL подтверждения: ${payment.confirmation?.confirmation_url}`);
        return payment;
    } catch (error) {
        logger.error('❌ Ошибка создания платежа ЮKassa:', error.message);
        if (error.response) {
            logger.error('📋 Детали ошибки YooKassa:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
        }
        throw error;
    }
}

// 🔢 ИНИЦИАЛИЗАЦИЯ СЧЕТЧИКА ЗАКАЗОВ ИЗ БД
async function initializeOrderCounter() {
    try {
        // Получаем максимальный ID заказа из БД
        const result = await OrdersDB.getMaxOrderId();
        if (result && result.max_id) {
            orderCounter = parseInt(result.max_id);
            logger.info(`🔢 Счетчик заказов инициализирован: ${orderCounter}`);
        } else {
            orderCounter = 0;
            logger.info('🔢 Счетчик заказов инициализирован: 0 (нет заказов в БД)');
        }
    } catch (error) {
        logger.error('❌ Ошибка инициализации счетчика заказов:', error.message);
        orderCounter = 0; // Fallback
    }
}

// Функции для работы с заказами
async function createOrder(orderData) {
    orderCounter++;
    const orderId = orderCounter.toString();
    
    const order = {
        id: orderId,
        status: 'new', // new, accepted, preparing, delivering, completed, cancelled, expired
        paymentStatus: 'pending', // pending, paid, cancelled, expired
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 минут
        ...orderData
    };
    
    // 💾 СОХРАНЯЕМ В БД И В ПАМЯТЬ
    orders.set(orderId, order);
    
    // Сохраняем в базу данных
    try {
        const dbOrder = {
            orderId: order.id,
            userId: order.userId || order.telegramUserId || 'unknown',
            userName: order.customerName || 'Клиент',
            phone: order.phone || '',
            deliveryZone: order.deliveryZone || 'moscow',
            address: JSON.stringify(order.address || {}),
            items: JSON.stringify(order.cartItems || []),
            totalAmount: order.totals?.total || 0,
            status: order.status,
            paymentStatus: order.paymentStatus,
            paymentId: order.paymentId || null,
            paymentUrl: order.paymentUrl || null,
            comment: order.comment || '',
            telegramUsername: order.telegramUsername || null
        };
        
        await OrdersDB.create(dbOrder);
        logger.debug(`💾 Заказ ${orderId} сохранен в БД`);
    } catch (error) {
        logger.error(`❌ Ошибка сохранения заказа ${orderId} в БД:`, error.message);
    }
    
    // 🔥 ЗАПУСКАЕМ ТАЙМЕР АВТООТМЕНЫ НА 10 МИНУТ
    const timer = setTimeout(() => {
        autoExpireOrder(orderId);
    }, 10 * 60 * 1000); // 10 минут
    
    orderTimers.set(orderId, timer);
    
    logger.debug(`🔥 Заказ ${orderId} создан. Автоотмена через 10 минут.`);
    
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
        logger.warn(`⚠️ Заказ ${orderId} не найден для автоотмены`);
        return;
    }
    
    // Проверяем, не был ли заказ уже оплачен
    if (order.paymentStatus === 'paid') {
        logger.debug(`✅ Заказ ${orderId} уже оплачен, отмена отменена`);
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
    
    logger.info(`⏰ Заказ ${orderId} автоматически отменен (время истекло)`);
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
    logger.debug(`🔥 Таймер заказа ${orderId} отменен (заказ оплачен)`);
}

// Настройка статических файлов (ПОЛНОСТЬЮ БЕЗ ОГРАНИЧЕНИЙ)
const webRoot = path.join(__dirname, 'webapp');
app.use(express.static(webRoot));

// Применяем CORS и rate limiting только к API
app.use('/api', cors(corsOptions));
app.use('/api', limiter);
app.use('/webhook', cors(corsOptions));
app.use('/webhook', limiter);

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

// Тестовый эндпоинт для проверки ЮKassa
app.get('/test-yookassa', async (req, res) => {
    try {
        logger.info('🧪 Тестируем ЮKassa API...');
        
        if (!config.YOOKASSA_SHOP_ID || !config.YOOKASSA_SECRET_KEY) {
            return res.status(500).json({ 
                ok: false, 
                error: 'Ключи ЮKassa не настроены',
                shopId: config.YOOKASSA_SHOP_ID,
                secretKey: config.YOOKASSA_SECRET_KEY ? 'ЕСТЬ' : 'НЕТ'
            });
        }
        
        // Тест 1: Проверка доступности API
        const meResponse = await axios.get('https://api.yookassa.ru/v3/me', {
            auth: {
                username: config.YOOKASSA_SHOP_ID,
                password: config.YOOKASSA_SECRET_KEY
            },
            timeout: 10000
        });
        
        logger.info('✅ API доступен');
        
        // Тест 2: Создание тестового платежа
        const testPaymentData = {
            amount: {
                value: "1.00",
                currency: "RUB"
            },
            confirmation: {
                type: "redirect",
                return_url: "https://tundra-miniapp-production.up.railway.app"
            },
            description: "Тестовый платеж для проверки API",
            metadata: {
                test: "true"
            }
        };
        
        const testIdempotenceKey = crypto.randomUUID();
        const paymentResponse = await axios.post('https://api.yookassa.ru/v3/payments', testPaymentData, {
            headers: {
                'Content-Type': 'application/json',
                'Idempotence-Key': testIdempotenceKey
            },
            auth: {
                username: config.YOOKASSA_SHOP_ID,
                password: config.YOOKASSA_SECRET_KEY
            },
            timeout: 30000
        });
        
        logger.info('✅ Тестовый платеж создан:', paymentResponse.data.id);
        
        res.json({
            ok: true,
            message: 'ЮKassa работает корректно',
            accountInfo: meResponse.data,
            testPayment: {
                id: paymentResponse.data.id,
                status: paymentResponse.data.status,
                confirmationUrl: paymentResponse.data.confirmation?.confirmation_url
            }
        });
        
    } catch (error) {
        logger.error('❌ Тест ЮKassa провалился:', error.message);
        
        res.status(500).json({
            ok: false,
            error: error.message,
            details: error.response?.data || null,
            status: error.response?.status || null,
            shopId: config.YOOKASSA_SHOP_ID,
            secretKeyLength: config.YOOKASSA_SECRET_KEY?.length || 0
        });
    }
});

// Webhook для обработки уведомлений от ЮKassa
app.post('/webhook/yookassa', express.raw({type: 'application/json'}), async (req, res) => {
    try {
        logger.info('🔔 WEBHOOK: Получено уведомление от ЮKassa');
        logger.info('📦 WEBHOOK: Тип req.body:', typeof req.body);
        logger.info('📦 WEBHOOK: req.body:', req.body);
        logger.info('📦 WEBHOOK: Headers:', req.headers);
        
        let notification;
        
        // Проверяем тип данных и парсим соответственно
        if (typeof req.body === 'string') {
            notification = JSON.parse(req.body);
        } else if (Buffer.isBuffer(req.body)) {
            notification = JSON.parse(req.body.toString());
        } else if (typeof req.body === 'object' && req.body !== null) {
            // Если уже объект, используем как есть
            notification = req.body;
        } else {
            throw new Error(`Неожиданный тип данных: ${typeof req.body}`);
        }
        
        // Проверяем тип уведомления (YooKassa отправляет type: 'notification' и event: 'payment.succeeded')
        logger.info('🔍 WEBHOOK: Проверяем уведомление:', {
            type: notification.type,
            event: notification.event,
            hasObject: !!notification.object
        });
        
        if (notification.type === 'notification' && notification.event === 'payment.succeeded') {
            const payment = notification.object;
            logger.info('✅ WEBHOOK: Платеж успешно завершен:', payment.id);
            logger.info('🔍 WEBHOOK: Данные платежа:', {
                id: payment.id,
                status: payment.status,
                amount: payment.amount,
                metadata: payment.metadata
            });
            
            // Обновляем статус заказа в базе данных
            if (payment.metadata && payment.metadata.orderId) {
                const orderId = payment.metadata.orderId;
                logger.info('🔄 Обновляем статус заказа:', orderId);
                
                try {
                    // Обновляем статус заказа
                    await OrdersDB.update(orderId, { 
                        status: 'accepted',
                        payment_status: 'paid',
                        payment_id: payment.id
                    });
                    
                    // Получаем данные заказа для создания записи в истории покупок
                    const order = await OrdersDB.getById(orderId);
                    if (order) {
                        // Создаем запись в истории покупок
                        await PurchaseHistoryDB.create({
                            order_id: orderId,
                            user_id: order.user_id,
                            customer_name: order.user_name,
                            phone: order.phone,
                            total_amount: parseFloat(payment.amount.value),
                            items_count: Array.isArray(order.items) ? order.items.length : JSON.parse(order.items || '[]').length,
                            items_data: typeof order.items === 'string' ? order.items : JSON.stringify(order.items),
                            payment_id: payment.id,
                            delivery_zone: order.delivery_zone,
                            address_data: order.address // address уже строка JSON
                        });
                        
                        logger.info('✅ Заказ обновлен и добавлен в историю покупок');
                        logger.debug('📊 Данные для истории покупок:', {
                            orderId: orderId,
                            userId: order.user_id,
                            totalAmount: parseFloat(payment.amount.value),
                            itemsCount: Array.isArray(order.items) ? order.items.length : JSON.parse(order.items || '[]').length
                        });
                        
                        // Отправляем уведомление в Telegram (если настроен бот)
                        logger.debug('🔍 Проверка настроек Telegram в webhook:', {
                            hasToken: !!config.TELEGRAM_BOT_TOKEN,
                            tokenLength: config.TELEGRAM_BOT_TOKEN?.length || 0,
                            hasChatId: !!config.TELEGRAM_ADMIN_CHAT_ID,
                            chatId: config.TELEGRAM_ADMIN_CHAT_ID
                        });
                        
                        if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_ADMIN_CHAT_ID) {
                            try {
                                // Парсим адрес из JSON строки
                                const addressData = typeof order.address === 'string' ? JSON.parse(order.address) : order.address;
                                
                                // Формируем полный адрес
                                const fullAddress = [
                                    addressData.street,
                                    addressData.house,
                                    addressData.apartment && `кв. ${addressData.apartment}`,
                                    addressData.floor && `эт. ${addressData.floor}`,
                                    addressData.entrance && `под. ${addressData.entrance}`,
                                    addressData.intercom && `домофон: ${addressData.intercom}`
                                ].filter(Boolean).join(', ');
                                
                                // Формируем состав заказа
                                let orderItems = 'Состав заказа недоступен';
                                let itemsArray = [];
                                
                                if (order.items) {
                                    if (typeof order.items === 'string') {
                                        try {
                                            itemsArray = JSON.parse(order.items);
                                        } catch (e) {
                                            logger.error('❌ Ошибка парсинга order.items:', e.message);
                                            itemsArray = [];
                                        }
                                    } else if (Array.isArray(order.items)) {
                                        itemsArray = order.items;
                                    }
                                }
                                
                                if (Array.isArray(itemsArray) && itemsArray.length > 0) {
                                    orderItems = itemsArray.map(item => 
                                        `• ${item.name} x${item.quantity} - ${item.price * item.quantity}₽`
                                    ).join('\n');
                                }
                                
                                const message = 
                                    `🎉 <b>ЗАКАЗ ОПЛАЧЕН!</b>\n` +
                                    `📋 Номер: #${orderId}\n` +
                                    `👤 Клиент: ${order.user_name}\n` +
                                    `📞 Телефон: ${order.phone}\n` +
                                    `💰 Сумма: ${payment.amount.value} ${payment.amount.currency}\n` +
                                    `💳 ID платежа: ${payment.id}\n` +
                                    `📍 Зона доставки: ${order.delivery_zone}\n` +
                                    `🏠 Адрес: ${fullAddress}\n` +
                                    `📦 <b>Состав заказа:</b>\n${orderItems}` +
                                    (order.comment ? `\n💬 Комментарий: ${order.comment}` : '');
                                
                                // Создаем кнопки для оплаченного заказа
                                const inlineKeyboard = {
                                    inline_keyboard: [
                                        [
                                            { text: '🟡 Принять', callback_data: `accept_${orderId}` },
                                            { text: '🔴 Отменить', callback_data: `cancel_${orderId}` }
                                        ],
                                        [
                                            { text: '🚚 В доставке', callback_data: `delivering_${orderId}` },
                                            { text: '✅ Завершить', callback_data: `complete_${orderId}` }
                                        ]
                                    ]
                                };
                                
                                await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                    chat_id: config.TELEGRAM_ADMIN_CHAT_ID,
                                    text: message,
                                    parse_mode: 'HTML',
                                    reply_markup: inlineKeyboard
                                });
                                
                                logger.info('📱 Уведомление об оплаченном заказе отправлено в Telegram');
                            } catch (telegramError) {
                                logger.error('❌ Ошибка отправки в Telegram:', telegramError.message);
                                if (telegramError.response?.status === 401) {
                                    logger.error('❌ Ошибка авторизации Telegram: неверный токен бота');
                                } else if (telegramError.response?.status === 400) {
                                    logger.error('❌ Ошибка Telegram: неверный Chat ID');
                                }
                            }
                        } else {
                            logger.warn('⚠️ Telegram бот не настроен - уведомление не отправлено');
                            logger.warn(`   Токен: ${config.TELEGRAM_BOT_TOKEN ? 'есть' : 'отсутствует'}`);
                            logger.warn(`   Chat ID: ${config.TELEGRAM_ADMIN_CHAT_ID ? 'есть' : 'отсутствует'}`);
                        }
                    }
                } catch (dbError) {
                    logger.error('❌ Ошибка обновления заказа в БД:', dbError.message);
                }
            }
        } else if (notification.type === 'notification' && notification.event === 'payment.canceled') {
            const payment = notification.object;
            logger.info('❌ Платеж отменен:', payment.id);
            
            // Обновляем статус заказа
            if (payment.metadata && payment.metadata.orderId) {
                await OrdersDB.update(payment.metadata.orderId, { 
                    status: 'canceled',
                    paymentId: payment.id
                });
                logger.info('🔄 Статус заказа обновлен на "отменен"');
            }
        } else {
            logger.warn('⚠️ WEBHOOK: Неизвестный тип уведомления:', {
                type: notification.type,
                event: notification.event,
                fullNotification: notification
            });
        }
        
        logger.info('✅ WEBHOOK: Обработка завершена успешно');
        res.status(200).send('OK');
    } catch (error) {
        logger.error('❌ WEBHOOK: Ошибка обработки webhook:', error.message);
        logger.error('❌ WEBHOOK: Стек ошибки:', error.stack);
        logger.error('❌ WEBHOOK: req.body тип:', typeof req.body);
        logger.error('❌ WEBHOOK: req.body содержимое:', req.body);
        res.status(500).send('Error');
    }
});

// Тестовый endpoint для проверки webhook
app.get('/test-webhook', (req, res) => {
    logger.info('🧪 Тестовый запрос к webhook endpoint');
    res.json({
        message: 'Webhook endpoint работает',
        timestamp: new Date().toISOString(),
        url: '/webhook/yookassa'
    });
});

// API для заказов
app.post('/api/orders', validateOrderData, async (req, res) => {
    logger.info('🔥 Создание нового заказа');
    let order = null;
    
    // Режим продакшена - без демо-режима
    
    try {
        const orderData = req.body;
        
        // Создаем заказ
        order = await createOrder(orderData);
        logger.info(`✅ Заказ #${order.id} создан, сумма: ${order.totals?.total || 0}₽`);
        
        // Получаем данные клиента (приоритет: Telegram > форма > fallback)
        const telegramUser = orderData.telegramUser;
        
        const customerName = telegramUser?.full_name || 
                           telegramUser?.first_name || 
                           orderData.customerName || 
                           'Клиент';
        
        // 💳 СОЗДАЕМ ПЛАТЕЖ В YOOKASSA
        const totalAmount = order.totals?.total || 0;
        const description = `Заказ #${order.id} - ${customerName}`;
        
        if (!config.YOOKASSA_SHOP_ID || !config.YOOKASSA_SECRET_KEY) {
            logger.error('❌ ЮKassa ключи не настроены');
            throw new Error('ЮKassa ключи не настроены');
        }
        
        if (!checkout) {
            logger.error('❌ ЮKassa не инициализирована');
            throw new Error('ЮKassa недоступна');
        }
        
        const customerInfo = {
            customerName: customerName,
            phone: order.phone || '',
            telegramUsername: telegramUser?.username || null
        };
        
        // Добавляем данные клиента в заказ
        order.customerName = customerInfo.customerName;
        order.telegramUsername = customerInfo.telegramUsername;
        order.telegramUserId = telegramUser?.id || null; // Сохраняем Telegram ID для уведомлений
        
        // Создаем реальный платеж через ЮKassa
        const payment = await createYooKassaPayment(order.id, totalAmount, description, customerInfo);
        
        // Сохраняем ID платежа в заказе
        order.paymentId = payment.id;
        order.paymentUrl = payment.confirmation.confirmation_url;
        orders.set(order.id, order);
        
        // Уведомление в Telegram будет отправлено только после оплаты заказа
        logger.info(`📝 Заказ ${order.id} создан, ожидает оплаты`);
        
        // Обновляем в БД
        try {
            const updateData = {
                paymentId: order.paymentId,
                paymentUrl: order.paymentUrl,
                status: order.status
            };
            await OrdersDB.update(order.id, updateData);
        } catch (dbError) {
            logger.error(`❌ Ошибка обновления заказа в БД:`, dbError.message);
        }
        
        logger.info(`✅ Заказ #${order.id} и платеж созданы успешно`);
        
        const response = { 
            ok: true, 
            orderId: order.id,
            paymentUrl: payment.confirmation.confirmation_url,
            paymentId: payment.id,
            amount: totalAmount
        };
        
        res.json(response);
    } catch (error) {
        logger.error('❌ Ошибка обработки заказа:', error.message);
        
        // Возвращаем ошибку клиенту
        res.status(500).json({ 
            ok: false, 
            error: 'Ошибка создания заказа',
            message: 'Не удалось создать заказ. Попробуйте еще раз.'
        });
    }
});

// API для получения истории покупок клиента
app.get('/api/purchases/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        // Загружаем историю покупок из БД
        const purchases = await PurchaseHistoryDB.getByUserId(userId);
        
        // Подсчитываем статистику лояльности
        const totalPurchases = purchases.length;
        const totalSpent = purchases.reduce((sum, purchase) => sum + (purchase.totalAmount || 0), 0);
        
        // 🏆 ЛОГИКА КАРТЫ ЛОЯЛЬНОСТИ ПО УРОВНЯМ
        let loyaltyLevel, currentDiscount, nextLevelTarget, nextLevelProgress;
        
        if (totalSpent < 10000) {
            // 💜 0₽ - 9,999₽ → 0% скидка
            loyaltyLevel = 0;
            currentDiscount = 0;
            nextLevelTarget = 10000;
            nextLevelProgress = (totalSpent / 10000) * 100;
        } else if (totalSpent < 25000) {
            // ⭐ 10,000₽ - 24,999₽ → 3% скидка
            loyaltyLevel = 1;
            currentDiscount = 3;
            nextLevelTarget = 25000;
            nextLevelProgress = ((totalSpent - 10000) / (25000 - 10000)) * 100;
        } else if (totalSpent < 50000) {
            // ⭐ 25,000₽ - 49,999₽ → 5% скидка
            loyaltyLevel = 2;
            currentDiscount = 5;
            nextLevelTarget = 50000;
            nextLevelProgress = ((totalSpent - 25000) / (50000 - 25000)) * 100;
        } else {
            // ⭐ 50,000₽+ → 10% скидка
            loyaltyLevel = 3;
            currentDiscount = 10;
            nextLevelTarget = null; // максимальный уровень
            nextLevelProgress = 100;
        }
        
        res.json({
            ok: true,
            purchases,
            stats: {
                totalPurchases,
                totalSpent,
                loyaltyLevel,
                currentDiscount,
                nextLevelProgress: Math.round(nextLevelProgress),
                nextLevelTarget,
                levelName: loyaltyLevel === 0 ? "Новичок" : 
                          loyaltyLevel === 1 ? "Бронза" :
                          loyaltyLevel === 2 ? "Серебро" : "Золото"
            }
        });
        
    } catch (error) {
        logger.error('❌ Ошибка получения истории покупок:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// API для получения всех заказов
app.get('/api/orders', (req, res) => {
    try {
        const allOrders = getAllOrders();
        res.json({ ok: true, orders: allOrders });
    } catch (error) {
        logger.error('Ошибка получения заказов:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// API для получения конкретного заказа
app.get('/api/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        logger.info(`🔍 API: Запрос статуса заказа ${orderId}`);
        
        // Сначала пробуем получить из памяти (для новых заказов)
        let order = getOrder(orderId);
        logger.info(`🔍 API: Заказ ${orderId} в памяти:`, order ? 'найден' : 'не найден');
        
        // Если не найден в памяти, ищем в базе данных
        if (!order) {
            logger.info(`🔍 API: Ищем заказ ${orderId} в базе данных...`);
            order = await OrdersDB.getById(orderId);
            if (order) {
                logger.info(`✅ API: Заказ ${orderId} найден в БД:`, {
                    status: order.status,
                    payment_status: order.payment_status,
                    total_amount: order.total_amount
                });
                
                // Конвертируем данные из БД в формат, ожидаемый клиентом
                order = {
                    id: order.id,
                    status: order.status,
                    paymentStatus: order.payment_status,
                    totals: {
                        total: parseFloat(order.total_amount || 0)
                    },
                    items: typeof order.items === 'string' ? JSON.parse(order.items) : order.items,
                    address: typeof order.address === 'string' ? JSON.parse(order.address) : order.address,
                    phone: order.phone,
                    customerName: order.user_name,
                    createdAt: order.created_at
                };
            } else {
                logger.warn(`❌ API: Заказ ${orderId} не найден в БД`);
            }
        }
        
        if (order) {
            logger.info(`✅ API: Возвращаем заказ ${orderId}:`, {
                status: order.status,
                paymentStatus: order.paymentStatus,
                total: order.totals?.total
            });
            res.json({ ok: true, order });
        } else {
            logger.warn(`❌ API: Заказ ${orderId} не найден`);
            res.status(404).json({ ok: false, error: 'Заказ не найден' });
        }
    } catch (error) {
        logger.error('❌ API: Ошибка получения заказа:', error.message);
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
            logger.info(`📝 Статус заказа ${orderId} изменен на: ${status}`);
            res.json({ ok: true, order });
        } else {
            res.status(404).json({ ok: false, error: 'Заказ не найден' });
        }
    } catch (error) {
        logger.error('Ошибка обновления статуса:', error.message);
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
            logger.debug('Получено сообщение:', message.text);
        }
        
        res.json({ ok: true });
    } catch (error) {
        logger.error('Ошибка обработки Telegram webhook:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Функция обработки callback query (нажатия на кнопки)
async function handleCallbackQuery(callbackQuery) {
    try {
        const { data, message, from } = callbackQuery;
        const [action, orderId] = data.split('_');
        
        logger.debug(`Обработка действия: ${action} для заказа ${orderId}`);
        
        let order = getOrder(orderId);
        if (!order) {
            logger.error(`Заказ ${orderId} не найден`);
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
                logger.error(`Неизвестное действие: ${action}`);
                return;
        }
        
        // Обновляем статус заказа в памяти
        order = updateOrderStatus(orderId, newStatus);
        
        // 🔥 ОБНОВЛЯЕМ СТАТУС В БАЗЕ ДАННЫХ
        try {
            await OrdersDB.update(orderId, { 
                status: newStatus,
                updated_at: new Date().toISOString()
            });
            logger.info(`💾 Статус заказа ${orderId} обновлен в БД: ${newStatus}`);
        } catch (dbError) {
            logger.error(`❌ Ошибка обновления статуса в БД:`, dbError.message);
        }
        
        // Обновляем сообщение в админ-группе
        await updateOrderMessage(message.chat.id, message.message_id, order, newStatus);
        
        // 📱 ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ КЛИЕНТУ
        if (order.telegramUserId && config.TELEGRAM_BOT_TOKEN) {
            try {
                const clientMessage = `📦 <b>Обновление заказа #${orderId}</b>\n\n` +
                    `Статус изменен на: ${statusEmoji} <b>${statusText}</b>\n\n` +
                    `💰 Сумма: ${order.totals?.total || 0}₽\n` +
                    `📍 Адрес: ${order.address?.street}, ${order.address?.house}`;
                
                await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: order.telegramUserId,
                    text: clientMessage,
                    parse_mode: 'HTML'
                });
                
                logger.info(`📱 Уведомление клиенту отправлено для заказа ${orderId}`);
            } catch (error) {
                logger.error(`❌ Ошибка отправки уведомления клиенту:`, error.message);
            }
        } else {
            logger.warn(`⚠️ Не удалось отправить уведомление клиенту: telegramUserId=${order.telegramUserId}, token=${!!config.TELEGRAM_BOT_TOKEN}`);
        }
        
        // Отправляем подтверждение
        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackQuery.id,
            text: `Статус заказа #${orderId} изменен на "${statusText}"`
        });
        
        logger.info(`Статус заказа ${orderId} изменен на ${newStatus}`);
        
    } catch (error) {
        logger.error('Ошибка обработки callback query:', error.message);
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
        logger.error('Ошибка обновления сообщения:', error.message);
    }
}

// Webhook для ЮKassa - УДАЛЕН (дублирует /webhook/yookassa)

// Функции обработки платежей - УДАЛЕНЫ (логика перенесена в основной webhook)

// API для создания платежа через ЮKassa - УДАЛЕН (дублирует /api/orders)

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

// 🔧 MIDDLEWARE ДЛЯ ВАЛИДАЦИИ ДАННЫХ
function validateOrderData(req, res, next) {
    const { cartItems, address, phone, customerName, deliveryZone } = req.body;
    
    // Логируем входящие данные для отладки
    logger.debug('🔍 Валидация заказа:', {
        cartItems: cartItems?.length || 0,
        address: address ? 'есть' : 'нет',
        phone: phone ? 'есть' : 'нет',
        customerName: customerName ? 'есть' : 'нет',
        deliveryZone: deliveryZone || 'нет'
    });
    
    // Проверяем обязательные поля
    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
        logger.error('❌ Валидация: Корзина пуста');
        return res.status(400).json({
            ok: false,
            error: 'Корзина не может быть пустой'
        });
    }
    
    if (!address || !address.street || !address.house) {
        logger.error('❌ Валидация: Адрес неполный:', address);
        return res.status(400).json({
            ok: false,
            error: 'Необходимо указать адрес доставки'
        });
    }
    
    if (!phone || typeof phone !== 'string' || phone.trim().length < 10) {
        logger.error('❌ Валидация: Телефон некорректный:', phone);
        return res.status(400).json({
            ok: false,
            error: 'Необходимо указать корректный номер телефона'
        });
    }
    
    // Имя клиента не обязательно (не отправляется из frontend)
    // if (!customerName || typeof customerName !== 'string' || customerName.trim().length < 2) {
    //     logger.error('❌ Валидация: Имя клиента некорректное:', customerName);
    //     return res.status(400).json({
    //         ok: false,
    //         error: 'Необходимо указать имя клиента'
    //     });
    // }
    
    if (!deliveryZone || !['moscow', 'mo'].includes(deliveryZone)) {
        logger.error('❌ Валидация: Зона доставки некорректная:', deliveryZone);
        return res.status(400).json({
            ok: false,
            error: 'Необходимо выбрать зону доставки'
        });
    }
    
    // Валидируем товары в корзине
    for (const item of cartItems) {
        if (!item.productId || !item.name || !item.price || !item.quantity) {
            logger.error('❌ Валидация: Товар некорректный:', item);
            return res.status(400).json({
                ok: false,
                error: 'Некорректные данные товара в корзине'
            });
        }
        
        if (typeof item.price !== 'number' || item.price <= 0) {
            logger.error('❌ Валидация: Цена товара некорректная:', item.price);
            return res.status(400).json({
                ok: false,
                error: 'Некорректная цена товара'
            });
        }
        
        if (typeof item.quantity !== 'number' || item.quantity <= 0 || item.quantity > 50) {
            logger.error('❌ Валидация: Количество товара некорректное:', item.quantity);
            return res.status(400).json({
                ok: false,
                error: 'Некорректное количество товара'
            });
        }
    }
    
    logger.info('✅ Валидация заказа прошла успешно');
    next();
}

// Middleware для валидации админских запросов
function validateAdminData(req, res, next) {
    const { products } = req.body;
    
    if (!products || typeof products !== 'object') {
        return res.status(400).json({ 
            ok: false, 
            error: 'Некорректные данные товаров' 
        });
    }
    
    next();
}

// Middleware для валидации ID товара
function validateProductId(req, res, next) {
    const { productId } = req.params;
    
    if (!productId || typeof productId !== 'string' || productId.trim().length === 0) {
        return res.status(400).json({ 
            ok: false, 
            error: 'Некорректный ID товара' 
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
        logger.error('❌ Ошибка получения товаров:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔧 API ДЛЯ АДМИН ПАНЕЛИ

// Получение всех заказов для админ панели
app.get('/api/admin/orders', requireAdminAuth, async (req, res) => {
    try {
        const orders = await OrdersDB.getAll();
        logger.info(`📋 Загружено ${orders.length} заказов для админ панели`);
        res.json({ ok: true, orders });
    } catch (error) {
        logger.error('❌ Ошибка загрузки заказов:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Получение заказов пользователя (все заказы кроме отмененных)
app.get('/api/orders/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const orders = await OrdersDB.getByUserId(userId);
        
        // Показываем все заказы кроме отмененных
        const activeOrders = orders.filter(order => order.status !== 'cancelled' && order.status !== 'expired');
        
        logger.info(`📋 Загружено ${activeOrders.length} активных заказов для пользователя ${userId}`);
        res.json({ ok: true, orders: activeOrders });
    } catch (error) {
        logger.error('❌ Ошибка загрузки заказов пользователя:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Дублирующийся endpoint удален - используется основной /api/orders/:orderId выше

// Получение всех товаров для админ панели
app.get('/api/admin/products', requireAdminAuth, async (req, res) => {
    try {
        // 🗄️ ЗАГРУЖАЕМ ИЗ БАЗЫ ДАННЫХ
        let products = await AdminProductsDB.loadAll();
        
        // 🔄 ИНИЦИАЛИЗАЦИЯ ТОЛЬКО ЕСЛИ БД ПОЛНОСТЬЮ ПУСТА (ПЕРВЫЙ ЗАПУСК)
        if (Object.keys(products).length === 0) {
            logger.info('🔄 БД пуста, инициализируем полным ассортиментом товаров...');
            
            // Полный ассортимент товаров (все 49 товаров)
            const fullProducts = await loadFullProductCatalog();
            
            // Сохраняем в БД ТОЛЬКО ОДИН РАЗ
            try {
                await AdminProductsDB.saveAll(fullProducts);
                logger.info('✅ Полный каталог товаров сохранен в БД ПЕРВЫЙ РАЗ');
                products = fullProducts;
                
                // Заполняем локальный кэш
                Object.entries(fullProducts).forEach(([categoryId, categoryProducts]) => {
                    adminProducts.set(categoryId, categoryProducts);
                });
            } catch (error) {
                logger.error('❌ Ошибка сохранения полного каталога:', error.message);
                products = fullProducts; // Используем как fallback
            }
        } else {
            // ✅ ИСПОЛЬЗУЕМ СОХРАНЕННЫЕ ДАННЫЕ ИЗ БД (с изменениями пользователя)
            logger.info('✅ Загружены сохраненные товары из БД с пользовательскими изменениями');
        }
        
        res.json({ ok: true, products });
    } catch (error) {
        logger.error('Ошибка получения товаров:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Обновление товаров через админ панель
app.put('/api/admin/products', requireAdminAuth, validateAdminData, async (req, res) => {
    try {
        const { products } = req.body;
        
        // 🗄️ СОХРАНЯЕМ В БАЗУ ДАННЫХ
        await AdminProductsDB.saveAll(products);
        
        // Обновляем локальный кэш для совместимости
        adminProducts.clear();
        Object.entries(products).forEach(([categoryId, categoryProducts]) => {
            adminProducts.set(categoryId, categoryProducts);
        });
        
        logger.info('🔧 Товары обновлены через админ панель и сохранены в БД');
        res.json({ ok: true, message: 'Товары успешно обновлены и сохранены в базе данных' });
        
    } catch (error) {
        logger.error('❌ Ошибка обновления товаров:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Переключение доступности товара
app.patch('/api/admin/products/:categoryId/:productId/toggle', requireAdminAuth, validateProductId, async (req, res) => {
    try {
        const { categoryId, productId } = req.params;
        
        // 🗄️ ЗАГРУЖАЕМ ВСЕ ТОВАРЫ ИЗ БД
        let allProducts = await AdminProductsDB.loadAll();
        
        // Если в БД пусто, используем память
        if (Object.keys(allProducts).length === 0) {
            allProducts = Object.fromEntries(adminProducts);
        }
        
        const categoryProducts = allProducts[categoryId];
        if (!categoryProducts) {
            return res.status(404).json({ ok: false, error: 'Категория не найдена' });
        }
        
        const product = categoryProducts.find(p => p.id === productId);
        if (!product) {
            return res.status(404).json({ ok: false, error: 'Товар не найден' });
        }
        
        // Переключаем доступность
        product.available = !product.available;
        
        // 💾 СОХРАНЯЕМ ВСЕ ТОВАРЫ ОБРАТНО В БД
        await AdminProductsDB.saveAll(allProducts);
        
        // Обновляем локальный кэш
        if (adminProducts.has(categoryId)) {
            const localProducts = adminProducts.get(categoryId);
            const localProduct = localProducts.find(p => p.id === productId);
            if (localProduct) {
                localProduct.available = product.available;
            }
        }
        
        logger.info(`🔧 Товар ${productId} ${product.available ? 'показан' : 'скрыт'} и сохранен в БД`);
        res.json({ ok: true, product, available: product.available });
        
    } catch (error) {
        logger.error('❌ Ошибка переключения товара:', error.message);
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
        // 🗄️ ПРИНУДИТЕЛЬНАЯ ОЧИСТКА БД (если установлена переменная)
        if (process.env.CLEAR_DATABASE === 'true') {
            logger.warn('🚨 ПРИНУДИТЕЛЬНАЯ ОЧИСТКА БАЗЫ ДАННЫХ...');
            try {
                const { Pool } = require('pg');
                const pool = new Pool({ connectionString: config.DATABASE_URL });
                await pool.query('DELETE FROM admin_products');
                await pool.end();
                logger.info('✅ Таблица admin_products очищена');
            } catch (error) {
                logger.error('❌ Ошибка очистки БД:', error.message);
            }
        }
        
        // Инициализируем базу данных
        await initializeDatabase();
        
        // Инициализируем счетчик заказов из БД
        await initializeOrderCounter();
        
        // Инициализируем ЮKassa
        await initializeYooKassa();
        
        // Загружаем товары из БД если есть
        try {
            const dbProducts = await AdminProductsDB.loadAll();
            if (Object.keys(dbProducts).length > 0) {
                logger.info('✅ Товары загружены из базы данных');
                // Преобразуем в Map для совместимости с текущим кодом
                adminProducts.clear();
                for (const [categoryId, products] of Object.entries(dbProducts)) {
                    adminProducts.set(categoryId, products);
                }
            }
        } catch (error) {
            logger.warn('⚠️ Товары из БД не загружены, используем fallback');
        }
        
        // Функция для получения Chat ID (группы или личного чата)
        async function getTelegramChatId() {
            if (!config.TELEGRAM_BOT_TOKEN) {
                logger.warn('⚠️ TELEGRAM_BOT_TOKEN не настроен');
                return null;
            }
            
            try {
                const response = await axios.get(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getUpdates`);
                const updates = response.data.result;
                
                if (updates.length > 0) {
                    // Ищем групповые чаты (ID начинается с минуса)
                    const groupChats = updates
                        .map(update => update.message?.chat || update.callback_query?.message?.chat)
                        .filter(chat => chat && chat.id < 0)
                        .map(chat => ({
                            id: chat.id,
                            title: chat.title || 'Группа',
                            type: chat.type
                        }));
                    
                    // Убираем дубликаты
                    const uniqueGroups = groupChats.filter((chat, index, self) => 
                        index === self.findIndex(c => c.id === chat.id)
                    );
                    
                    if (uniqueGroups.length > 0) {
                        logger.info('📱 Найдены групповые чаты:');
                        uniqueGroups.forEach(group => {
                            logger.info(`   🏢 ${group.title} (${group.type}): ${group.id}`);
                        });
                        
                        const mainGroup = uniqueGroups[0];
                        logger.info('💡 Добавьте эту переменную в Railway:');
                        logger.info(`   TELEGRAM_ADMIN_CHAT_ID=${mainGroup.id}`);
                        logger.info(`   (ID группы: ${mainGroup.title})`);
                        return mainGroup.id;
                    }
                    
                    // Если групп нет, ищем личные чаты
                    const personalChats = updates
                        .map(update => update.message?.chat || update.callback_query?.message?.chat)
                        .filter(chat => chat && chat.id > 0)
                        .map(chat => ({
                            id: chat.id,
                            username: chat.username || 'Пользователь',
                            first_name: chat.first_name || ''
                        }));
                    
                    const uniquePersonal = personalChats.filter((chat, index, self) => 
                        index === self.findIndex(c => c.id === chat.id)
                    );
                    
                    if (uniquePersonal.length > 0) {
                        logger.info('📱 Найдены личные чаты:');
                        uniquePersonal.forEach(chat => {
                            logger.info(`   👤 ${chat.first_name} (@${chat.username}): ${chat.id}`);
                        });
                        
                        const mainChat = uniquePersonal[0];
                        logger.info('💡 Добавьте эту переменную в Railway:');
                        logger.info(`   TELEGRAM_ADMIN_CHAT_ID=${mainChat.id}`);
                        logger.info(`   (Личный чат: ${mainChat.first_name})`);
                        return mainChat.id;
                    }
                }
                
                logger.warn('⚠️ Chat ID не найден. Добавьте бота в группу или напишите ему сообщение.');
                return null;
            } catch (error) {
                logger.error('❌ Ошибка получения Chat ID:', error.message);
                return null;
            }
        }
        
        // Запускаем сервер
        app.listen(PORT, async () => {
            logger.info(`🚀 Сервер запущен на порту ${PORT}`);
            logger.info(`📁 Статические файлы из: ${webRoot}`);
            logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
            logger.info(`🗄️ База данных подключена`);
            
            // Проверяем настройки Telegram
            logger.info('🔍 Проверка настроек Telegram:');
            logger.info(`   Токен бота: ${config.TELEGRAM_BOT_TOKEN ? '✅ Настроен' : '❌ Не настроен'}`);
            logger.info(`   Chat ID: ${config.TELEGRAM_ADMIN_CHAT_ID ? '✅ Настроен' : '❌ Не настроен'}`);
            
            if (config.TELEGRAM_BOT_TOKEN && !config.TELEGRAM_ADMIN_CHAT_ID) {
                logger.info('🔍 Ищем Chat ID для Telegram бота...');
                await getTelegramChatId();
            } else if (!config.TELEGRAM_BOT_TOKEN) {
                logger.warn('⚠️ TELEGRAM_BOT_TOKEN не настроен в Railway');
                logger.info('💡 Добавьте переменную TELEGRAM_BOT_TOKEN в Railway');
            } else {
                logger.info('✅ Telegram настроен полностью');
                
                // Тестируем отправку сообщения
                try {
                    await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: config.TELEGRAM_ADMIN_CHAT_ID,
                        text: '🧪 Тестовое сообщение от сервера - Telegram настроен корректно!'
                    });
                    logger.info('✅ Тестовое сообщение в Telegram отправлено успешно');
                } catch (testError) {
                    logger.error('❌ Ошибка тестового сообщения в Telegram:', testError.message);
                    if (testError.response?.status === 401) {
                        logger.error('❌ Неверный токен бота');
                    } else if (testError.response?.status === 400) {
                        logger.error('❌ Неверный Chat ID');
                    }
                }
            }
        });
        
    } catch (error) {
        logger.error('❌ Ошибка запуска сервера:', error.message);
        process.exit(1);
    }
}

// 🛡️ ОБРАБОТКА НЕПЕРЕХВАЧЕННЫХ ОШИБОК
process.on('uncaughtException', (error) => {
    logger.error('💥 Неперехваченная ошибка:', error.message);
    logger.debug('Stack:', error.stack);
    // НЕ завершаем процесс, логируем и продолжаем
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('💥 Неперехваченное отклонение промиса:', reason);
    // НЕ завершаем процесс, логируем и продолжаем
});

startServer();

// Keep-alive механизм для Railway
setInterval(() => {
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    logger.debug(`💓 Keep-alive: Uptime: ${Math.floor(uptime)}s, Memory: ${Math.round(memory.heapUsed / 1024 / 1024)}MB`);
}, 5 * 60 * 1000); // Каждые 5 минут

// 🧹 ПЕРИОДИЧЕСКАЯ ОЧИСТКА ПАМЯТИ
setInterval(async () => {
    try {
        logger.debug('🧹 Запуск очистки памяти...');
        
        // Очищаем старые заказы из памяти (старше 24 часов)
        const now = Date.now();
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        
        let cleanedOrders = 0;
        for (const [orderId, order] of orders.entries()) {
            if (order.createdAt && new Date(order.createdAt).getTime() < oneDayAgo) {
                // Очищаем таймер если есть
                clearOrderTimer(orderId);
                orders.delete(orderId);
                cleanedOrders++;
            }
        }
        
        // Очищаем старые заказы из БД (старше 30 дней)
        try {
            const deletedCount = await OrdersDB.cleanupOldOrders();
            if (cleanedOrders > 0 || deletedCount > 0) {
                logger.info(`🗑️ Очищено ${cleanedOrders} заказов из памяти, ${deletedCount} из БД`);
            }
        } catch (error) {
            logger.error('❌ Ошибка очистки БД:', error.message);
        }
        
        // Логируем статистику памяти только если есть изменения
        if (cleanedOrders > 0) {
            const memory = process.memoryUsage();
            logger.info(`📊 Память: ${Math.round(memory.heapUsed / 1024 / 1024)}MB, Заказов: ${orders.size}, Таймеров: ${orderTimers.size}`);
        }
        
    } catch (error) {
        logger.error('❌ Ошибка очистки памяти:', error.message);
    }
}, 60 * 60 * 1000); // Каждый час

// Graceful shutdown с очисткой ресурсов
process.on('SIGTERM', () => {
    logger.info('🛑 Получен сигнал SIGTERM, завершаем работу...');
    cleanup();
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('🛑 Получен сигнал SIGINT, завершаем работу...');
    cleanup();
    process.exit(0);
});

// Функция очистки ресурсов
function cleanup() {
    logger.info('🧹 Очистка ресурсов...');
    
    // Очищаем все таймеры заказов
    let clearedTimers = 0;
    for (const [orderId, timer] of orderTimers.entries()) {
        clearTimeout(timer);
        clearedTimers++;
    }
    orderTimers.clear();
    
    if (clearedTimers > 0) {
        logger.info(`🗑️ Очищено ${clearedTimers} таймеров заказов`);
    }
    
    logger.info('✅ Ресурсы очищены');
}
