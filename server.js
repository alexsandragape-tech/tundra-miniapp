console.log('🚀 СТАРТ СЕРВЕРА - НОВАЯ ВЕРСИЯ С ДИАГНОСТИКОЙ ЮKASSA!');
console.log('⏰ Время запуска:', new Date().toISOString());

require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
// Импорт ЮKassa
let YooCheckout;
try {
    console.log('🔧 Попытка импорта ЮKassa...');
    const yooModule = require('@a2seven/yoo-checkout');
    YooCheckout = yooModule.YooCheckout;
    console.log('✅ ЮKassa модуль импортирован успешно');
    console.log('📦 YooCheckout:', typeof YooCheckout);
} catch (error) {
    console.error('❌ Ошибка импорта ЮKassa:', error.message);
    console.error('❌ Stack:', error.stack);
    YooCheckout = null;
}
const config = require('./config');
const { initializeDatabase, OrdersDB, PurchaseHistoryDB, AdminProductsDB } = require('./database');

const app = express();
const PORT = config.PORT;
const TELEGRAM_BOT_TOKEN = config.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT_ID = config.TELEGRAM_ADMIN_CHAT_ID;

// 💳 ИНИЦИАЛИЗАЦИЯ YOOKASSA
console.log('🚀 ВЕРСИЯ 2.0 - ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ RAILWAY!');
console.log('⏰ Время сборки:', new Date().toISOString());
console.log('🔧 Инициализация ЮKassa...');
console.log('🔑 Shop ID:', config.YOOKASSA_SHOP_ID ? `${config.YOOKASSA_SHOP_ID.substring(0, 6)}***` : 'НЕ УСТАНОВЛЕН');
console.log('🔑 Secret Key:', config.YOOKASSA_SECRET_KEY ? `${config.YOOKASSA_SECRET_KEY.substring(0, 6)}***` : 'НЕ УСТАНОВЛЕН');
console.log('🔑 Shop ID полный:', config.YOOKASSA_SHOP_ID);
console.log('🔑 Secret Key полный:', config.YOOKASSA_SECRET_KEY);
console.log('🔑 Shop ID длина:', config.YOOKASSA_SHOP_ID?.length);
console.log('🔑 Secret Key длина:', config.YOOKASSA_SECRET_KEY?.length);

let checkout = null;
try {
    if (!YooCheckout) {
        throw new Error('YooCheckout класс не найден - пакет не установлен');
    }
    
    if (!config.YOOKASSA_SHOP_ID || !config.YOOKASSA_SECRET_KEY) {
        throw new Error('Не настроены ключи ЮKassa');
    }
    
    console.log('🔧 Создаем экземпляр YooCheckout...');
    checkout = new YooCheckout({
        shopId: config.YOOKASSA_SHOP_ID,
        secretKey: config.YOOKASSA_SECRET_KEY,
        timeout: 60000
    });
    
    console.log('✅ ЮKassa инициализирована успешно');
    console.log('📦 Версия пакета: @a2seven/yoo-checkout@1.3.0');
    console.log('🔑 Shop ID:', config.YOOKASSA_SHOP_ID);
    console.log('🔑 Secret Key:', config.YOOKASSA_SECRET_KEY ? `${config.YOOKASSA_SECRET_KEY.substring(0, 6)}***` : 'НЕ УСТАНОВЛЕН');
} catch (error) {
    console.error('❌ Ошибка инициализации ЮKassa:', error.message);
    console.log('⚠️ Приложение запустится без ЮKassa');
    console.log('🔧 Проверьте: 1) Установлен ли пакет 2) Настроены ли ключи');
}

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

