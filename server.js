// Простое логирование
const logger = {
    error: (msg, ...args) => console.error('❌', msg, ...args),
    warn: (msg, ...args) => console.warn('⚠️', msg, ...args),
    info: (msg, ...args) => console.log('ℹ️', msg, ...args),
    debug: (msg, ...args) => console.log('🔍', msg, ...args)
};

logger.info('🚀 СТАРТ СЕРВЕРА');
logger.info('⏰ Время запуска:', new Date().toISOString());

require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
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
    
    async getPayment(paymentId) {
        try {
            logger.debug('💳 Получаем информацию о платеже:', paymentId);
            
            const response = await axios.get(`${this.baseURL}/payments/${paymentId}`, {
                auth: {
                    username: this.shopId,
                    password: this.secretKey
                },
                timeout: 30000
            });
            
            logger.debug('✅ Информация о платеже получена');
            return response.data;
            
        } catch (error) {
            logger.error('❌ Ошибка получения платежа ЮKassa:', error.message);
            throw error;
        }
    }
}
const config = require('./config');
const { initializeDatabase, OrdersDB, PurchaseHistoryDB, AdminProductsDB, CategoriesDB, BotUsersDB } = require('./database');

const app = express();
const PORT = config.PORT;
const TELEGRAM_BOT_TOKEN = config.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = config.TELEGRAM_ADMIN_CHAT_ID;

// Настройка для работы с прокси (Railway)
app.set('trust proxy', 1);

// Простые настройки без ограничений

// 💳 ИНИЦИАЛИЗАЦИЯ YOOKASSA
logger.info('🔧 Инициализация ЮKassa...');

let checkout = null;

// 🔧 АСИНХРОННАЯ ИНИЦИАЛИЗАЦИЯ ЮKASSA
async function initializeYooKassa() {
    try {
        if (!config.YOOKASSA_SHOP_ID || !config.YOOKASSA_SECRET_KEY) {
            throw new Error('Не настроены ключи ЮKassa');
        }
        
        logger.info('🔧 Инициализируем ЮKassa API...');
        checkout = new YooKassaAPI(config.YOOKASSA_SHOP_ID, config.YOOKASSA_SECRET_KEY);
        logger.info('✅ ЮKassa API объект создан');
        
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

// 🔔 ГЛОБАЛЬНОЕ ЛОГИРОВАНИЕ webhook запросов (для диагностики)
app.use('/api/telegram/webhook', (req, res, next) => {
    logger.info('🔔 GLOBAL WEBHOOK MIDDLEWARE: Запрос получен', {
        method: req.method,
        url: req.url,
        timestamp: new Date().toISOString(),
        ip: req.ip,
        userAgent: req.headers['user-agent']
    });
    next();
});

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
        ],
        
        // 🆕 НОВЫЕ КАТЕГОРИИ (ПУСТЫЕ МАССИВЫ)
        'sousy-marinad': [],
        'napitki': [],
        'deserty': [],
        'konditerka': []
        // ✅ ГОТОВО! ВСЕ 12 КАТЕГОРИЙ, 49 ТОВАРОВ!
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

// Функции для работы с заказами ПЕРЕМЕЩЕНЫ ВЫШЕ - ПЕРЕД API МАРШРУТАМИ

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

async function getOrder(orderId) {
    // Сначала ищем в памяти
    let order = orders.get(orderId);
    
    // Если не найден в памяти, ищем в базе данных
    if (!order) {
        try {
            const dbOrder = await OrdersDB.getById(orderId);
            if (dbOrder) {
                // Конвертируем данные из БД в формат, ожидаемый клиентом
                order = {
                    id: dbOrder.order_id,
                    status: dbOrder.status,
                    paymentStatus: dbOrder.payment_status,
                    totals: {
                        total: parseFloat(dbOrder.total_amount || 0)
                    },
                    items: (() => {
                        try {
                            return typeof dbOrder.items === 'string' ? JSON.parse(dbOrder.items) : (dbOrder.items || []);
                        } catch (e) {
                            logger.warn('⚠️ Ошибка парсинга items в getOrder:', e.message);
                            return [];
                        }
                    })(),
                    address: (() => {
                        try {
                            return typeof dbOrder.address === 'string' ? JSON.parse(dbOrder.address) : (dbOrder.address || {});
                        } catch (e) {
                            logger.warn('⚠️ Ошибка парсинга address в getOrder:', e.message);
                            return {};
                        }
                    })(),
                    phone: dbOrder.phone,
                    customerName: dbOrder.user_name,
                    createdAt: dbOrder.created_at,
                    payment_id: dbOrder.payment_id,
                    telegramUserId: dbOrder.user_id // Предполагаем, что user_id это telegramUserId
                };
                
                // Сохраняем в памяти для быстрого доступа
                orders.set(orderId, order);
                logger.info(`📦 Заказ ${orderId} загружен из БД в память`);
            }
        } catch (error) {
            logger.error(`❌ Ошибка загрузки заказа ${orderId} из БД:`, error.message);
        }
    }
    
    return order;
}

function getAllOrders() {
    return Array.from(orders.values()).sort((a, b) => b.createdAt - a.createdAt);
}

// 🔥 ФУНКЦИЯ АВТОМАТИЧЕСКОЙ ОТМЕНЫ ЗАКАЗА
async function autoExpireOrder(orderId) {
    let order = orders.get(orderId);
    
    // Если заказ не найден в памяти, ищем в базе данных
    if (!order) {
        try {
            const dbOrder = await OrdersDB.getById(orderId);
            if (dbOrder) {
                order = {
                    id: dbOrder.order_id,
                    status: dbOrder.status,
                    paymentStatus: dbOrder.payment_status,
                    totals: {
                        total: parseFloat(dbOrder.total_amount || 0)
                    }
                };
            }
        } catch (error) {
            logger.error(`❌ Ошибка загрузки заказа ${orderId} из БД для автоотмены:`, error.message);
        }
    }
    
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
    
    // Обновляем в базе данных
    try {
        await OrdersDB.update(orderId, { 
            status: 'expired',
            payment_status: 'expired'
        });
        logger.info(`💾 Заказ ${orderId} отменен в БД`);
    } catch (dbError) {
        logger.error(`❌ Ошибка отмены заказа ${orderId} в БД:`, dbError.message);
    }
    
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
console.log('🔍 WebRoot путь:', webRoot);
console.log('🔍 Существует ли admin.html:', require('fs').existsSync(path.join(webRoot, 'admin.html')));
app.use(express.static(webRoot));

// Логирование всех входящих запросов
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        console.log('🔍 API:', req.method, req.path);
    }
    next();
});

// CORS для всех запросов
app.use(cors());

// 🔧 API МАРШРУТЫ - ПЕРЕД ВСЕМИ ОСТАЛЬНЫМИ
// Получение всех товаров для админ панели
app.get('/api/admin/products', requireAdminAuth, async (req, res) => {
    // Принудительно отключаем кэширование
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    try {
        console.log('🔍 API GET /api/admin/products: ENDPOINT ВЫЗВАН!');
        console.log('🔍 API: Загрузка товаров для админ-панели');
        
        // 🗄️ ЗАГРУЖАЕМ ИЗ БАЗЫ ДАННЫХ
        let products = await AdminProductsDB.loadAll();
        
        console.log('🔍 API: Загружено товаров из БД:', Object.keys(products).length);
        
        // 🔄 ИНИЦИАЛИЗАЦИЯ ТОЛЬКО ЕСЛИ БД ПОЛНОСТЬЮ ПУСТА (ПЕРВЫЙ ЗАПУСК)
        if (Object.keys(products).length === 0) {
            console.log('🔄 БД пуста, инициализируем полным ассортиментом товаров...');
            logger.info('🔄 БД пуста, инициализируем полным ассортиментом товаров...');
            
            // Полный ассортимент товаров (все 49 товаров)
            const fullProducts = await loadFullProductCatalog();
            
            // Сохраняем в БД ТОЛЬКО ОДИН РАЗ
            try {
                await AdminProductsDB.saveAll(fullProducts);
                console.log('✅ Полный каталог товаров сохранен в БД ПЕРВЫЙ РАЗ');
                logger.info('✅ Полный каталог товаров сохранен в БД ПЕРВЫЙ РАЗ');
                products = fullProducts;
                
                // Заполняем локальный кэш
                Object.entries(fullProducts).forEach(([categoryId, categoryProducts]) => {
                    adminProducts.set(categoryId, categoryProducts);
                });
            } catch (error) {
                console.error('❌ Ошибка сохранения полного каталога:', error);
                logger.error('❌ Ошибка сохранения полного каталога:', error.message);
                products = fullProducts; // Используем как fallback
            }
        } else {
            // ✅ ИСПОЛЬЗУЕМ СОХРАНЕННЫЕ ДАННЫЕ ИЗ БД (с изменениями пользователя)
            console.log('✅ Загружены сохраненные товары из БД с пользовательскими изменениями');
            logger.info('✅ Загружены сохраненные товары из БД с пользовательскими изменениями');
        }
        
        res.json({ ok: true, products });
    } catch (error) {
        logger.error('Ошибка получения товаров:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔧 API для сохранения категорий (админ)
app.put('/api/admin/categories', requireAdminAuth, async (req, res) => {
    try {
        console.log('🔍 API PUT /api/admin/categories: ENDPOINT ВЫЗВАН!');
        const { products, categories } = req.body;
        
        if (!products || !categories) {
            return res.status(400).json({ 
                ok: false, 
                error: 'Отсутствуют данные товаров или категорий' 
            });
        }
        
        // Сохраняем товары через существующую функцию
        await AdminProductsDB.saveAll(products);
        
        // Сохраняем категории в памяти сервера (можно добавить в БД позже)
        global.categoryNames = categories;
        
        logger.info('✅ Товары и категории сохранены через API');
        logger.info('📝 Обновленные категории:', categories);
        
        res.json({ 
            ok: true, 
            message: 'Товары и категории сохранены успешно',
            categoriesCount: Object.keys(categories).length,
            productsCount: Object.values(products).reduce((sum, cat) => sum + cat.length, 0)
        });
        
    } catch (error) {
        logger.error('❌ Ошибка сохранения категорий:', error);
        res.status(500).json({ 
            ok: false, 
            error: 'Ошибка сервера при сохранении категорий: ' + error.message 
        });
    }
});

// Обновление товаров через админ панель
app.put('/api/admin/products', (req, res, next) => {
    console.log('🔍 API PUT /api/admin/products: МАРШРУТ ВЫЗВАН!');
    console.log('🔍 Заголовки:', req.headers);
    console.log('🔍 Query:', req.query);
    next();
}, requireAdminAuth, validateAdminData, async (req, res) => {
    try {
        console.log('🔍 API PUT /api/admin/products: ENDPOINT ВЫЗВАН!');
        console.log('🔍 API: Обновление товаров через админ панель - ENDPOINT ВЫЗВАН!');
        console.log('🔍 API: Тело запроса:', req.body);
        const { products } = req.body;
        
        // 🗄️ СОХРАНЯЕМ В БАЗУ ДАННЫХ
        await AdminProductsDB.saveAll(products);
        
        // Обновляем локальный кэш для совместимости
        adminProducts.clear();
        Object.entries(products).forEach(([categoryId, categoryProducts]) => {
            adminProducts.set(categoryId, categoryProducts);
        });
        
        res.json({ ok: true, message: 'Товары обновлены успешно' });
        
    } catch (error) {
        logger.error('❌ Ошибка обновления товаров:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔧 API ДЛЯ ОСНОВНОГО ПРИЛОЖЕНИЯ - ПЕРЕД АДМИН ПАНЕЛЬЮ
// Получение товаров для основного приложения (публичный API)
app.get('/api/products', async (req, res) => {
    try {
        console.log('🔍 API: Загрузка товаров для основного приложения');
        
        // Принудительно отключаем кэширование
        res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        
        // 🗄️ ЗАГРУЖАЕМ ИЗ БАЗЫ ДАННЫХ
        let allProducts = await AdminProductsDB.loadAll();
        
        // Если в БД нет товаров, инициализируем полным каталогом
        if (Object.keys(allProducts).length === 0) {
            const fullProducts = await loadFullProductCatalog();
            await AdminProductsDB.saveAll(fullProducts);
            allProducts = fullProducts;
        }
        
        // Фильтруем только доступные товары для клиентов
        const productsObj = {};
        let totalAvailable = 0;
        for (const [categoryId, categoryProducts] of Object.entries(allProducts)) {
            const availableProducts = categoryProducts.filter(product => product.available !== false);
            if (availableProducts.length > 0) {
                productsObj[categoryId] = availableProducts;
                totalAvailable += availableProducts.length;
            }
        }
        
        console.log(`📦 API: Загружено ${totalAvailable} товаров для клиентов`);
        
        res.json({ ok: true, products: productsObj });
        
    } catch (error) {
        console.error('❌ Ошибка получения товаров:', error);
        logger.error('❌ Ошибка получения товаров:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔧 API ДЛЯ ЗАКАЗОВ ПОЛЬЗОВАТЕЛЯ - ПЕРЕД SPA FALLBACK
// Получение заказов пользователя (все заказы кроме отмененных)
app.get('/api/user-orders/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const orders = await OrdersDB.getByUserId(userId);
        
        const paidOrders = orders.filter(order => 
            order.payment_status === 'paid' || 
            order.status === 'completed' || 
            order.status === 'delivered' ||
            order.status === 'accepted' ||
            (order.payment_id && order.payment_id !== '')
        );
        
        const formattedOrders = paidOrders.map(order => ({
            order_id: order.order_id,
            amount: order.total_amount || order.totalAmount || 0,
            purchase_date: order.created_at || order.createdAt,
            items: order.items || [],
            status: order.status,
            payment_status: order.payment_status
        }));
        
        res.json({ ok: true, orders: formattedOrders });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Получение покупок пользователя для лояльности
app.get('/api/user-purchases/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const orders = await OrdersDB.getByUserId(userId);
        
        const paidOrders = orders.filter(order => 
            order.payment_status === 'paid' || 
            order.status === 'completed' || 
            order.status === 'delivered' ||
            order.status === 'accepted' ||
            (order.payment_id && order.payment_id !== '')
        );
        
        const totalPurchases = paidOrders.length;
        const totalSpent = paidOrders.reduce((sum, order) => {
            return sum + (order.total_amount || order.totalAmount || 0);
        }, 0);
        
        let loyaltyLevel, currentDiscount, nextLevelTarget, nextLevelProgress;
        
        if (totalSpent < 10000) {
            loyaltyLevel = 0;
            currentDiscount = 0;
            nextLevelTarget = 10000;
            nextLevelProgress = totalSpent;
        } else if (totalSpent < 25000) {
            loyaltyLevel = 1;
            currentDiscount = 3;
            nextLevelTarget = 25000;
            nextLevelProgress = totalSpent - 10000;
        } else if (totalSpent < 50000) {
            loyaltyLevel = 2;
            currentDiscount = 5;
            nextLevelTarget = 50000;
            nextLevelProgress = totalSpent - 25000;
        } else {
            loyaltyLevel = 3;
            currentDiscount = 10;
            nextLevelTarget = 50000;
            nextLevelProgress = 25000;
        }
        
        const stats = {
            totalPurchases,
            totalSpent,
            loyaltyLevel,
            currentDiscount,
            nextLevelTarget,
            nextLevelProgress
        };
        
        res.json({
            ok: true,
            purchases: paidOrders,
            stats: stats
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔧 API ДЛЯ ДЕТАЛЕЙ ЗАКАЗА - ПЕРЕД SPA FALLBACK
// API для получения конкретного заказа
app.get('/api/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        logger.info('🔍 API: Запрос статуса заказа ' + orderId);
        
        // Сначала ищем в базе данных (для актуальных данных)
        logger.info('🔍 API: Ищем заказ ' + orderId + ' в базе данных...');
        let order = await OrdersDB.getById(orderId);
        
        if (order) {
            logger.info('✅ API: Заказ ' + orderId + ' найден в БД:', {
                status: order.status,
                payment_status: order.payment_status,
                total_amount: order.total_amount,
                payment_id: order.payment_id,
                items_type: typeof order.items,
                address_type: typeof order.address,
                items_value: order.items,
                address_value: order.address
            });
            
            // Принудительно проверяем статус платежа даже для заказов из БД
            if (order.payment_id && order.payment_status === 'pending') {
                logger.info('🔍 API: Принудительная проверка статуса платежа для заказа ' + orderId);
                try {
                    // Проверяем, что checkout инициализирован
                    if (!checkout) {
                        logger.error('❌ API: checkout не инициализирован');
                        return;
                    }
                    const payment = await checkout.getPayment(order.payment_id);
                    logger.info('🔍 API: Статус платежа в ЮKassa:', {
                        id: payment.id,
                        status: payment.status,
                        paid: payment.paid
                    });
                    
                    // Если платеж оплачен, обновляем заказ
                    if (payment.status === 'succeeded' && payment.paid) {
                        logger.info('✅ API: Платеж оплачен, обновляем заказ ' + orderId);
                        await OrdersDB.update(orderId, {
                            status: 'accepted',
                            payment_status: 'paid',
                            payment_id: payment.id,
                            total_amount: parseFloat(payment.amount.value)
                        });
                        
                        // Обновляем данные заказа
                        order.status = 'accepted';
                        order.payment_status = 'paid';
                        order.total_amount = parseFloat(payment.amount.value);
                        
                        logger.info('✅ API: Заказ ' + orderId + ' обновлен после принудительной проверки');
                        
                        // Отправляем уведомление с кнопками в Telegram
                        try {
                            // Формируем адрес
                            let addressText = 'Адрес не указан';
                            try {
                                const addressData = typeof order.address === 'string' ? JSON.parse(order.address) : (order.address || {});
                                if (addressData.street && addressData.house) {
                                    addressText = [
                                        addressData.street,
                                        addressData.house,
                                        addressData.apartment && `кв. ${addressData.apartment}`,
                                        addressData.floor && `эт. ${addressData.floor}`,
                                        addressData.entrance && `под. ${addressData.entrance}`,
                                        addressData.intercom && `домофон: ${addressData.intercom}`
                                    ].filter(Boolean).join(', ');
                                }
                            } catch (e) {
                                logger.warn('⚠️ Ошибка парсинга адреса в API:', e.message);
                            }
                            
                            // Формируем состав заказа
                            let orderItems = 'Состав заказа недоступен';
                            let itemsArray = [];
                            
                            if (order.items) {
                                if (typeof order.items === 'string') {
                                    try {
                                        itemsArray = JSON.parse(order.items);
                                    } catch (e) {
                                        logger.warn('⚠️ Ошибка парсинга items в API:', e.message);
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
                                `💰 <b>ЗАКАЗ ОПЛАЧЕН!</b>\n\n` +
                                `📋 <b>Номер заказа:</b> #${orderId}\n` +
                                `👤 <b>Клиент:</b> ${order.user_name || 'Не указан'}\n` +
                                `📞 <b>Телефон:</b> ${order.phone || 'Не указан'}\n` +
                                `💰 <b>Сумма:</b> ${parseFloat(payment.amount.value)}₽\n` +
                                `📍 <b>Адрес:</b> ${addressText}\n\n` +
                                `📦 <b>Состав заказа:</b>\n${orderItems}`;
                            
                            // Создаем кнопки для оплаченного заказа согласно ТЗ
                            const inlineKeyboard = {
                                inline_keyboard: [
                                    [
                                        { text: '🟡 Принят в работу', callback_data: `accept_${orderId}` },
                                        { text: '🔵 Готовится', callback_data: `preparing_${orderId}` }
                                    ],
                                    [
                                        { text: '🚚 В доставке', callback_data: `delivering_${orderId}` },
                                        { text: '✅ Доставлен', callback_data: `completed_${orderId}` }
                                    ]
                                ]
                            };
                            
                            await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                                chat_id: config.TELEGRAM_ADMIN_CHAT_ID,
                                text: message,
                                parse_mode: 'HTML',
                                reply_markup: inlineKeyboard
                            });
                            
                            logger.info('✅ API: Уведомление с кнопками об оплате отправлено в Telegram');
                        } catch (telegramError) {
                            logger.error('❌ API: Ошибка отправки уведомления в Telegram:', telegramError.message);
                        }
                    }
                } catch (error) {
                    logger.error('❌ API: Ошибка принудительной проверки статуса платежа:', error.message);
                }
            }
            
            // Конвертируем данные из БД в формат, ожидаемый клиентом
            order = {
                id: order.id,
                status: order.status,
                paymentStatus: order.payment_status,
                totals: {
                    total: parseFloat(order.total_amount || 0)
                },
                items: (() => {
                    try {
                        return typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
                    } catch (e) {
                        logger.warn('⚠️ Ошибка парсинга items для заказа ' + orderId + ':', e.message);
                        return [];
                    }
                })(),
                address: (() => {
                    try {
                        return typeof order.address === 'string' ? JSON.parse(order.address) : (order.address || {});
                    } catch (e) {
                        logger.warn('⚠️ Ошибка парсинга address для заказа ' + orderId + ':', e.message);
                        return {};
                    }
                })(),
                phone: order.phone,
                customerName: order.user_name,
                createdAt: order.created_at
            };
        } else {
            // Если не найден в БД, пробуем получить из памяти (для очень новых заказов)
            logger.info('🔍 API: Заказ ' + orderId + ' не найден в БД, ищем в памяти...');
            order = getOrder(orderId);
            logger.info('🔍 API: Заказ ' + orderId + ' в памяти:', order ? 'найден' : 'не найден');
            
            // Если заказ найден в памяти, но не в БД, проверяем статус платежа в ЮKassa
            if (order && order.paymentId) {
                logger.info('🔍 API: Проверяем статус платежа в ЮKassa для заказа ' + orderId);
                try {
                    // Проверяем, что checkout инициализирован
                    if (!checkout) {
                        logger.error('❌ API: checkout не инициализирован');
                        return;
                    }
                    const payment = await checkout.getPayment(order.paymentId);
                    logger.info('🔍 API: Статус платежа в ЮKassa:', {
                        id: payment.id,
                        status: payment.status,
                        paid: payment.paid
                    });
                    
                    // Если платеж оплачен, обновляем заказ
                    if (payment.status === 'succeeded' && payment.paid) {
                        logger.info('✅ API: Платеж оплачен, обновляем заказ ' + orderId);
                        await OrdersDB.update(orderId, {
                            status: 'accepted',
                            payment_status: 'paid',
                            payment_id: payment.id,
                            total_amount: parseFloat(payment.amount.value)
                        });
                        
                        // Обновляем заказ в памяти
                        order.status = 'accepted';
                        order.paymentStatus = 'paid';
                        orders.set(orderId, order);
                        
                        logger.info('✅ API: Заказ ' + orderId + ' обновлен после проверки ЮKassa');
                        
                        // Отправляем уведомление в Telegram
                        try {
                            await sendTelegramNotification(order, 'paid');
                            logger.info('✅ API: Уведомление об оплате отправлено в Telegram');
                        } catch (telegramError) {
                            logger.error('❌ API: Ошибка отправки уведомления в Telegram:', telegramError.message);
                        }
                    }
                } catch (error) {
                    logger.error('❌ API: Ошибка проверки статуса платежа в ЮKassa:', error.message);
                }
            }
        }
        
        if (order) {
            logger.info('✅ API: Возвращаем заказ ' + orderId + ':', {
                status: order.status,
                paymentStatus: order.paymentStatus,
                total: order.totals?.total
            });
            res.json({ ok: true, order });
        } else {
            logger.warn('❌ API: Заказ ' + orderId + ' не найден');
            res.status(404).json({ ok: false, error: 'Заказ не найден' });
        }
    } catch (error) {
        logger.error('❌ API: Ошибка получения заказа:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔧 ФУНКЦИИ ДЛЯ РАБОТЫ С ЗАКАЗАМИ - ПЕРЕД API МАРШРУТАМИ
// Функции для работы с заказами
async function createOrder(orderData) {
    // Проверяем, что orderCounter инициализирован
    if (typeof orderCounter !== 'number' || isNaN(orderCounter)) {
        logger.warn('⚠️ orderCounter не инициализирован, инициализируем...');
        await initializeOrderCounter();
    }
    
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
    
    // 💾 СОХРАНЯЕМ В ПАМЯТЬ (в БД сохраняется в API-маршруте)
    orders.set(orderId, order);
    
    // 🔥 ЗАПУСКАЕМ ТАЙМЕР АВТООТМЕНЫ НА 10 МИНУТ
    const timer = setTimeout(async () => {
        await autoExpireOrder(orderId);
    }, 10 * 60 * 1000); // 10 минут
    
    orderTimers.set(orderId, timer);
    
    logger.debug('🔥 Заказ ' + orderId + ' создан. Автоотмена через 10 минут.');
    
    return order;
}

// 📱 ФУНКЦИЯ ОТПРАВКИ УВЕДОМЛЕНИЙ КЛИЕНТАМ
async function sendClientNotification(order, status, statusText, statusEmoji) {
    if (!config.TELEGRAM_BOT_TOKEN || !order.telegramUserId) {
        logger.warn('⚠️ Не удалось отправить уведомление клиенту: нет токена или telegramUserId');
        return;
    }
    
    try {
        // Безопасно парсим данные заказа
        const items = (() => {
            try {
                return typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || order.cartItems || []);
            } catch (e) {
                logger.warn('⚠️ Ошибка парсинга items в sendClientNotification:', e.message);
                return [];
            }
        })();
        
        const address = (() => {
            try {
                return typeof order.address === 'string' ? JSON.parse(order.address) : (order.address || {});
            } catch (e) {
                logger.warn('⚠️ Ошибка парсинга address в sendClientNotification:', e.message);
                return {};
            }
        })();
        
        // Форматируем время обновления по московскому времени
        const updateTime = new Date().toLocaleString('ru-RU', { 
            timeZone: 'Europe/Moscow',
            hour: '2-digit', 
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit'
        });
        
        // Создаем сообщение в зависимости от статуса
        let clientMessage = '';
        let hasButtons = false;
        let inlineKeyboard = null;
        
        switch (status) {
            case 'accepted':
                clientMessage = `🟡 *Ваш заказ принят в работу!*\n\n` +
                    `📦 Заказ №${order.id}\n` +
                    `👨‍🍳 Наши повара уже готовят ваш заказ\n` +
                    `⏱️ Примерное время приготовления: 30-45 минут\n\n` +
                    `📋 *Состав заказа:*\n${items.map(item => `• ${item.name} x${item.quantity} - ${(item.price * item.quantity)}₽`).join('\n')}\n\n` +
                    `💰 *Общая сумма:* ${order.totals?.total || 0}₽\n` +
                    `📍 *Адрес доставки:* ${address.street || ''} ${address.house || ''}\n\n` +
                    `⏰ Обновлено: ${updateTime}\n\n` +
                    `Спасибо за ваш заказ! 🙏`;
                break;
                
            case 'preparing':
                clientMessage = `🔵 *Ваш заказ готовится!*\n\n` +
                    `📦 Заказ №${order.id}\n` +
                    `👨‍🍳 Наши повара готовят ваши блюда\n` +
                    `🔥 Все готовится свежим и горячим!\n\n` +
                    `📋 *Что готовим:*\n${items.map(item => `• ${item.name} x${item.quantity}`).join('\n')}\n\n` +
                    `⏱️ *Осталось:* ~15-25 минут\n` +
                    `📍 *Адрес доставки:* ${address.street || ''} ${address.house || ''}\n\n` +
                    `⏰ Обновлено: ${updateTime}\n\n` +
                    `Скоро все будет готово! 😋`;
                break;
                
            case 'delivering':
                clientMessage = `🚚 *Ваш заказ в пути!*\n\n` +
                    `📦 Заказ №${order.id}\n` +
                    `🛵 Курьер выехал к вам с заказом\n` +
                    `📱 Курьер свяжется с вами за 5-10 минут до прибытия\n\n` +
                    `📋 *К вам везут:*\n${items.map(item => `• ${item.name} x${item.quantity}`).join('\n')}\n\n` +
                    `💰 *К оплате:* ОПЛАЧЕНО ✅\n` +
                    `📍 *Адрес доставки:* ${address.street || ''} ${address.house || ''}\n` +
                    `${address.apartment ? `🏠 Квартира: ${address.apartment}\n` : ''}` +
                    `${address.entrance ? `🚪 Подъезд: ${address.entrance}\n` : ''}` +
                    `${address.floor ? `🏢 Этаж: ${address.floor}\n` : ''}` +
                    `${address.intercom ? `🔔 Домофон: ${address.intercom}\n` : ''}\n` +
                    `⏰ Обновлено: ${updateTime}\n\n` +
                    `Ожидайте звонка курьера! 📞`;
                
                // Добавляем кнопку для отслеживания (если есть API)
                hasButtons = true;
                inlineKeyboard = {
                    inline_keyboard: [
                        [{ text: '📱 Открыть приложение', url: `${config.FRONTEND_URL}?order=${order.id}` }]
                    ]
                };
                break;
                
            case 'completed':
                // 🔥 ВАЖНО: При завершении заказа ОБНОВЛЯЕМ ЛОЯЛЬНОСТЬ
                await updateClientLoyalty(order);
                
                clientMessage = `✅ *Заказ доставлен!*\n\n` +
                    `📦 Заказ №${order.id}\n` +
                    `🎉 Ваш заказ успешно доставлен!\n\n` +
                    `📋 *Доставлено:*\n${items.map(item => `• ${item.name} x${item.quantity}`).join('\n')}\n\n` +
                    `💰 *Сумма заказа:* ${order.totals?.total || 0}₽\n` +
                    `🔥 *Баллы лояльности начислены!*\n` +
                    `⏰ Доставлено: ${updateTime}\n\n` +
                    `🙏 *Спасибо за покупку!*\n` +
                    `⭐ Будем рады, если вы оцените наш сервис\n\n` +
                    `🛒 Ждем вас снова в Tundra Gourmet!`;
                
                // Добавляем кнопки для оценки и нового заказа
                hasButtons = true;
                inlineKeyboard = {
                    inline_keyboard: [
                        [
                            { text: '⭐ Оценить заказ', callback_data: `rate_${order.id}` },
                            { text: '🛒 Новый заказ', url: config.FRONTEND_URL }
                        ]
                    ]
                };
                break;
                
            case 'cancelled':
                clientMessage = `❌ *Заказ отменен*\n\n` +
                    `📦 Заказ №${order.id}\n` +
                    `😔 К сожалению, ваш заказ был отменен\n\n` +
                    `💰 *Сумма к возврату:* ${order.totals?.total || 0}₽\n` +
                    `💳 Средства будут возвращены на карту в течение 3-5 рабочих дней\n\n` +
                    `⏰ Отменен: ${updateTime}\n\n` +
                    `🙏 Приносим извинения за неудобства\n` +
                    `📞 Если у вас есть вопросы, свяжитесь с поддержкой`;
                
                // Добавляем кнопки для поддержки и нового заказа
                hasButtons = true;
                inlineKeyboard = {
                    inline_keyboard: [
                        [
                            { text: '💬 Поддержка', url: 'https://t.me/tundrasupport' },
                            { text: '🛒 Новый заказ', url: config.FRONTEND_URL }
                        ]
                    ]
                };
                break;
                
            default:
                clientMessage = `🔔 *Статус заказа изменился*\n\n` +
                    `📦 Заказ №${order.id}\n` +
                    `📍 *Новый статус:* ${statusEmoji} ${statusText}\n\n` +
                    `⏰ Обновлено: ${updateTime}`;
        }
        
        // Отправляем сообщение клиенту
        const messageData = {
            chat_id: order.telegramUserId,
            text: clientMessage,
            parse_mode: 'Markdown'
        };
        
        if (hasButtons && inlineKeyboard) {
            messageData.reply_markup = inlineKeyboard;
        }
        
        logger.info(`📱 ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ КЛИЕНТУ: chat_id=${order.telegramUserId}, status=${status}`);
        
        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, messageData);
        
        logger.info(`✅ Уведомление клиенту отправлено для заказа ${order.id} со статусом ${status}`);
        
    } catch (error) {
        logger.error(`❌ Ошибка отправки уведомления клиенту:`, error.message);
        if (error.response) {
            logger.error(`❌ Детали ошибки Telegram:`, error.response.data);
        }
        throw error; // Пробрасываем ошибку для обработки в handleCallbackQuery
    }
}

// 🔥 ФУНКЦИЯ ОБНОВЛЕНИЯ ЛОЯЛЬНОСТИ КЛИЕНТА ПРИ ЗАВЕРШЕНИИ ЗАКАЗА
async function updateClientLoyalty(order) {
    try {
        if (!order.telegramUserId || !order.totals?.total) {
            logger.warn('⚠️ Не удалось обновить лояльность: нет telegramUserId или суммы заказа');
            return;
        }
        
        const userId = order.telegramUserId;
        const orderAmount = order.totals.total;
        
        logger.info(`🔥 ЛОЯЛЬНОСТЬ: Обновляем лояльность для пользователя ${userId}, сумма заказа: ${orderAmount}₽`);
        
        // Проверяем, не был ли уже учтен этот заказ в системе лояльности
        const existingPurchase = await PurchaseHistoryDB.getByOrderId(order.id);
        if (existingPurchase) {
            logger.warn(`⚠️ ЛОЯЛЬНОСТЬ: Заказ ${order.id} уже учтен в системе лояльности`);
            return;
        }
        
        // Добавляем заказ в purchase_history для подсчета лояльности
        await PurchaseHistoryDB.add({
            orderId: order.id,
            userId: userId,
            amount: orderAmount,
            purchaseDate: new Date()
        });
        
        logger.info(`✅ ЛОЯЛЬНОСТЬ: Заказ ${order.id} добавлен в систему лояльности`);
        
        // Получаем обновленную статистику пользователя
        const userStats = await PurchaseHistoryDB.getUserStats(userId);
        
        if (userStats) {
            logger.info(`📊 ЛОЯЛЬНОСТЬ: Обновленная статистика пользователя ${userId}:`, {
                totalSpent: userStats.totalSpent,
                totalPurchases: userStats.totalPurchases,
                currentDiscount: userStats.currentDiscount
            });
            
            // Отправляем команду клиенту для обновления локального профиля
            const loyaltyUpdateData = {
                action: 'update_loyalty',
                totalSpent: userStats.totalSpent,
                completedOrders: userStats.totalPurchases,
                currentDiscount: userStats.currentDiscount,
                orderAmount: orderAmount
            };
            
            // Отправляем специальное сообщение с командой обновления лояльности
            await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: userId,
                text: `🔥 *Баллы лояльности начислены!*\n\n` +
                    `💰 За заказ №${order.id}: +${orderAmount}₽\n` +
                    `📊 Всего потрачено: ${userStats.totalSpent.toLocaleString()}₽\n` +
                    `🛒 Заказов выполнено: ${userStats.totalPurchases}\n` +
                    `🔥 Текущая скидка: ${userStats.currentDiscount}%\n\n` +
                    `_Данные лояльности автоматически обновлены в приложении_`,
                parse_mode: 'Markdown'
            });
            
            logger.info(`✅ ЛОЯЛЬНОСТЬ: Уведомление о начислении баллов отправлено пользователю ${userId}`);
        }
        
    } catch (error) {
        logger.error('❌ ЛОЯЛЬНОСТЬ: Ошибка обновления лояльности:', error.message);
        // Не пробрасываем ошибку, чтобы не нарушить основной процесс доставки
    }
}

// 📱 ФУНКЦИЯ ОТПРАВКИ УВЕДОМЛЕНИЙ В TELEGRAM АДМИНАМ
async function sendTelegramNotification(order, type) {
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_ADMIN_CHAT_ID) {
        logger.warn('⚠️ Telegram не настроен - уведомление не отправлено');
        return;
    }
    
    try {
        let message = '';
        
        // Безопасно парсим данные
        let addressObj = {};
        let itemsArray = [];
        
        try {
            addressObj = typeof order.address === 'string' ? JSON.parse(order.address) : (order.address || {});
        } catch (e) {
            logger.warn('⚠️ Ошибка парсинга address в уведомлении:', e.message);
        }
        
        try {
            itemsArray = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
        } catch (e) {
            logger.warn('⚠️ Ошибка парсинга items в уведомлении:', e.message);
        }
        
        if (type === 'new') {
            message = `🆕 <b>НОВЫЙ ЗАКАЗ!</b>\n` +
                     `📋 Номер: #${order.id}\n` +
                     `👤 Клиент: ${order.customerName || 'Не указан'}\n` +
                     `📞 Телефон: ${order.phone || 'Не указан'}\n` +
                     `💰 Сумма: ${order.totals?.total || 0}₽\n` +
                     `📍 Адрес: ${addressObj.street ? addressObj.street + ', ' + addressObj.house : 'Не указан'}\n` +
                     `🛒 Товары: ${itemsArray.length > 0 ? itemsArray.map(item => `${item.name} x${item.quantity}`).join(', ') : 'Не указаны'}`;
        } else if (type === 'paid') {
            message = `💰 <b>ЗАКАЗ ОПЛАЧЕН!</b>\n` +
                     `📋 Номер: #${order.id}\n` +
                     `👤 Клиент: ${order.customerName || 'Не указан'}\n` +
                     `📞 Телефон: ${order.phone || 'Не указан'}\n` +
                     `💰 Сумма: ${order.totals?.total || 0}₽\n` +
                     `📍 Адрес: ${addressObj.street ? addressObj.street + ', ' + addressObj.house : 'Не указан'}\n` +
                     `🛒 Товары: ${itemsArray.length > 0 ? itemsArray.map(item => `${item.name} x${item.quantity}`).join(', ') : 'Не указаны'}`;
        }
        
        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: config.TELEGRAM_ADMIN_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
        
        logger.info('✅ Уведомление в Telegram отправлено');
    } catch (error) {
        logger.error('❌ Ошибка отправки уведомления в Telegram:', error.message);
        throw error;
    }
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
        
        if (typeof item.quantity !== 'number' || item.quantity <= 0 || item.quantity > 100) {
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

// 🔧 API ДЛЯ СОЗДАНИЯ ЗАКАЗА - ПЕРЕД SPA FALLBACK
// API для заказов
app.post('/api/orders', validateOrderData, async (req, res) => {
    logger.info('🔥 Создание нового заказа');
    let order = null;
    
    // Режим продакшена - без демо-режима
    
    try {
        const orderData = req.body;
        
        // Создаем заказ
        order = await createOrder(orderData);
        logger.info('✅ Заказ #' + order.id + ' создан, сумма: ' + (order.totals?.total || 0) + '₽');
        
        // Получаем данные клиента (приоритет: Telegram > форма > fallback)
        const telegramUser = orderData.telegramUser;
        
        const customerName = telegramUser?.full_name || 
                           telegramUser?.first_name || 
                           orderData.customerName || 
                           'Клиент';
        
        // 💳 СОЗДАЕМ ПЛАТЕЖ В YOOKASSA
        const totalAmount = order.totals?.total || 0;
        const description = 'Заказ #' + order.id + ' - ' + customerName;
        
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
        
        // Логируем детали платежа для отладки
        logger.info('💳 Детали платежа ЮKassa:', {
            paymentId: payment.id,
            status: payment.status,
            confirmation: payment.confirmation,
            confirmationUrl: payment.confirmation?.confirmation_url
        });
        
        // Сохраняем ID платежа в заказе
        order.paymentId = payment.id;
        order.paymentUrl = payment.confirmation?.confirmation_url;
        
        // Проверяем, что URL получен
        if (!order.paymentUrl) {
            logger.error('❌ PaymentUrl не получен от ЮKassa!', {
                payment: payment,
                confirmation: payment.confirmation
            });
        } else {
            logger.info('✅ PaymentUrl получен:', order.paymentUrl);
        }
        
        // Обновляем заказ в памяти
        orders.set(order.id, order);
        
        // Сохраняем в базу данных
        await OrdersDB.create({
            orderId: order.id,
            userId: order.telegramUserId || orderData.userId || 'unknown', // Используем telegramUserId для уведомлений
            userName: customerName,
            phone: order.phone,
            deliveryZone: orderData.deliveryZone || 'moscow',
            address: JSON.stringify(orderData.address),
            items: JSON.stringify(orderData.cartItems),
            totalAmount: totalAmount,
            status: 'new',
            paymentStatus: 'pending',
            paymentId: payment.id,
            paymentUrl: order.paymentUrl
        });
        
        logger.info('✅ Заказ #' + order.id + ' сохранен в БД');
        
        // Уведомление будет отправлено только после успешной оплаты
        logger.info('📝 Заказ создан, ожидаем оплату для отправки уведомления');
        
        // Возвращаем данные заказа клиенту
        res.json({
            ok: true,
            order: {
                id: order.id,
                status: order.status,
                paymentUrl: order.paymentUrl,
                totals: order.totals
            }
        });
        
    } catch (error) {
        logger.error('❌ Ошибка создания заказа:', error.message);
        
        // Если заказ был создан, но произошла ошибка, удаляем его
        if (order && order.id) {
            orders.delete(order.id);
            logger.info('🗑️ Заказ #' + order.id + ' удален из-за ошибки');
        }
        
        res.status(500).json({
            ok: false,
            error: error.message
        });
    }
});

// 🔐 АДМИН ПАНЕЛЬ - ПЕРВЫЙ МАРШРУТ (только для /admin, НЕ для /api/admin/*)
app.get('/admin', (req, res) => {
    console.log('🔍 Обработка запроса /admin');
    console.log('🔍 Полный URL:', req.url);
    console.log('🔍 Query параметры:', req.query);
    const adminPassword = config.ADMIN_PASSWORD;
    const providedPassword = req.query.password;
    console.log('🔍 Пароль из конфига:', adminPassword);
    console.log('🔍 Переданный пароль:', providedPassword);
    
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
            color: white;
            border: none;
            padding: 15px;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        .login-btn:hover {
            background: #C1965F;
            transform: translateY(-2px);
        }
        .login-error {
            background: rgba(231, 76, 60, 0.2);
            border: 1px solid #e74c3c;
            color: #e74c3c;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 14px;
        }
        .login-help {
            margin-top: 30px;
            font-size: 14px;
            opacity: 0.7;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="login-icon">🔐</div>
        <h1 class="login-title">Админ панель</h1>
        <p class="login-subtitle">Tundra Gourmet</p>
        
        <div class="login-error">
            ❌ Неверный пароль. Попробуйте еще раз.
        </div>
        
        <form class="login-form" method="GET">
            <input type="password" name="password" class="login-input" placeholder="Введите пароль" required>
            <button type="submit" class="login-btn">Войти</button>
        </form>
        
        <div class="login-help">
            💡 Если забыли пароль, обратитесь к разработчику
        </div>
    </div>
</body>
</html>
        `);
    } else {
        res.sendFile(path.join(webRoot, 'admin.html'));
    }
});

// Health check endpoints
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// 🛡️ ГЛОБАЛЬНАЯ ОБРАБОТКА ОШИБОК
app.use((err, req, res, next) => {
    logger.error('❌ Необработанная ошибка:', err.message);
    logger.error('❌ Stack trace:', err.stack);
    
    // Не показываем детали ошибки в продакшене
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    res.status(500).json({
        error: 'Внутренняя ошибка сервера',
        message: isDevelopment ? err.message : 'Что-то пошло не так',
        timestamp: new Date().toISOString()
    });
});

// Обработка 404
app.use((req, res) => {
    res.status(404).json({
        error: 'Страница не найдена',
        path: req.path,
        timestamp: new Date().toISOString()
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

// Тестовый endpoint для проверки webhook'а
app.get('/test-webhook', (req, res) => {
    res.json({
        ok: true,
        message: 'Webhook endpoint доступен',
        webhookUrl: `${config.BASE_URL}/webhook/yookassa`,
        timestamp: new Date().toISOString()
    });
});

// Простой endpoint для тестирования webhook'а (GET запрос)
app.get('/webhook/yookassa', (req, res) => {
    logger.info('🧪 ТЕСТ WEBHOOK: Получен GET запрос на webhook');
    res.json({
        ok: true,
        message: 'Webhook endpoint работает',
        method: 'GET',
        timestamp: new Date().toISOString()
    });
});

// Endpoint для проверки всех заказов
app.get('/debug/orders', async (req, res) => {
    try {
        logger.info('🔍 DEBUG: Получение всех заказов');
        
        // Получаем все заказы из БД
        const orders = await OrdersDB.getAll();
        
        logger.info('🔍 DEBUG: Найдено заказов в БД:', orders.length);
        
        // Форматируем данные для отображения
        const formattedOrders = orders.map(order => ({
            id: order.order_id,
            status: order.status,
            payment_status: order.payment_status,
            payment_id: order.payment_id,
            total_amount: order.total_amount,
            created_at: order.created_at,
            user_name: order.user_name,
            phone: order.phone
        }));
        
        res.json({
            ok: true,
            count: orders.length,
            orders: formattedOrders,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('❌ DEBUG: Ошибка получения заказов:', error.message);
        res.json({ ok: false, error: error.message });
    }
});

// Тестовый endpoint для принудительной проверки статуса заказа
app.get('/test-payment/:orderId', async (req, res) => {
    const { orderId } = req.params;
    logger.info('🧪 ТЕСТ: Принудительная проверка статуса заказа:', orderId);
    
    try {
        // Получаем заказ из БД
        const orderData = await OrdersDB.getById(orderId);
        if (!orderData) {
            return res.json({ ok: false, error: 'Заказ не найден' });
        }
        
        logger.info('🧪 ТЕСТ: Заказ найден в БД:', {
            id: orderData.order_id,
            status: orderData.status,
            payment_status: orderData.payment_status,
            payment_id: orderData.payment_id
        });
        
        if (!orderData.payment_id) {
            return res.json({ ok: false, error: 'У заказа нет payment_id' });
        }
        
        // Проверяем статус платежа в ЮKassa
        if (!checkout) {
            logger.error('❌ ТЕСТ: checkout не инициализирован');
            return res.status(500).json({ error: 'checkout не инициализирован' });
        }
        const payment = await checkout.getPayment(orderData.payment_id);
        logger.info('🧪 ТЕСТ: Статус платежа в ЮKassa:', {
            id: payment.id,
            status: payment.status,
            paid: payment.paid,
            amount: payment.amount
        });
        
        // Если платеж оплачен, обновляем заказ
        if (payment.status === 'succeeded' && payment.paid) {
            logger.info('🧪 ТЕСТ: Платеж оплачен, обновляем заказ');
            
            await OrdersDB.update(orderId, {
                status: 'accepted',
                payment_status: 'paid',
                payment_id: payment.id,
                total_amount: parseFloat(payment.amount.value)
            });
            
            // Отправляем уведомление в Telegram
            try {
                const orderForNotification = {
                    id: orderId,
                    customerName: orderData.user_name,
                    phone: orderData.phone,
                    totals: { total: parseFloat(payment.amount.value) },
                    address: orderData.address,
                    items: orderData.items
                };
                
                await sendTelegramNotification(orderForNotification, 'paid');
                logger.info('🧪 ТЕСТ: Уведомление отправлено в Telegram');
            } catch (telegramError) {
                logger.error('🧪 ТЕСТ: Ошибка отправки уведомления:', telegramError.message);
            }
            
            res.json({
                ok: true,
                message: 'Заказ обновлен и уведомление отправлено',
                order: {
                    id: orderId,
                    status: 'accepted',
                    paymentStatus: 'paid',
                    total: parseFloat(payment.amount.value)
                }
            });
        } else {
            res.json({
                ok: true,
                message: 'Платеж еще не оплачен',
                payment: {
                    id: payment.id,
                    status: payment.status,
                    paid: payment.paid
                }
            });
        }
    } catch (error) {
        logger.error('🧪 ТЕСТ: Ошибка проверки заказа:', error.message);
        res.json({ ok: false, error: error.message });
    }
});

// Маршрут для возврата после успешной оплаты
app.get('/payment/success', async (req, res) => {
    const { order } = req.query;
    logger.info('🎉 Возврат после успешной оплаты заказа:', order);
    
    // Принудительно проверяем статус заказа и обновляем его
    if (order) {
        try {
            logger.info('🔍 Проверяем статус заказа после возврата:', order);
            
            // Получаем заказ из БД
            const orderData = await OrdersDB.getById(order);
            if (orderData && orderData.payment_id) {
                logger.info('🔍 Проверяем статус платежа в ЮKassa:', orderData.payment_id);
                
                // Проверяем статус платежа в ЮKassa
                if (!checkout) {
                    logger.error('❌ checkout не инициализирован');
                    return;
                }
                const payment = await checkout.getPayment(orderData.payment_id);
                logger.info('🔍 Статус платежа в ЮKassa:', {
                    id: payment.id,
                    status: payment.status,
                    paid: payment.paid
                });
                
                // Если платеж оплачен, обновляем заказ
                if (payment.status === 'succeeded' && payment.paid) {
                    logger.info('✅ Платеж оплачен, обновляем заказ:', order);
                    
                    await OrdersDB.update(order, {
                        status: 'accepted',
                        payment_status: 'paid',
                        payment_id: payment.id,
                        total_amount: parseFloat(payment.amount.value)
                    });
                    
                    // Отправляем уведомление в Telegram
                    try {
                        const orderForNotification = {
                            id: order,
                            customerName: orderData.user_name,
                            phone: orderData.phone,
                            totals: { total: parseFloat(payment.amount.value) },
                            address: orderData.address,
                            items: orderData.items
                        };
                        
                        await sendTelegramNotification(orderForNotification, 'paid');
                        logger.info('✅ Уведомление об оплате отправлено в Telegram');
                    } catch (telegramError) {
                        logger.error('❌ Ошибка отправки уведомления в Telegram:', telegramError.message);
                    }
                }
            }
        } catch (error) {
            logger.error('❌ Ошибка проверки статуса заказа:', error.message);
        }
    }
    
    // Отправляем HTML страницу с редиректом на главную
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Оплата успешна</title>
            <style>
                body { 
                    font-family: Arial, sans-serif; 
                    text-align: center; 
                    padding: 50px; 
                    background: #f5f5f5;
                }
                .success { 
                    background: white; 
                    padding: 30px; 
                    border-radius: 10px; 
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    max-width: 400px;
                    margin: 0 auto;
                }
                .icon { font-size: 48px; margin-bottom: 20px; }
                .title { font-size: 24px; margin-bottom: 10px; color: #2e7d32; }
                .message { color: #666; margin-bottom: 30px; }
                .button { 
                    background: #1976d2; 
                    color: white; 
                    padding: 12px 24px; 
                    border: none; 
                    border-radius: 5px; 
                    cursor: pointer; 
                    font-size: 16px;
                    text-decoration: none;
                    display: inline-block;
                }
                .button:hover { background: #1565c0; }
            </style>
        </head>
        <body>
            <div class="success">
                <div class="icon">✅</div>
                <div class="title">Оплата успешна!</div>
                <div class="message">Ваш заказ #${order || 'неизвестен'} оплачен</div>
                <button onclick="goBack()" class="button">Вернуться в магазин</button>
            </div>
            <script>
                function goBack() {
                    // Возвращаемся в приложение с параметром order
                    const appUrl = 'https://tundra-miniapp-production.up.railway.app/?order=${order || ''}';
                    
                    // Проверяем, находимся ли мы в Telegram WebApp
                    if (window.Telegram && window.Telegram.WebApp) {
                        // Открываем приложение с параметром order
                        window.Telegram.WebApp.openLink(appUrl);
                    } else {
                        // Обычный браузер - перенаправляем в приложение
                        window.location.href = appUrl;
                    }
                }
                
                // Автоматический редирект через 3 секунды
                setTimeout(goBack, 3000);
            </script>
        </body>
        </html>
    `);
});

// Тестовый эндпоинт для проверки webhook'а
app.get('/test-webhook', (req, res) => {
    res.json({
        ok: true,
        message: 'Webhook доступен',
        url: 'https://tundra-miniapp-production.up.railway.app/webhook/yookassa',
        timestamp: new Date().toISOString()
    });
});

// Webhook для обработки уведомлений от ЮKassa
app.post('/webhook/yookassa', express.raw({type: 'application/json'}), async (req, res) => {
    try {
        logger.info('🔔 WEBHOOK: Получено уведомление от ЮKassa');
        logger.info('🔔 WEBHOOK: IP адрес:', req.ip);
        logger.info('🔔 WEBHOOK: User-Agent:', req.headers['user-agent']);
        logger.info('🔔 WEBHOOK: Content-Type:', req.headers['content-type']);
        
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
        if (notification.type === 'notification' && notification.event === 'payment.succeeded') {
            const payment = notification.object;
            logger.info('✅ WEBHOOK: Платеж успешно завершен:', payment.id);
            
            // Обновляем статус заказа в базе данных
            if (payment.metadata && payment.metadata.orderId) {
                const orderId = payment.metadata.orderId;
                logger.info('🔄 Обновляем статус заказа:', orderId);
                
                try {
                    // Обновляем статус заказа И сумму
                    const paymentAmount = parseFloat(payment.amount.value);
                    
                    // 🔍 ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ СУММЫ
                    logger.info(`💰 WEBHOOK: Сумма платежа от YooKassa:`, {
                        raw_amount: payment.amount,
                        value: payment.amount.value,
                        currency: payment.amount.currency,
                        parsed_amount: paymentAmount,
                        type: typeof paymentAmount
                    });
                    
                    await OrdersDB.update(orderId, { 
                        status: 'accepted',
                        payment_status: 'paid',
                        payment_id: payment.id,
                        total_amount: paymentAmount
                    });
                    
                    // Получаем данные заказа для создания записи в истории покупок
                    const order = await OrdersDB.getById(orderId);
                    if (order) {
                        logger.info(`🔍 WEBHOOK: Заказ ${orderId} из БД:`, {
                            user_id: order.user_id,
                            user_name: order.user_name,
                            total_amount: order.total_amount
                        });
                        
                        // Создаем запись в purchase_history для лояльности
                        logger.info(`📝 WEBHOOK: Проверяем user_id для заказа ${orderId}:`, {
                            user_id: order.user_id,
                            user_id_type: typeof order.user_id,
                            user_id_length: order.user_id?.length
                        });
                        
                        if (order.user_id && order.user_id !== 'unknown') {
                            logger.info(`📝 WEBHOOK: Создаем запись в purchase_history для заказа ${orderId}, пользователь: ${order.user_id}`);
                            
                            try {
                                // Детальное логирование как рекомендует специалист
                                logger.info('=== YOOKASSA WEBHOOK DEBUG ===');
                                logger.info('📝 WEBHOOK: Полные данные платежа:', JSON.stringify(payment, null, 2));
                                logger.info('📝 WEBHOOK: Структура amount:', JSON.stringify(payment.amount, null, 2));
                                
                                // Проверяем путь к сумме
                                const amountPath = payment.amount?.value ?? 'PATH_NOT_FOUND';
                                logger.info(`📝 WEBHOOK: Amount path check: ${amountPath}`);
                                
                                // Парсим сумму
                                const totalAmount = parseFloat(amountPath);
                                logger.info(`📝 WEBHOOK: Before save to DB - amount: ${totalAmount}`);
                                
                                // Проверяем, что сумма валидна
                                if (isNaN(totalAmount) || totalAmount <= 0) {
                                    logger.error(`❌ WEBHOOK: НЕВЕРНАЯ СУММА! Сырая: ${amountPath}, Парсинг: ${totalAmount}`);
                                }
                                logger.info('============================');
                                
                                const purchaseRecord = await PurchaseHistoryDB.create({
                                    order_id: orderId,
                                    user_id: order.user_id,
                                    customer_name: order.user_name || 'Клиент',
                                    phone: order.phone || '',
                                    total_amount: order.total_amount, // Используем сумму из заказа, а не из платежа
                                    items_count: Array.isArray(order.items) ? order.items.length : JSON.parse(order.items || '[]').length,
                                    items_data: typeof order.items === 'string' ? order.items : JSON.stringify(order.items),
                                    payment_id: payment.id,
                                    delivery_zone: order.delivery_zone || 'moscow',
                                    address_data: order.address || '{}'
                                });
                                
                                logger.info('✅ WEBHOOK: Заказ добавлен в историю покупок:', {
                                    id: purchaseRecord.id,
                                    user_id: purchaseRecord.user_id,
                                    amount_in_db: purchaseRecord.amount,
                                    total_amount_from_order: order.total_amount,
                                    payment_amount: totalAmount
                                });
                                
                                // Проверяем, что сумма сохранилась правильно
                                if (purchaseRecord.amount !== order.total_amount) {
                                    logger.error(`❌ WEBHOOK: СУММА НЕ СОВПАДАЕТ! Отправлено: ${order.total_amount}, В БД: ${purchaseRecord.amount}`);
                                }
                            } catch (purchaseError) {
                                logger.error('❌ WEBHOOK: Ошибка создания записи в purchase_history:', purchaseError.message);
                            }
                        } else {
                            logger.warn(`⚠️ WEBHOOK: Пропускаем создание записи в purchase_history - user_id: ${order.user_id}`);
                        }
                        
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
                                
                                // Создаем кнопки для оплаченного заказа согласно ТЗ
                                const inlineKeyboard = {
                                    inline_keyboard: [
                                        [
                                            { text: '🟡 Принят в работу', callback_data: `accept_${orderId}` },
                                            { text: '🔵 Готовится', callback_data: `preparing_${orderId}` }
                                        ],
                                        [
                                            { text: '🚚 В доставке', callback_data: `delivering_${orderId}` },
                                            { text: '✅ Доставлен', callback_data: `completed_${orderId}` }
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
        logger.info('✅ WEBHOOK: Отправляем ответ 200 OK');
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

// API для заказов ПЕРЕМЕЩЕН ВЫШЕ - ПЕРЕД SPA FALLBACK


// 🔄 ФУНКЦИЯ СИНХРОНИЗАЦИИ ОПЛАЧЕННЫХ ЗАКАЗОВ С ЛОЯЛЬНОСТЬЮ
async function syncPaidOrdersToLoyalty(userId) {
    try {
        console.log('🔍 СИНХРОНИЗАЦИЯ: НАЧАЛО для пользователя ' + userId);
        logger.info('🔄 СИНХРОНИЗАЦИЯ: Проверяем оплаченные заказы для пользователя ' + userId);
        
        // Получаем все заказы пользователя из БД
        const orders = await OrdersDB.getByUserId(userId);
        logger.info('🔄 СИНХРОНИЗАЦИЯ: Найдено ' + orders.length + ' заказов в БД');
        console.log('🔍 СИНХРОНИЗАЦИЯ: Все заказы:', orders.map(o => ({
            order_id: o.order_id,
            payment_status: o.payment_status,
            status: o.status,
            payment_id: o.payment_id,
            total_amount: o.total_amount
        })));
        
        // Получаем существующие записи в purchase_history
        const existingPurchases = await PurchaseHistoryDB.getByUserId(userId);
        const existingOrderIds = new Set(existingPurchases.map(p => p.order_id));
        logger.info('🔄 СИНХРОНИЗАЦИЯ: Уже есть ' + existingOrderIds.size + ' записей в purchase_history');
        
        let addedCount = 0;
        
        // Проверяем каждый заказ
        for (const order of orders) {
            console.log('🔍 СИНХРОНИЗАЦИЯ: Заказ ' + order.order_id + ':', {
                payment_status: order.payment_status,
                status: order.status,
                total_amount: order.total_amount
            });
            
            // Пропускаем если уже есть в purchase_history
            if (existingOrderIds.has(order.order_id)) {
                console.log('🔍 СИНХРОНИЗАЦИЯ: Заказ ' + order.order_id + ' уже есть в purchase_history');
                continue;
            }
            
            // Проверяем статус оплаты (расширенные условия)
            const isPaid = order.payment_status === 'paid' || 
                          order.status === 'completed' || 
                          order.status === 'delivered' ||
                          order.status === 'accepted' ||
                          (order.payment_id && order.payment_id !== '');
            
            if (isPaid) {
                logger.info('🔄 СИНХРОНИЗАЦИЯ: Добавляем оплаченный заказ ' + order.order_id + ' в лояльность');
                logger.info('🔄 СИНХРОНИЗАЦИЯ: Данные заказа:', {
                    order_id: order.order_id,
                    total_amount: order.total_amount,
                    totalAmount: order.totalAmount,
                    payment_status: order.payment_status,
                    status: order.status
                });
                
                try {
                    await PurchaseHistoryDB.create({
                        order_id: order.order_id,
                        user_id: order.user_id,
                        customer_name: order.user_name || 'Клиент',
                        phone: order.phone || '',
                        total_amount: order.total_amount || order.totalAmount || 0,
                        items_count: Array.isArray(order.items) ? order.items.length : JSON.parse(order.items || '[]').length,
                        items_data: typeof order.items === 'string' ? order.items : JSON.stringify(order.items),
                        payment_id: order.payment_id || '',
                        delivery_zone: order.delivery_zone || 'moscow',
                        address_data: order.address || '{}'
                    });
                    
                    addedCount++;
                    logger.info('✅ СИНХРОНИЗАЦИЯ: Заказ ' + order.order_id + ' добавлен в лояльность');
                } catch (error) {
                    logger.error('❌ СИНХРОНИЗАЦИЯ: Ошибка добавления заказа ' + order.order_id + ':', error.message);
                }
            } else {
                console.log('🔍 СИНХРОНИЗАЦИЯ: Заказ ' + order.order_id + ' не подходит - payment_status: ' + order.payment_status + ', status: ' + order.status + ', payment_id: ' + order.payment_id);
            }
        }
        
        logger.info('🔄 СИНХРОНИЗАЦИЯ: Добавлено ' + addedCount + ' новых записей в лояльность');
        console.log('🔍 СИНХРОНИЗАЦИЯ: КОНЕЦ - добавлено ' + addedCount + ' записей');
        return addedCount;
    } catch (error) {
        logger.error('❌ СИНХРОНИЗАЦИЯ: Ошибка синхронизации лояльности:', error.message);
        console.log('🔍 СИНХРОНИЗАЦИЯ: ОШИБКА - ' + error.message);
        return 0;
    }
}

// 🔍 ENDPOINT ДЛЯ ПРОВЕРКИ ТАБЛИЦЫ PURCHASE_HISTORY
app.get('/api/check-db', async (req, res) => {
    try {
        // Используем существующую функцию базы данных
        const purchases = await PurchaseHistoryDB.getByUserId('7303614654');
        
        logger.info('🔍 ПРОВЕРКА БД: Результат через PurchaseHistoryDB:', purchases);
        
        res.json({
            ok: true,
            count: purchases.length,
            records: purchases.slice(0, 5).map(row => ({
                order_id: row.order_id,
                totalAmount: row.totalAmount,
                purchase_date: row.purchase_date
            }))
        });
    } catch (error) {
        logger.error('❌ ПРОВЕРКА БД: Ошибка:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔍 ENDPOINT ДЛЯ ПРОВЕРКИ НАСТРОЕК WEBHOOK
app.get('/api/check-webhook', async (req, res) => {
    try {
        const webhookUrl = `${config.BASE_URL}/webhook/yookassa`;
        
        res.json({
            ok: true,
            webhookUrl,
            message: `Webhook URL для YooKassa: ${webhookUrl}`,
            instructions: [
                '1. Зайдите в личный кабинет YooKassa',
                '2. Перейдите в раздел "Настройки" → "Webhook"',
                `3. Укажите URL: ${webhookUrl}`,
                '4. Выберите события: payment.succeeded, payment.canceled',
                '5. Сохраните настройки'
            ]
        });
    } catch (error) {
        logger.error('❌ ПРОВЕРКА WEBHOOK: Ошибка:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🗑️ ENDPOINT ДЛЯ ОЧИСТКИ БД (ТОЛЬКО ДЛЯ АДМИНА!)
app.post('/api/admin/clear-database', async (req, res) => {
    try {
        // Простая проверка авторизации (можно улучшить)
        const { adminKey } = req.body;
        if (adminKey !== 'meatbot_admin_2024') {
            return res.status(403).json({ ok: false, error: 'Неверный ключ администратора' });
        }
        
        logger.info('🗑️ АДМИН: Начинаем очистку базы данных...');
        
        // Очищаем только историю заказов (НЕ товары!)
        const tables = ['purchase_history', 'orders'];
        const results = {};
        
        for (const table of tables) {
            const result = await pool.query(`DELETE FROM ${table}`);
            results[table] = result.rowCount;
            logger.info(`🗑️ АДМИН: Таблица ${table} очищена: ${result.rowCount} записей`);
        }
        
        // Сбрасываем счетчики только для очищенных таблиц
        await pool.query("SELECT setval('orders_id_seq', 1, false)");
        await pool.query("SELECT setval('purchase_history_id_seq', 1, false)");
        
        logger.info('🗑️ АДМИН: База данных очищена успешно');
        
        res.json({
            ok: true,
            message: 'База данных успешно очищена',
            deleted: results
        });
        
    } catch (error) {
        logger.error('❌ АДМИН: Ошибка очистки БД:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔍 ENDPOINT ДЛЯ ПРОВЕРКИ WEBHOOK ЛОГОВ
app.get('/api/webhook-logs', async (req, res) => {
    try {
        // Проверяем, есть ли записи в purchase_history
        const purchases = await PurchaseHistoryDB.getByUserId('7303614654');
        
        // Проверяем, есть ли оплаченные заказы
        const orders = await OrdersDB.getByUserId('7303614654');
        const paidOrders = orders.filter(order => order.payment_status === 'paid' || order.status === 'completed');
        
        // 🔍 ПРОВЕРЯЕМ СУММЫ В PURCHASE_HISTORY
        const totalSpent = purchases.reduce((sum, purchase) => sum + (purchase.totalAmount || 0), 0);
        const totalSpentFromAmount = purchases.reduce((sum, purchase) => sum + (purchase.amount || 0), 0);
        
        res.json({
            ok: true,
            webhookUrl: `${config.BASE_URL}/webhook/yookassa`,
            purchaseHistoryCount: purchases.length,
            totalOrders: orders.length,
            paidOrders: paidOrders.length,
            totalSpentFromTotalAmount: totalSpent,
            totalSpentFromAmount: totalSpentFromAmount,
            purchaseHistoryDetails: purchases.slice(0, 5).map(p => ({
                order_id: p.order_id,
                totalAmount: p.totalAmount,
                amount: p.amount,
                purchase_date: p.purchase_date
            })),
            paidOrdersList: paidOrders.map(order => ({
                order_id: order.order_id,
                payment_status: order.payment_status,
                status: order.status,
                total_amount: order.total_amount,
                created_at: order.created_at
            })),
            message: purchases.length === 0 ? '❌ Webhook не работает! Записей в purchase_history нет.' : '✅ Webhook работает, записи есть.'
        });
    } catch (error) {
        logger.error('❌ ПРОВЕРКА WEBHOOK ЛОГОВ: Ошибка:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔄 ENDPOINT ДЛЯ РУЧНОЙ СИНХРОНИЗАЦИИ ЛОЯЛЬНОСТИ
app.post('/api/sync-loyalty/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        logger.info(`🔄 РУЧНАЯ СИНХРОНИЗАЦИЯ: Запрос для пользователя ${userId}`);
        
        const addedCount = await syncPaidOrdersToLoyalty(userId);
        
        res.json({
            ok: true,
            userId,
            addedCount,
            message: `Добавлено ${addedCount} новых записей в лояльность`
        });
    } catch (error) {
        logger.error('❌ РУЧНАЯ СИНХРОНИЗАЦИЯ: Ошибка:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔍 ДИАГНОСТИЧЕСКИЙ ENDPOINT ДЛЯ ПРОВЕРКИ ДАННЫХ В БД
app.get('/debug-purchases/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        logger.info(`🔍 DEBUG: Проверяем данные в БД для пользователя: ${userId}`);
        
        // Используем существующую функцию базы данных
        const purchases = await PurchaseHistoryDB.getByUserId(userId);
        
        logger.info(`🔍 DEBUG: Найдено ${purchases.length} записей через PurchaseHistoryDB`);
        purchases.slice(0, 5).forEach((row, index) => {
            logger.info(`🔍 DEBUG: Запись ${index + 1}:`, {
                order_id: row.order_id,
                totalAmount: row.totalAmount,
                purchase_date: row.purchase_date,
                payment_id: row.payment_id
            });
        });
        
        res.json({
            ok: true,
            userId,
            count: purchases.length,
            records: purchases.slice(0, 5)
        });
    } catch (error) {
        logger.error('❌ DEBUG: Ошибка проверки БД:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});


// API для получения истории покупок клиента
app.get('/api/purchases/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        logger.info(`🔍 API: Запрос данных лояльности для пользователя: ${userId}`);
        
        // 🔄 СНАЧАЛА ПРОВЕРЯЕМ И СИНХРОНИЗИРУЕМ ОПЛАЧЕННЫЕ ЗАКАЗЫ
        await syncPaidOrdersToLoyalty(userId);
        
        // Загружаем историю покупок из БД
        const purchases = await PurchaseHistoryDB.getByUserId(userId);
        logger.info(`🔍 API: Найдено ${purchases.length} покупок для пользователя ${userId}`);
        
        // Логируем детали покупок
        if (purchases.length > 0) {
            logger.info(`🔍 API: Детали покупок:`, purchases.map(p => ({
                order_id: p.order_id,
                totalAmount: p.totalAmount,
                amount: p.amount,
                purchase_date: p.purchase_date
            })));
        }
        
        // Подсчитываем статистику лояльности
        const totalPurchases = purchases.length;
        const totalSpent = purchases.reduce((sum, purchase) => {
            const amount = purchase.totalAmount || purchase.amount || 0;
            logger.info(`💰 API: Покупка ${purchase.order_id}: totalAmount=${purchase.totalAmount}, amount=${purchase.amount}, используем=${amount}`);
            return sum + amount;
        }, 0);
        logger.info(`💰 API: Общая сумма потрачена: ${totalSpent}₽, покупок: ${totalPurchases}`);
        
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

// API для управления категориями
app.get('/api/admin/categories', requireAdminAuth, async (req, res) => {
    try {
        const categories = await CategoriesDB.getStats();
        res.json({ ok: true, categories });
    } catch (error) {
        logger.error('❌ Ошибка получения категорий:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// API для переключения видимости категории
app.put('/api/admin/categories/:categoryId/visibility', requireAdminAuth, async (req, res) => {
    try {
        const { categoryId } = req.params;
        const isVisible = await CategoriesDB.toggleVisibility(categoryId);
        
        if (isVisible !== null) {
            logger.info(`📂 Категория ${categoryId} ${isVisible ? 'показана' : 'скрыта'}`);
            res.json({ ok: true, isVisible, message: `Категория ${isVisible ? 'показана' : 'скрыта'}` });
        } else {
            res.status(404).json({ ok: false, error: 'Категория не найдена' });
        }
    } catch (error) {
        logger.error('❌ Ошибка переключения видимости категории:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// API для получения видимых категорий (для основного приложения)
app.get('/api/categories/visible', async (req, res) => {
    try {
        const categories = await CategoriesDB.getVisible();
        res.json({ ok: true, categories });
    } catch (error) {
        logger.error('❌ Ошибка получения видимых категорий:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔍 API ДЛЯ ПРИНУДИТЕЛЬНОГО ДОБАВЛЕНИЯ ПОЛЬЗОВАТЕЛЯ В РАССЫЛКУ
app.post('/api/debug/add-user', requireAdminAuth, async (req, res) => {
    try {
        const { telegram_user_id, first_name } = req.body;
        
        if (!telegram_user_id) {
            return res.status(400).json({ ok: false, error: 'Не указан telegram_user_id' });
        }
        
        // Добавляем пользователя принудительно
        const userData = {
            id: telegram_user_id,
            first_name: first_name || 'Тестовый пользователь',
            last_name: '',
            username: '',
            language_code: 'ru',
            is_bot: false
        };
        
        const savedUser = await BotUsersDB.upsert(userData);
        
        res.json({
            ok: true,
            message: 'Пользователь добавлен в рассылку',
            user: savedUser
        });
        
    } catch (error) {
        logger.error('❌ Ошибка добавления пользователя:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔍 API ДЛЯ ТЕСТОВОЙ ОТПРАВКИ СООБЩЕНИЯ
app.post('/api/debug/test-broadcast', requireAdminAuth, async (req, res) => {
    try {
        const { message_text } = req.body;
        
        if (!message_text) {
            return res.status(400).json({ ok: false, error: 'Не указан текст сообщения' });
        }
        
        logger.info('🧪 ТЕСТ РАССЫЛКИ: Запуск тестовой рассылки');
        
        // Имитируем сообщение из группы
        const testMessage = {
            text: message_text,
            from: {
                first_name: 'Тест'
            }
        };
        
        await handleGroupMessage(testMessage);
        
        res.json({
            ok: true,
            message: 'Тестовая рассылка запущена'
        });
        
    } catch (error) {
        logger.error('❌ Ошибка тестовой рассылки:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔍 API ДЛЯ ПРОВЕРКИ СТАТУСА WEBHOOK TELEGRAM
app.get('/api/debug/webhook-info', requireAdminAuth, async (req, res) => {
    try {
        if (!config.TELEGRAM_BOT_TOKEN) {
            return res.status(400).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN не настроен' });
        }
        
        // Получаем информацию о webhook
        const webhookInfoResponse = await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
        
        // Получаем информацию о боте
        const botInfoResponse = await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getMe`);
        
        res.json({
            ok: true,
            webhook: webhookInfoResponse.data.result,
            bot: botInfoResponse.data.result,
            expected_webhook_url: 'https://tundra-miniapp-production.up.railway.app/api/telegram/webhook',
            broadcast_chat_id: config.TELEGRAM_BROADCAST_CHAT_ID
        });
        
    } catch (error) {
        logger.error('❌ Ошибка проверки webhook:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔍 API ДЛЯ ПРОВЕРКИ ПРАВ БОТА В ГРУППЕ
app.get('/api/debug/bot-permissions', requireAdminAuth, async (req, res) => {
    try {
        if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_BROADCAST_CHAT_ID) {
            return res.status(400).json({ 
                ok: false, 
                error: 'TELEGRAM_BOT_TOKEN или TELEGRAM_BROADCAST_CHAT_ID не настроены' 
            });
        }
        
        let broadcastChatId = config.TELEGRAM_BROADCAST_CHAT_ID.toString();
        if (!broadcastChatId.startsWith('-')) {
            broadcastChatId = '-' + broadcastChatId;
        }
        
        try {
            // Проверяем, есть ли бот в группе и какие у него права
            const chatMemberResponse = await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getChatMember`, {
                chat_id: broadcastChatId,
                user_id: (await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getMe`)).data.result.id
            });
            
            const chatInfoResponse = await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/getChat`, {
                chat_id: broadcastChatId
            });
            
            res.json({
                ok: true,
                chat_id: broadcastChatId,
                bot_status: chatMemberResponse.data.result,
                chat_info: chatInfoResponse.data.result,
                message: chatMemberResponse.data.result.status === 'administrator' ? 
                    '✅ Бот является админом в группе' : 
                    `⚠️ Статус бота: ${chatMemberResponse.data.result.status}`
            });
            
        } catch (apiError) {
            if (apiError.response?.data?.error_code === 400) {
                return res.json({
                    ok: false,
                    error: '❌ Бот не найден в группе или группа не существует',
                    chat_id: broadcastChatId,
                    suggestion: 'Добавьте бота в группу и дайте ему права администратора'
                });
            }
            throw apiError;
        }
        
    } catch (error) {
        logger.error('❌ Ошибка проверки прав бота:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// 🔍 ОТЛАДОЧНЫЙ API ДЛЯ ДИАГНОСТИКИ РАССЫЛКИ
app.get('/api/debug/broadcast', requireAdminAuth, async (req, res) => {
    try {
        // Проверяем конфигурацию
        const configStatus = {
            TELEGRAM_BOT_TOKEN: config.TELEGRAM_BOT_TOKEN ? '✅ Установлен' : '❌ НЕ установлен',
            TELEGRAM_BROADCAST_CHAT_ID: config.TELEGRAM_BROADCAST_CHAT_ID ? `✅ ${config.TELEGRAM_BROADCAST_CHAT_ID}` : '❌ НЕ установлен',
            TELEGRAM_ADMIN_CHAT_ID: config.TELEGRAM_ADMIN_CHAT_ID ? `✅ ${config.TELEGRAM_ADMIN_CHAT_ID}` : '❌ НЕ установлен'
        };
        
        // Получаем статистику пользователей
        const userStats = await BotUsersDB.getStats();
        
        // Получаем список всех пользователей для рассылки
        const allUsers = await getSubscribedUsers();
        
        // Получаем пользователей из orders для сравнения
        const ordersQuery = `
            SELECT DISTINCT telegram_user_id, COUNT(*) as orders_count
            FROM orders 
            WHERE telegram_user_id IS NOT NULL 
            AND telegram_user_id != ''
            AND status != 'cancelled'
            GROUP BY telegram_user_id
            ORDER BY orders_count DESC
        `;
        const ordersResult = await pool.query(ordersQuery);
        
        res.json({
            ok: true,
            config: configStatus,
            userStats,
            broadcastUsers: {
                total: allUsers.length,
                users: allUsers.slice(0, 10) // Первые 10 для примера
            },
            ordersUsers: {
                total: ordersResult.rows.length,
                users: ordersResult.rows.slice(0, 10)
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('❌ Ошибка отладки рассылки:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// API для получения конкретного заказа ПЕРЕМЕЩЕН ВЫШЕ - ПЕРЕД SPA FALLBACK

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

// Тестовый эндпоинт для проверки Telegram webhook'а
app.get('/test-telegram-webhook', (req, res) => {
    res.json({
        ok: true,
        message: 'Telegram webhook доступен',
        url: 'https://tundra-miniapp-production.up.railway.app/api/telegram/webhook',
        timestamp: new Date().toISOString()
    });
});

// Эндпоинт для настройки webhook'а Telegram
app.get('/setup-telegram-webhook', async (req, res) => {
    try {
        if (!config.TELEGRAM_BOT_TOKEN) {
            return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN не настроен' });
        }
        
        const webhookUrl = 'https://tundra-miniapp-production.up.railway.app/api/telegram/webhook';
        
        const response = await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/setWebhook`, {
            url: webhookUrl
        });
        
        res.json({
            ok: true,
            message: 'Webhook настроен',
            webhookUrl: webhookUrl,
            telegramResponse: response.data
        });
    } catch (error) {
        res.status(500).json({
            error: 'Ошибка настройки webhook',
            details: error.message
        });
    }
});

// Webhook для Telegram
app.post('/api/telegram/webhook', async (req, res) => {
    try {
        logger.info('🔔 TELEGRAM WEBHOOK: Получен запрос от Telegram');
        logger.info('🔔 TELEGRAM WEBHOOK: req.body:', JSON.stringify(req.body, null, 2));
        logger.info('🔔 TELEGRAM WEBHOOK: req.headers:', JSON.stringify(req.headers, null, 2));
        
        const { message, callback_query } = req.body;
        
        if (callback_query) {
            logger.info('🔔 TELEGRAM WEBHOOK: Обрабатываем callback_query:', callback_query.data);
            logger.info('🔔 TELEGRAM WEBHOOK: callback_query полные данные:', JSON.stringify(callback_query, null, 2));
            
            // Сохраняем пользователя в базу данных
            if (callback_query.from && callback_query.from.id) {
                try {
                    await BotUsersDB.upsert(callback_query.from);
                    logger.debug(`👤 Пользователь ${callback_query.from.id} сохранен/обновлен в БД (callback)`);
                } catch (error) {
                    logger.warn(`⚠️ Ошибка сохранения пользователя ${callback_query.from.id}:`, error.message);
                }
            }
            
            // Обрабатываем нажатие на inline-кнопку
            await handleCallbackQuery(callback_query);
            logger.info('🔔 TELEGRAM WEBHOOK: callback_query обработан успешно');
        } else if (message) {
            logger.info('🔔 TELEGRAM WEBHOOK: Обрабатываем сообщение:', message.text);
            logger.info('🔔 TELEGRAM WEBHOOK: Полные данные message:', JSON.stringify(message, null, 2));
            
            // Проверяем, из какой группы пришло сообщение
            let broadcastChatId = config.TELEGRAM_BROADCAST_CHAT_ID?.toString();
            let adminChatId = config.TELEGRAM_ADMIN_CHAT_ID?.toString();
            const messageChatId = message.chat.id.toString();
            
            logger.info('🔔 TELEGRAM WEBHOOK: CONFIG DUMP:', {
                TELEGRAM_BROADCAST_CHAT_ID: config.TELEGRAM_BROADCAST_CHAT_ID,
                TELEGRAM_ADMIN_CHAT_ID: config.TELEGRAM_ADMIN_CHAT_ID,
                broadcastChatId_before: broadcastChatId,
                adminChatId_before: adminChatId,
                messageChatId: messageChatId
            });
            
            // Добавляем отрицательный знак если его нет (группы в Telegram имеют отрицательные ID)
            if (broadcastChatId && !broadcastChatId.startsWith('-')) {
                broadcastChatId = '-' + broadcastChatId;
            }
            if (adminChatId && !adminChatId.startsWith('-')) {
                adminChatId = '-' + adminChatId;
            }
            
            logger.info(`🔍 ПРОВЕРКА: Сообщение от ${messageChatId}`);
            logger.info(`📢 Рассылочная группа: ${broadcastChatId}`);
            logger.info(`📋 Админ группа заказов: ${adminChatId}`);
            
            logger.info('🔔 TELEGRAM WEBHOOK: СРАВНЕНИЕ ID:', {
                messageChatId: messageChatId,
                broadcastChatId: broadcastChatId,
                isEqual: messageChatId === broadcastChatId,
                messageType: typeof messageChatId,
                broadcastType: typeof broadcastChatId
            });
            
            if (broadcastChatId && messageChatId === broadcastChatId) {
                logger.info('📢 РАССЫЛКА: Получено сообщение из группы рассылки для клиентов');
                await handleGroupMessage(message);
            } else if (adminChatId && messageChatId === adminChatId) {
                logger.info('📋 АДМИН: Сообщение из группы заказов (не рассылаем клиентам)');
                // Не обрабатываем сообщения из админ-группы заказов для рассылки
            } else {
                // Обрабатываем обычные сообщения от пользователей
                logger.debug(`💬 ЛИЧНОЕ: Получено сообщение от пользователя ${messageChatId}:`, message.text);
                
                // Сохраняем пользователя в базу данных
                if (message.from && message.from.id) {
                    try {
                        await BotUsersDB.upsert(message.from);
                        logger.debug(`👤 Пользователь ${message.from.id} сохранен/обновлен в БД`);
                    } catch (error) {
                        logger.warn(`⚠️ Ошибка сохранения пользователя ${message.from.id}:`, error.message);
                    }
                }
            }
        } else {
            logger.warn('🔔 TELEGRAM WEBHOOK: Неизвестный тип данных:', Object.keys(req.body));
            logger.warn('🔔 TELEGRAM WEBHOOK: Полные данные:', JSON.stringify(req.body, null, 2));
        }
        
        res.status(200).json({ ok: true });
    } catch (error) {
        logger.error('❌ TELEGRAM WEBHOOK: Ошибка обработки:', error.message);
        logger.error('❌ TELEGRAM WEBHOOK: Стек ошибки:', error.stack);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Дополнительный webhook для тестирования
app.get('/api/telegram/webhook', (req, res) => {
    logger.info('🔔 GET WEBHOOK TEST: Запрос на проверку webhook');
    res.json({ 
        ok: true, 
        message: 'Telegram webhook доступен',
        timestamp: new Date().toISOString()
    });
});

// ТЕСТОВЫЙ endpoint для проверки работы сервера
app.post('/api/test-webhook', (req, res) => {
    logger.info('🔔 TEST WEBHOOK: Тест запрос получен', {
        body: req.body,
        headers: req.headers
    });
    res.json({
        ok: true,
        message: 'Тест успешен!',
        received: req.body
    });
});

// 📢 ФУНКЦИЯ ОБРАБОТКИ СООБЩЕНИЙ ИЗ АДМИН-ГРУППЫ ДЛЯ РАССЫЛКИ
async function handleGroupMessage(message) {
    try {
        const messageText = message.text;
        const senderName = message.from?.first_name || 'Администратор';
        
        logger.info(`📢 РАССЫЛКА: Обрабатываем сообщение от ${senderName}: "${messageText}"`);
        
        // Пропускаем команды бота и служебные сообщения
        if (messageText?.startsWith('/') || messageText?.startsWith('🆔') || messageText?.startsWith('📦')) {
            logger.info('📢 РАССЫЛКА: Пропускаем служебное сообщение');
            return;
        }
        
        // Получаем всех пользователей с включенными уведомлениями
        const subscribedUsers = await getSubscribedUsers();
        
        if (subscribedUsers.length === 0) {
            logger.info('📢 РАССЫЛКА: Нет подписанных пользователей');
            return;
        }
        
        logger.info(`📢 РАССЫЛКА: Найдено ${subscribedUsers.length} подписанных пользователей`);
        
        // Формируем сообщение для рассылки
        const broadcastMessage = `📢 *Уведомление от Tundra Gourmet*\n\n${messageText}`;
        
        // Отправляем сообщение каждому подписчику
        let successCount = 0;
        let errorCount = 0;
        
        for (const user of subscribedUsers) {
            try {
                await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: user.telegram_user_id,
                    text: broadcastMessage,
                    parse_mode: 'Markdown'
                });
                successCount++;
                logger.debug(`✅ Сообщение отправлено пользователю ${user.telegram_user_id}`);
            } catch (error) {
                errorCount++;
                logger.warn(`❌ Ошибка отправки пользователю ${user.telegram_user_id}:`, error.response?.data?.description || error.message);
            }
            
            // Небольшая задержка между отправками для избежания rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Отправляем отчет в админ-группу
        const reportMessage = `📊 *Отчет о рассылке*\n\n` +
            `📝 Сообщение: "${messageText}"\n` +
            `✅ Успешно отправлено: ${successCount}\n` +
            `❌ Ошибок: ${errorCount}\n` +
            `👥 Всего подписчиков: ${subscribedUsers.length}`;
        
        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: config.TELEGRAM_BROADCAST_CHAT_ID,
            text: reportMessage,
            parse_mode: 'Markdown'
        });
        
        logger.info(`📢 РАССЫЛКА: Завершена. Успешно: ${successCount}, Ошибок: ${errorCount}`);
        
    } catch (error) {
        logger.error('❌ РАССЫЛКА: Ошибка обработки группового сообщения:', error.message);
        
        // Уведомляем об ошибке в админ-группу
        try {
            await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: config.TELEGRAM_BROADCAST_CHAT_ID,
                text: `❌ *Ошибка рассылки*\n\nОшибка: ${error.message}`,
                parse_mode: 'Markdown'
            });
        } catch (reportError) {
            logger.error('❌ Не удалось отправить отчет об ошибке:', reportError.message);
        }
    }
}

// 📋 ФУНКЦИЯ ПОЛУЧЕНИЯ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ ДЛЯ РАССЫЛКИ
async function getSubscribedUsers() {
    try {
        // Получаем ВСЕХ активных пользователей бота (кто когда-либо писал боту)
        const users = await BotUsersDB.getAllActiveUsers();
        
        logger.info(`📋 Найдено ${users.length} активных пользователей бота для рассылки`);
        
        // Если нет пользователей в bot_users, используем fallback из orders
        if (users.length === 0) {
            logger.warn('⚠️ Таблица bot_users пуста, используем fallback из заказов');
            
            const fallbackQuery = `
                SELECT DISTINCT telegram_user_id 
                FROM orders 
                WHERE telegram_user_id IS NOT NULL 
                AND telegram_user_id != ''
                AND status != 'cancelled'
            `;
            const fallbackResult = await pool.query(fallbackQuery);
            const fallbackUsers = fallbackResult.rows.map(row => ({
                telegram_user_id: row.telegram_user_id
            }));
            
            logger.info(`📋 Fallback: Найдено ${fallbackUsers.length} пользователей из заказов`);
            return fallbackUsers;
        }
        
        return users;
        
    } catch (error) {
        logger.error('❌ Ошибка получения пользователей бота:', error.message);
        
        // Критический fallback: получаем из заказов
        try {
            const fallbackQuery = `
                SELECT DISTINCT telegram_user_id 
                FROM orders 
                WHERE telegram_user_id IS NOT NULL 
                AND telegram_user_id != ''
                AND status != 'cancelled'
            `;
            const fallbackResult = await pool.query(fallbackQuery);
            const fallbackUsers = fallbackResult.rows.map(row => ({
                telegram_user_id: row.telegram_user_id
            }));
            
            logger.warn(`⚠️ Критический fallback: ${fallbackUsers.length} пользователей из заказов`);
            return fallbackUsers;
        } catch (fallbackError) {
            logger.error('❌ Критическая ошибка получения пользователей:', fallbackError.message);
            return [];
        }
    }
}

// Функция обработки callback query (нажатия на кнопки)
async function handleCallbackQuery(callbackQuery) {
    try {
        const { data, message, from } = callbackQuery;
        const parts = data.split('_');
        const action = parts[0];
        const orderId = parts[1];
        
        // Обработка специальных действий с дополнительными параметрами
        if (action === 'rating') {
            await handleRatingSubmission(callbackQuery, orderId, parts[2]);
            return;
        } else if (action === 'cancel' && parts[1] === 'rating') {
            await handleRatingCancel(callbackQuery, parts[2]);
            return;
        }
        
        logger.debug(`Обработка действия: ${action} для заказа ${orderId}`);
        
        let order = await getOrder(orderId);
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
            case 'complete':
                newStatus = 'completed';
                statusText = 'Доставлен';
                statusEmoji = '✅';
                break;
            case 'rate':
                // Обработка оценки заказа клиентом
                await handleOrderRating(callbackQuery, orderId);
                return;
            default:
                logger.error(`Неизвестное действие: ${action}`);
                return;
        }
        
        // Обновляем статус заказа в памяти
        order = updateOrderStatus(orderId, newStatus);
        
        // 🔥 ОБНОВЛЯЕМ СТАТУС В БАЗЕ ДАННЫХ
        try {
            await OrdersDB.update(orderId, { 
                status: newStatus
            });
            logger.info(`💾 Статус заказа ${orderId} обновлен в БД: ${newStatus}`);
        } catch (dbError) {
            logger.error(`❌ Ошибка обновления статуса в БД:`, dbError.message);
        }
        
        // Обновляем сообщение в админ-группе
        await updateOrderMessage(message.chat.id, message.message_id, order, newStatus);
        
        // 💰 ОБРАБОТКА ВОЗВРАТА СРЕДСТВ ПРИ ОТМЕНЕ
        if (newStatus === 'cancelled' && order.payment_id) {
            try {
                logger.info(`💸 Инициируем возврат средств для заказа ${orderId}, payment_id: ${order.payment_id}`);
                
                // Создаем возврат через ЮKassa API
                const refundData = {
                    amount: {
                        value: order.totals?.total?.toString() || '0',
                        currency: 'RUB'
                    },
                    payment_id: order.payment_id
                };
                
                const refundResponse = await axios.post('https://api.yookassa.ru/v3/refunds', refundData, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Idempotence-Key': crypto.randomUUID()
                    },
                    auth: {
                        username: config.YOOKASSA_SHOP_ID,
                        password: config.YOOKASSA_SECRET_KEY
                    },
                    timeout: 30000
                });
                
                logger.info(`✅ Возврат средств успешно создан: ${refundResponse.data.id}`);
                
                // Обновляем заказ с информацией о возврате
                await OrdersDB.update(orderId, { 
                    payment_status: 'refunded',
                    refund_id: refundResponse.data.id
                });
                
            } catch (refundError) {
                logger.error(`❌ Ошибка создания возврата средств:`, refundError.message);
                if (refundError.response) {
                    logger.error(`❌ Детали ошибки возврата:`, refundError.response.data);
                }
            }
        }
        
        // 📱 ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ КЛИЕНТУ
        logger.info(`📱 ПРОВЕРКА УВЕДОМЛЕНИЯ: telegramUserId=${order.telegramUserId}, token=${!!config.TELEGRAM_BOT_TOKEN}`);
        
        if (order.telegramUserId && config.TELEGRAM_BOT_TOKEN) {
            try {
                await sendClientNotification(order, newStatus, statusText, statusEmoji);
                logger.info(`✅ Уведомление клиенту отправлено для заказа ${orderId}`);
            } catch (error) {
                logger.error(`❌ Ошибка отправки уведомления клиенту:`, error.message);
                if (error.response) {
                    logger.error(`❌ Детали ошибки Telegram:`, error.response.data);
                }
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

// 🌟 ФУНКЦИЯ ОБРАБОТКИ ОЦЕНКИ ЗАКАЗА КЛИЕНТОМ
async function handleOrderRating(callbackQuery, orderId) {
    try {
        const { from } = callbackQuery;
        
        logger.info(`⭐ Клиент ${from.id} хочет оценить заказ ${orderId}`);
        
        // Создаем инлайн-клавиатуру с оценками
        const ratingKeyboard = {
            inline_keyboard: [
                [
                    { text: '⭐', callback_data: `rating_${orderId}_1` },
                    { text: '⭐⭐', callback_data: `rating_${orderId}_2` },
                    { text: '⭐⭐⭐', callback_data: `rating_${orderId}_3` }
                ],
                [
                    { text: '⭐⭐⭐⭐', callback_data: `rating_${orderId}_4` },
                    { text: '⭐⭐⭐⭐⭐', callback_data: `rating_${orderId}_5` }
                ],
                [
                    { text: '❌ Отмена', callback_data: `cancel_rating_${orderId}` }
                ]
            ]
        };
        
        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: from.id,
            text: `⭐ *Оцените заказ №${orderId}*\n\nКак вам понравилась доставка?\nВыберите количество звезд:`,
            parse_mode: 'Markdown',
            reply_markup: ratingKeyboard
        });
        
        // Отправляем подтверждение на исходную кнопку
        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackQuery.id,
            text: 'Пожалуйста, оцените заказ ⭐'
        });
        
    } catch (error) {
        logger.error('❌ Ошибка обработки запроса на оценку:', error.message);
        
        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackQuery.id,
            text: 'Ошибка при отправке формы оценки'
        });
    }
}

// 🌟 ФУНКЦИЯ ОБРАБОТКИ ОТПРАВКИ ОЦЕНКИ
async function handleRatingSubmission(callbackQuery, orderId, rating) {
    try {
        const { from } = callbackQuery;
        const ratingValue = parseInt(rating);
        
        if (isNaN(ratingValue) || ratingValue < 1 || ratingValue > 5) {
            throw new Error('Неверное значение оценки');
        }
        
        logger.info(`⭐ Получена оценка ${ratingValue} для заказа ${orderId} от клиента ${from.id}`);
        
        // Сохраняем оценку в БД (если есть таблица ratings)
        try {
            // Это можно добавить позже, когда будет таблица для оценок
            logger.info(`💾 Оценка ${ratingValue} для заказа ${orderId} сохранена`);
        } catch (dbError) {
            logger.error('❌ Ошибка сохранения оценки в БД:', dbError.message);
        }
        
        // Формируем ответное сообщение в зависимости от оценки
        let responseMessage = '';
        let responseEmoji = '';
        
        if (ratingValue >= 4) {
            responseEmoji = '🎉';
            responseMessage = `${responseEmoji} *Спасибо за отличную оценку!*\n\n` +
                `⭐ Вы поставили ${rating} звезд${ratingValue === 1 ? 'у' : ratingValue > 4 ? '' : 'ы'} заказу №${orderId}\n\n` +
                `🙏 Мы очень рады, что вам понравилось!\n` +
                `🛒 Будем ждать вас снова в Tundra Gourmet`;
        } else if (ratingValue === 3) {
            responseEmoji = '😊';
            responseMessage = `${responseEmoji} *Спасибо за оценку!*\n\n` +
                `⭐ Вы поставили ${rating} звезды заказу №${orderId}\n\n` +
                `🔧 Мы работаем над улучшением сервиса\n` +
                `🛒 Надеемся, в следующий раз все будет еще лучше!`;
        } else {
            responseEmoji = '😔';
            responseMessage = `${responseEmoji} *Спасибо за честную оценку*\n\n` +
                `⭐ Вы поставили ${rating} звезд${ratingValue === 1 ? 'у' : 'ы'} заказу №${orderId}\n\n` +
                `🙏 Нам очень жаль, что что-то пошло не так\n` +
                `📞 Если хотите рассказать подробнее - свяжитесь с поддержкой\n` +
                `🔧 Мы обязательно исправим недочеты`;
        }
        
        // Добавляем кнопки в зависимости от оценки
        let inlineKeyboard = null;
        if (ratingValue <= 2) {
            // Для низких оценок - кнопка поддержки
            inlineKeyboard = {
                inline_keyboard: [
                    [{ text: '💬 Связаться с поддержкой', url: 'https://t.me/tundrasupport' }],
                    [{ text: '🛒 Новый заказ', url: config.FRONTEND_URL }]
                ]
            };
        } else {
            // Для хороших оценок - кнопка нового заказа
            inlineKeyboard = {
                inline_keyboard: [
                    [{ text: '🛒 Сделать новый заказ', url: config.FRONTEND_URL }]
                ]
            };
        }
        
        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: from.id,
            text: responseMessage,
            parse_mode: 'Markdown',
            reply_markup: inlineKeyboard
        });
        
        // Отправляем уведомление в админ-группу о получении оценки
        if (config.TELEGRAM_ADMIN_CHAT_ID) {
            const adminMessage = `📊 *Новая оценка заказа*\n\n` +
                `📦 Заказ №${orderId}\n` +
                `⭐ Оценка: ${rating} из 5\n` +
                `👤 Клиент: ${from.first_name || 'Неизвестно'} ${from.last_name || ''}\n` +
                `🆔 ID: ${from.id}\n` +
                `⏰ Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`;
            
            try {
                await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: config.TELEGRAM_ADMIN_CHAT_ID,
                    text: adminMessage,
                    parse_mode: 'Markdown'
                });
            } catch (adminError) {
                logger.error('❌ Ошибка отправки уведомления об оценке в админ-группу:', adminError.message);
            }
        }
        
        // Отправляем подтверждение
        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackQuery.id,
            text: `Спасибо за оценку: ${rating} ⭐`
        });
        
    } catch (error) {
        logger.error('❌ Ошибка обработки оценки:', error.message);
        
        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackQuery.id,
            text: 'Ошибка при сохранении оценки'
        });
    }
}

// 🌟 ФУНКЦИЯ ОТМЕНЫ ОЦЕНКИ
async function handleRatingCancel(callbackQuery, orderId) {
    try {
        const { from } = callbackQuery;
        
        logger.info(`❌ Клиент ${from.id} отменил оценку заказа ${orderId}`);
        
        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: from.id,
            text: `❌ Оценка заказа №${orderId} отменена\n\nВы можете оценить заказ позже в любое время 😊`,
            parse_mode: 'Markdown'
        });
        
        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackQuery.id,
            text: 'Оценка отменена'
        });
        
    } catch (error) {
        logger.error('❌ Ошибка отмены оценки:', error.message);
        
        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callbackQuery.id,
            text: 'Ошибка при отмене'
        });
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
        const items = order.items || order.cartItems || [];
        const address = order.address || {};
        
        const message = `🆕 ЗАКАЗ #${order.id} - ${statusEmojis[newStatus]} ${statusTexts[newStatus]}

👤 ${order.customerName || 'Клиент'}
📍 ${address.street || 'Не указан'}, ${address.house || 'Не указан'}${address.apartment ? `, кв.${address.apartment}` : ''} (${order.deliveryZone === 'moscow' ? 'Москва' : 'МО'})
💰 ${order.totals?.total || 0}₽
📦 ${items.length} товаров

📋 Состав заказа:
${items.map(item => `• ${item.name} x${item.quantity} - ${item.price * item.quantity}₽`).join('\n')}

📱 Телефон: ${order.phone || 'Не указан'}
💬 Комментарий: ${order.comment || 'нет'}

[🟡 Принять] [🔵 Готовится] [🚚 Доставке] [✅ Доставлен]`;

        // Создаем обновленные кнопки в зависимости от статуса согласно ТЗ
        let inlineKeyboard;
        if (newStatus === 'new' || newStatus === 'paid') {
            // Для новых заказов показываем все кнопки
            inlineKeyboard = {
                inline_keyboard: [
                    [
                        { text: '🟡 Принят в работу', callback_data: `accept_${order.id}` },
                        { text: '🔵 Готовится', callback_data: `preparing_${order.id}` }
                    ],
                    [
                        { text: '🚚 В доставке', callback_data: `delivering_${order.id}` },
                        { text: '✅ Доставлен', callback_data: `completed_${order.id}` }
                    ]
                ]
            };
        } else if (newStatus === 'accepted') {
            // Для принятых заказов скрываем кнопку "Принят в работу"
            inlineKeyboard = {
                inline_keyboard: [
                    [
                        { text: '🔵 Готовится', callback_data: `preparing_${order.id}` },
                        { text: '🚚 В доставке', callback_data: `delivering_${order.id}` }
                    ],
                    [
                        { text: '✅ Доставлен', callback_data: `completed_${order.id}` }
                    ]
                ]
            };
        } else if (newStatus === 'preparing') {
            // Для готовящихся заказов скрываем кнопки "Принят" и "Готовится"
            inlineKeyboard = {
                inline_keyboard: [
                    [
                        { text: '🚚 В доставке', callback_data: `delivering_${order.id}` },
                        { text: '✅ Доставлен', callback_data: `completed_${order.id}` }
                    ]
                ]
            };
        } else if (newStatus === 'delivering') {
            // Для доставляемых заказов показываем только "Доставлен"
            inlineKeyboard = {
                inline_keyboard: [
                    [
                        { text: '✅ Доставлен', callback_data: `completed_${order.id}` }
                    ]
                ]
            };
        } else {
            // Для завершенных заказов убираем кнопки
            inlineKeyboard = { inline_keyboard: [] };
        }
        
        // Обновляем сообщение
        await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/editMessageText`, {
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
    console.log('🔍 requireAdminAuth: Проверка авторизации - MIDDLEWARE ВЫЗВАН!');
    console.log('🔍 requireAdminAuth: URL:', req.url);
    console.log('🔍 requireAdminAuth: Метод:', req.method);
    console.log('🔍 requireAdminAuth: Заголовки:', req.headers['x-admin-password']);
    console.log('🔍 requireAdminAuth: Query:', req.query.password);
    const providedPassword = req.headers['x-admin-password'] || req.query.password;
    const adminPassword = config.ADMIN_PASSWORD;
    
    if (providedPassword !== adminPassword) {
        console.log('❌ requireAdminAuth: Неверный пароль');
        return res.status(401).json({ 
            ok: false, 
            error: 'Unauthorized. Admin password required.' 
        });
    }
    
    console.log('✅ requireAdminAuth: Авторизация успешна');
    next();
}

// 🔧 MIDDLEWARE ДЛЯ ВАЛИДАЦИИ ДАННЫХ
// Функция validateOrderData ПЕРЕМЕЩЕНА ВЫШЕ - ПЕРЕД API МАРШРУТАМИ

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
        
        // ПРОСТОЕ РЕШЕНИЕ: Берем заказы напрямую из таблицы orders
        const orders = await OrdersDB.getByUserId(userId);
        
        // Фильтруем только оплаченные заказы
        const paidOrders = orders.filter(order => 
            order.payment_status === 'paid' || 
            order.status === 'completed' || 
            order.status === 'delivered' ||
            order.status === 'accepted' ||
            (order.payment_id && order.payment_id !== '')
        );
        
        // Преобразуем в формат для клиента
        const formattedOrders = paidOrders.map(order => ({
            order_id: order.order_id,
            amount: order.total_amount || order.totalAmount || 0,
            purchase_date: order.created_at || order.createdAt,
            items: order.items || [],
            status: order.status,
            payment_status: order.payment_status
        }));
        
        res.json({ ok: true, orders: formattedOrders });
    } catch (error) {
        logger.error('❌ Ошибка загрузки заказов пользователя:', error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ДУБЛИРУЮЩИЕ ENDPOINTS ПЕРЕМЕЩЕНЫ ВЫШЕ - ПЕРЕД SPA FALLBACK

// Дублирующийся endpoint удален - используется основной /api/orders/:orderId выше
// Дублирующийся API маршрут удален - используется основной выше

// Дублирующийся PUT маршрут удален - используется основной выше

// Переключение доступности товара
app.patch('/api/admin/products/:categoryId/:productId/toggle', requireAdminAuth, validateProductId, async (req, res) => {
    try {
        console.log('🔍 API: Переключение товара');
        console.log('🔍 API: Параметры:', req.params);
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

// SPA fallback - только для статических страниц (НЕ для API)
app.get('*', (req, res) => {
    // Исключаем API маршруты - они должны быть обработаны выше
    if (req.path.startsWith('/api/')) {
        console.log('🔍 SPA fallback: API запрос не должен попадать сюда:', req.path);
        return res.status(404).json({ 
            error: 'API endpoint не найден', 
            path: req.path,
            timestamp: new Date().toISOString()
        });
    }
    
    console.log('🔍 SPA fallback: Обрабатываем статический запрос:', req.path);
    res.sendFile(path.join(webRoot, 'index.html'));
});

// Запуск сервера с инициализацией БД
async function startServer() {
    try {
        console.log('🔄 Начинаем инициализацию сервера...');
        
        // Инициализируем базу данных
        console.log('🔄 Инициализируем базу данных...');
        await initializeDatabase();
        console.log('✅ База данных инициализирована');
        
        // Инициализируем счетчик заказов из БД
        await initializeOrderCounter();
        
        // Инициализируем ЮKassa
        await initializeYooKassa();
        
        // Проверяем, что checkout инициализирован
        if (!checkout) {
            throw new Error('❌ Не удалось инициализировать ЮKassa API');
        }
        logger.info('✅ ЮKassa API готов к работе');
        
        // 🔧 АВТОМАТИЧЕСКАЯ НАСТРОЙКА TELEGRAM WEBHOOK
        if (config.TELEGRAM_BOT_TOKEN) {
            try {
                const webhookUrl = 'https://tundra-miniapp-production.up.railway.app/api/telegram/webhook';
                logger.info('🔧 Настраиваем Telegram webhook...');
                
                const response = await axios.post(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/setWebhook`, {
                    url: webhookUrl
                });
                
                if (response.data.ok) {
                    logger.info('✅ Telegram webhook настроен успешно');
                } else {
                    logger.error('❌ Ошибка настройки webhook:', response.data);
                }
            } catch (error) {
                logger.error('❌ Ошибка настройки Telegram webhook:', error.message);
            }
        } else {
            logger.warn('⚠️ TELEGRAM_BOT_TOKEN не настроен - webhook не настроен');
        }
        
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
        
        // Запускаем сервер
        app.listen(PORT, async () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}`);
            console.log(`📁 Статические файлы из: ${webRoot}`);
            console.log(`🔗 Health check: http://localhost:${PORT}/health`);
            console.log(`🗄️ База данных подключена`);
            console.log(`🔐 Админ-панель: http://localhost:${PORT}/admin?password=TundraAdmin2024!`);
            
            // Проверяем настройки Telegram
            logger.info('🔍 Проверка настроек Telegram:');
            
            // ДЕТАЛЬНАЯ ДИАГНОСТИКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ
            logger.info('🔍 ДИАГНОСТИКА: Проверка переменных окружения:');
            logger.info(`   RAW process.env.TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? 'УСТАНОВЛЕН' : 'НЕ УСТАНОВЛЕН'}`);
            logger.info(`   RAW process.env.TELEGRAM_ADMIN_CHAT_ID: ${process.env.TELEGRAM_ADMIN_CHAT_ID || 'НЕ УСТАНОВЛЕН'}`);
            logger.info(`   RAW process.env.TELEGRAM_BROADCAST_CHAT_ID: ${process.env.TELEGRAM_BROADCAST_CHAT_ID || 'НЕ УСТАНОВЛЕН'}`);
            
            logger.info('🔍 Проверка config объекта:');
            logger.info(`   config.TELEGRAM_BOT_TOKEN: ${config.TELEGRAM_BOT_TOKEN ? 'УСТАНОВЛЕН' : 'НЕ УСТАНОВЛЕН'}`);
            logger.info(`   config.TELEGRAM_ADMIN_CHAT_ID: ${config.TELEGRAM_ADMIN_CHAT_ID || 'НЕ УСТАНОВЛЕН'}`);
            logger.info(`   config.TELEGRAM_BROADCAST_CHAT_ID: ${config.TELEGRAM_BROADCAST_CHAT_ID || 'НЕ УСТАНОВЛЕН'}`);
            
            logger.info('🔍 Итоговая проверка:');
            logger.info(`   Токен бота: ${config.TELEGRAM_BOT_TOKEN ? '✅ Настроен' : '❌ Не настроен'}`);
            logger.info(`   📋 Админ группа (заказы): ${config.TELEGRAM_ADMIN_CHAT_ID ? '✅ Настроен' : '❌ Не настроен'}`);
            logger.info(`   📢 Рассылочная группа: ${config.TELEGRAM_BROADCAST_CHAT_ID ? '✅ Настроен' : '❌ Не настроен'}`);
            
            if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_ADMIN_CHAT_ID && config.TELEGRAM_BROADCAST_CHAT_ID) {
                logger.info('✅ Telegram настроен полностью');
            } else {
                logger.warn('⚠️ Telegram не настроен полностью');
                logger.warn(`   📋 Заказы будут ${config.TELEGRAM_ADMIN_CHAT_ID ? 'отправляться' : 'НЕ отправляться'}`);
                logger.warn(`   📢 Рассылка будет ${config.TELEGRAM_BROADCAST_CHAT_ID ? 'работать' : 'НЕ работать'}`);
            }
        });
        
    } catch (error) {
        logger.error('❌ Ошибка запуска сервера:', error.message);
        process.exit(1);
    }
}

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

// Обработчики ошибок
process.on('uncaughtException', (error) => {
    console.error('💥 Неперехваченная ошибка:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Неперехваченное отклонение промиса:', reason);
});

// Запускаем сервер
startServer();

/*
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
        
        <div class="error-msg">❌ Неверный пароль</div>
        
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
*/

// Второй SPA fallback удален - дублирует первый

// 🛡️ ОБРАБОТКА НЕПЕРЕХВАЧЕННЫХ ОШИБОК
process.on('uncaughtException', (error) => {
    console.error('💥 Неперехваченная ошибка:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Неперехваченное отклонение промиса:', reason);
});

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