// 💳 ФУНКЦИЯ СОЗДАНИЯ ПЛАТЕЖА В YOOKASSA
async function createYooKassaPayment(orderId, amount, description, customerInfo) {
    try {
        console.log('💳 Создаем платеж ЮKassa с параметрами:');
        console.log('   - Сумма:', amount.toFixed(2), 'RUB');
        console.log('   - Описание:', description);
        console.log('   - Клиент:', customerInfo.customerName);
        
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
            metadata: {
                orderId: orderId,
                customerName: customerInfo.customerName || 'Клиент',
                phone: customerInfo.phone || ''
            }
        };
        
        console.log('💳 Отправляем запрос в ЮKassa...');
        const payment = await checkout.createPayment(paymentData, crypto.randomUUID());

        console.log(`✅ Платеж создан в ЮKassa: ${payment.id} на сумму ${amount}₽`);
        console.log(`🔗 URL подтверждения: ${payment.confirmation?.confirmation_url}`);
        return payment;
    } catch (error) {
        console.error('❌ Ошибка создания платежа ЮKassa:');
        console.error('   - Сообщение:', error.message);
        console.error('   - Код:', error.code);
        console.error('   - Статус:', error.status);
        console.error('   - Детали:', error.response?.data);
        throw error;
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
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 минут
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
            paymentId: order.paymentId || null,
            paymentUrl: order.paymentUrl || null
        };
        
        await OrdersDB.create(dbOrder);
        console.log(`💾 Заказ ${orderId} сохранен в БД`);
    } catch (error) {
        console.error(`❌ Ошибка сохранения заказа ${orderId} в БД:`, error);
    }
    
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
    console.log('🔥 ПОЛУЧЕН ЗАПРОС НА СОЗДАНИЕ ЗАКАЗА!');
    try {
        const orderData = req.body;
        console.log('📦 Данные заказа:', JSON.stringify(orderData, null, 2));
        
        // Создаем заказ
        const order = await createOrder(orderData);
        console.log('✅ Заказ создан:', order.id);
        
        console.log(`📝 Заказ #${order.id} создан, создаем платеж в ЮKassa...`);
        console.log(`💰 Сумма заказа: ${order.totals?.total || 0}₽`);
        
        // 💳 СОЗДАЕМ ПЛАТЕЖ В YOOKASSA
        const totalAmount = order.totals?.total || 0;
        const description = `Заказ #${order.id} в Tundra Gourmet`;
        
        if (!config.YOOKASSA_SHOP_ID || !config.YOOKASSA_SECRET_KEY) {
            console.error('❌ ЮKassa ключи не настроены!');
            console.error('❌ Shop ID:', config.YOOKASSA_SHOP_ID);
            console.error('❌ Secret Key:', config.YOOKASSA_SECRET_KEY ? 'ЕСТЬ' : 'НЕТ');
            throw new Error('ЮKassa ключи не настроены');
        }
        
        console.log('💳 ЮKassa ключи проверены - создаем платеж...');
        
        if (!checkout) {
            console.error('❌ ЮKassa не инициализирована!');
            throw new Error('ЮKassa недоступна');
        }
        
        const customerInfo = {
            customerName: `${order.address?.street || ''} ${order.address?.house || ''}`.trim() || 'Клиент',
            phone: order.phone || ''
        };
        
        // Добавляем customerName в заказ
        order.customerName = customerInfo.customerName;
        
        const payment = await createYooKassaPayment(order.id, totalAmount, description, customerInfo);
        
        // Сохраняем ID платежа в заказе
        order.paymentId = payment.id;
        order.paymentUrl = payment.confirmation.confirmation_url;
        orders.set(order.id, order);
        
        // Обновляем в БД
        try {
            const updateData = {
                paymentId: order.paymentId,
                paymentUrl: order.paymentUrl,
                status: order.status
            };
            await OrdersDB.update(order.id, updateData);
        } catch (dbError) {
            console.error(`❌ Ошибка обновления заказа в БД:`, dbError);
        }
        
        console.log(`✅ Заказ #${order.id} и платеж созданы успешно`);
        console.log(`🔗 Payment URL: ${payment.confirmation.confirmation_url}`);
        
        // 🔥 НЕ ОТПРАВЛЯЕМ УВЕДОМЛЕНИЕ В АДМИН ГРУППУ
        // Уведомление будет отправлено только после успешной оплаты!
        
        const response = { 
            ok: true, 
            orderId: order.id,
            paymentUrl: payment.confirmation.confirmation_url,
            paymentId: payment.id,
            amount: totalAmount
        };
        
        console.log(`📤 Отправляем ответ клиенту:`, response);
        res.json(response);
    } catch (error) {
        console.error('❌ Ошибка обработки заказа:', error);
        console.error('❌ Детали ошибки:', error.stack);
        
        // Если ошибка ЮKassa, отправим заказ без платежа для тестирования
        if (error.message.includes('ЮKassa') || error.message.includes('shopId') || error.message.includes('secretKey') || error.message.includes('недоступна')) {
            console.log('⚠️ ЮKassa недоступна, отправляем заказ без платежа (ТЕСТОВЫЙ РЕЖИМ)');
            
            // Генерируем тестовую ссылку для демонстрации
            const fallbackOrderId = order?.id || 'test_1';
            const testPaymentUrl = `https://yookassa.ru/demo/checkout?orderId=${fallbackOrderId}&amount=${order?.totals?.total || 0}`;
            
            res.json({ 
                ok: true, 
                orderId: fallbackOrderId,
                paymentUrl: testPaymentUrl,
                paymentId: 'test_payment_' + fallbackOrderId,
                amount: order?.totals?.total || 0,
                isTestMode: true,
                message: 'ТЕСТОВЫЙ РЕЖИМ: ЮKassa не настроена'
            });
        } else {
            res.status(500).json({ ok: false, error: error.message });
        }
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
        console.error('❌ Ошибка получения истории покупок:', error);
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
        
        // 💾 СОХРАНЯЕМ В ИСТОРИЮ ПОКУПОК
        try {
            await PurchaseHistoryDB.create({
                orderId: order.id,
                userId: order.telegramUserId || order.userId || 'unknown',
                customerName: order.customerName,
                phone: order.phone,
                totalAmount: order.totals?.total || 0,
                itemsCount: order.cartItems?.length || 0,
                items: order.cartItems,
                paymentId: payment.id,
                purchaseDate: new Date(),
                deliveryZone: order.deliveryZone,
                address: order.address
            });
            console.log(`💾 Покупка сохранена в историю для заказа ${orderId}`);
        } catch (error) {
            console.error(`❌ Ошибка сохранения истории покупки ${orderId}:`, error);
        }
        
        // 🗄️ ОБНОВЛЯЕМ ЗАКАЗ В БД
        try {
            await OrdersDB.update(orderId, order);
            console.log(`💾 Заказ ${orderId} обновлен в БД`);
        } catch (error) {
            console.error(`❌ Ошибка обновления заказа ${orderId} в БД:`, error);
        }
        
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
        
        // 🔄 ИНИЦИАЛИЗАЦИЯ ТОЛЬКО ЕСЛИ БД ПОЛНОСТЬЮ ПУСТА (ПЕРВЫЙ ЗАПУСК)
        if (Object.keys(products).length === 0) {
            console.log('🔄 БД пуста, инициализируем полным ассортиментом товаров...');
            
            // Полный ассортимент товаров (все 49 товаров)
            const fullProducts = await loadFullProductCatalog();
            
            // Сохраняем в БД ТОЛЬКО ОДИН РАЗ
            try {
                await AdminProductsDB.saveAll(fullProducts);
                console.log('✅ Полный каталог товаров сохранен в БД ПЕРВЫЙ РАЗ');
                products = fullProducts;
                
                // Заполняем локальный кэш
                Object.entries(fullProducts).forEach(([categoryId, categoryProducts]) => {
                    adminProducts.set(categoryId, categoryProducts);
                });
            } catch (error) {
                console.error('❌ Ошибка сохранения полного каталога:', error);
                products = fullProducts; // Используем как fallback
            }
        } else {
            // ✅ ИСПОЛЬЗУЕМ СОХРАНЕННЫЕ ДАННЫЕ ИЗ БД (с изменениями пользователя)
            console.log('✅ Загружены сохраненные товары из БД с пользовательскими изменениями');
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
app.patch('/api/admin/products/:categoryId/:productId/toggle', requireAdminAuth, async (req, res) => {
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
        
        console.log(`🔧 Товар ${productId} ${product.available ? 'показан' : 'скрыт'} и сохранен в БД`);
        res.json({ ok: true, product, available: product.available });
        
    } catch (error) {
        console.error('❌ Ошибка переключения товара:', error);
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
            console.log('🚨 ПРИНУДИТЕЛЬНАЯ ОЧИСТКА БАЗЫ ДАННЫХ...');
            try {
                const { Pool } = require('pg');
                const pool = new Pool({ connectionString: config.DATABASE_URL });
                await pool.query('DELETE FROM admin_products');
                await pool.end();
                console.log('✅ Таблица admin_products очищена');
            } catch (error) {
                console.error('❌ Ошибка очистки БД:', error);
            }
        }
        
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

// 🛡️ ОБРАБОТКА НЕПЕРЕХВАЧЕННЫХ ОШИБОК
process.on('uncaughtException', (error) => {
    console.error('💥 Неперехваченная ошибка:', error);
    console.error('Stack:', error.stack);
    // НЕ завершаем процесс, логируем и продолжаем
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Неперехваченное отклонение промиса:', reason);
    console.error('Промис:', promise);
    // НЕ завершаем процесс, логируем и продолжаем
});

startServer();

// Keep-alive механизм для Railway
setInterval(() => {
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    console.log(`💓 Keep-alive ping: ${new Date().toISOString()}, Uptime: ${Math.floor(uptime)}s, Memory: ${Math.round(memory.heapUsed / 1024 / 1024)}MB`);
}, 5 * 60 * 1000); // Каждые 5 минут

// Graceful shutdown с очисткой ресурсов
process.on('SIGTERM', () => {
    console.log('🛑 Получен сигнал SIGTERM, завершаем работу...');
    cleanup();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Получен сигнал SIGINT, завершаем работу...');
    cleanup();
    process.exit(0);
});

// Функция очистки ресурсов
function cleanup() {
    console.log('🧹 Очистка ресурсов...');
    
    // Очищаем все таймеры заказов
    for (const [orderId, timer] of orderTimers.entries()) {
        clearTimeout(timer);
        console.log(`🗑️ Таймер заказа ${orderId} очищен`);
    }
    orderTimers.clear();
    
    console.log('✅ Ресурсы очищены');
}
