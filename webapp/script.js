// Telegram Web App MainButton and BackButton logic
let tg = window.Telegram?.WebApp;
let currentUserId = null; // ID текущего пользователя для истории покупок

// ⚙️ Удаляем случайные текстовые узлы вроде одиночной "M", если они появились до основного контента
document.addEventListener('DOMContentLoaded', () => {
    const strayTexts = ['M', 'М'];
    Array.from(document.body.childNodes).forEach(node => {
        if (node && node.nodeType === Node.TEXT_NODE && strayTexts.includes(node.textContent.trim())) {
            node.remove();
        }
    });
});

// 🔑 Функция получения ID пользователя
function getUserId() {
    if (currentUserId) return currentUserId;
    
    // Пытаемся получить из Telegram Web App
    if (window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
        currentUserId = window.Telegram.WebApp.initDataUnsafe.user.id.toString();
        // Синхронизируем локальный кэш, чтобы убрать случайные browser_* значения
        try {
            localStorage.setItem('tundra_user_id', currentUserId);
        } catch (_) {}
        return currentUserId;
    }
    
    // Fallback: создаем или берем из localStorage
    let userId = localStorage.getItem('tundra_user_id');
    if (!userId) {
        userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('tundra_user_id', userId);
    }
    currentUserId = userId;
    return currentUserId;
}

// Функция получения данных пользователя Telegram
function getTelegramUserData() {
    // Пытаемся получить данные из Telegram WebApp
    if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
        const user = window.Telegram.WebApp.initDataUnsafe.user;
        return {
            id: user.id.toString(),
            username: user.username || null,
            first_name: user.first_name || null,
            last_name: user.last_name || null,
            full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || null
        };
    }
    
    return null;
}

function updateMainButton(screenId) {
    if (!tg) return;

    tg.MainButton.hide();
    tg.BackButton.hide();

    switch (screenId) {
        case 'main-screen':
            // No MainButton on main screen
            break;
        case 'category-screen':
            tg.BackButton.show();
            break;
        case 'product-detail-screen':
            tg.BackButton.show();
            // MainButton for "Add to Cart" will be handled by the product detail screen itself
            break;
        case 'cart-screen':
            const cartItems = Object.values(cart).filter(item => item.quantity > 0);
            const { subtotal } = calculateCartTotal();
            const minOrderAmount = getMinOrderAmount();
            if (cartItems.length > 0 && subtotal >= minOrderAmount) {
                tg.MainButton.setText('Оформить заказ');
                tg.MainButton.show();
                tg.MainButton.onClick(proceedToOrder);
            }
            tg.BackButton.show();
            break;
        case 'order-form-screen':
            tg.MainButton.setText('Перейти к оплате');
            tg.MainButton.show();
            tg.MainButton.onClick(() => document.getElementById('orderForm').requestSubmit());
            tg.BackButton.show();
            break;
        case 'profile-screen':
        case 'my-orders-screen':
            tg.BackButton.show();
            break;
        case 'order-success-screen':
            // No MainButton on success screen
            break;
    }
}

// Override showScreen to update Telegram buttons
const originalShowScreen = window.showScreen;
window.showScreen = function(screenId) {
    if (typeof originalShowScreen === 'function') {
        originalShowScreen(screenId);
    }
    if (typeof updateMainButton === 'function') {
        updateMainButton(screenId);
    }
};

// Initial setup for Telegram buttons
document.addEventListener('DOMContentLoaded', () => {
    if (tg) {
        tg.ready();
        tg.expand();
        tg.onEvent('themeChanged', () => {
            document.body.style.backgroundColor = tg.themeParams.bg_color;
            document.body.style.color = tg.themeParams.text_color;
        });
        tg.BackButton.onClick(() => {
            const currentScreen = document.querySelector('.screen.active').id;
            if (currentScreen === 'category-screen') {
                showMain();
            } else if (currentScreen === 'product-detail-screen') {
                goBackFromProduct();
            } else if (currentScreen === 'cart-screen') {
                showMain();
            } else if (currentScreen === 'order-form-screen') {
                showCart();
            } else if (currentScreen === 'profile-screen') {
                showMain();
            } else if (currentScreen === 'my-orders-screen') {
                showProfile();
            }
        });
    }
    updateMainButton(document.querySelector('.screen.active').id);
});

// Базовый URL сервера (автоопределение)
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : window.location.origin;

// Глобальные переменные
let currentCategory = null;
let currentProduct = null;
let cart = JSON.parse(localStorage.getItem('tundra_cart') || '{}');
let userProfile = JSON.parse(localStorage.getItem('tundra_profile') || '{"totalSpent": 0, "completedOrders": 0}');
// Обратная совместимость: маппим completedOrders -> totalPurchases
if (userProfile && userProfile.completedOrders != null && userProfile.totalPurchases == null) {
    userProfile.totalPurchases = userProfile.completedOrders;
}
let orderCounter = parseInt(localStorage.getItem('tundra_order_counter') || '0');

// 🔥 ПЕРЕМЕННЫЕ ДЛЯ ТАЙМЕРА ОПЛАТЫ
let paymentTimer = null;
let paymentTimeLeft = 10 * 60; // 10 минут в секундах
let currentOrderId = null;

// 🧪 РЕЖИМ ТЕСТИРОВАНИЯ
const TEST_MODE = false; // Установите false для продакшена
const TEST_MIN_ORDER = 1; // Минимальная сумма для тестов
const PROD_MIN_ORDER = 3500; // Минимальная сумма для продакшена
const FORCE_DEMO_MODE = false; // Принудительный демо-режим (без реальных платежей)
let paymentStatusChecker = null;
let promoState = { enabled: false, code: '', validation: null };

function isProductPromoActive(product) {
    if (!product || !product.promo || product.promo.enabled !== true) return false;
    const basePrice = Number(product.price);
    const promoPrice = Number(product.promo.newPrice);
    return Number.isFinite(basePrice) && Number.isFinite(promoPrice) && promoPrice > 0 && promoPrice < basePrice;
}

function getProductActivePrice(product) {
    const basePrice = Number(product?.price) || 0;
    if (isProductPromoActive(product)) {
        const promoPrice = Number(product.promo.newPrice);
        return promoPrice;
    }
    return basePrice;
}

function formatPriceValue(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return value;
    return numeric.toLocaleString('ru-RU');
}

Object.keys(cart).forEach(key => {
    const item = cart[key];
    if (!item) {
        delete cart[key];
        return;
    }
    item.basePrice = Number(item.basePrice != null ? item.basePrice : item.price);
    item.price = Number(item.price);
    if (!Number.isFinite(item.price) || item.price <= 0) {
        item.price = item.basePrice;
    }
    item.promoApplied = Boolean(item.promoApplied && item.price < item.basePrice);
});

// Функция получения минимальной суммы заказа
function getMinOrderAmount() {
    return TEST_MODE ? TEST_MIN_ORDER : PROD_MIN_ORDER;
}

// Функция проверки тестового режима
function isTestMode() {
    return TEST_MODE;
}

// Функция проверки принудительного демо-режима
function isForceDemoMode() {
    return FORCE_DEMO_MODE;
}

// Функция для переключения демо-режима (для разработки)
function toggleDemoMode() {
    if (FORCE_DEMO_MODE) {
        showNotification('🎭 Демо-режим включен. Заказы будут автоматически оплачиваться без реальных платежей.', 'info');
    } else {
        showNotification('💳 Демо-режим отключен. Заказы будут создавать реальные платежи.', 'warning');
    }
}

// Функция показа индикатора тестового режима
function showTestModeIndicator() {
    // Создаем индикатор тестового режима
    const testIndicator = document.createElement('div');
    testIndicator.id = 'test-mode-indicator';
    testIndicator.innerHTML = `
        <div style="
            position: fixed;
            top: 10px;
            right: 10px;
            background: linear-gradient(135deg, #ff6b6b, #ff8e8e);
            color: white;
            padding: 8px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            z-index: 10000;
            box-shadow: 0 2px 10px rgba(255, 107, 107, 0.3);
            animation: pulse 2s infinite;
        ">
            ${FORCE_DEMO_MODE ? '🎭 ДЕМО-РЕЖИМ' : '🧪 ТЕСТОВЫЙ РЕЖИМ'}
        </div>
    `;
    
    // Добавляем стили для анимации
    const style = document.createElement('style');
    style.textContent = `
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(testIndicator);
    
    // Показываем уведомление о тестовом режиме
    setTimeout(() => {
        const message = FORCE_DEMO_MODE 
            ? '🧪 Включен тестовый режим. Минимальный заказ: 100₽. ДЕМО-РЕЖИМ: без реальных платежей!'
            : '🧪 Включен тестовый режим. Минимальный заказ: 100₽';
        showNotification(message, 'info');
    }, 1000);
}

// Данные категорий
const categories = [
    {
        id: 'kolbasy',
        name: 'Колбасы',
        desc: 'Сыровяленые деликатесы из оленины',
        icon: '🌭',
        imageUrl: 'images/categories/колбасы.jpg',
        count: 9
    },
    {
        id: 'pashtet',
        name: 'Паштеты',
        desc: 'Рийеты с трюфелем и грибами',
        icon: '🥫',
        imageUrl: 'images/categories/pashtet.jpg',
        count: 4
    },
    {
        id: 'delikatesy',
        name: 'Деликатесы',
        desc: 'Карпаччо, хамон, снеки премиум',
        icon: '🥩',
        imageUrl: 'images/categories/деликатесы.jpg',
        count: 6
    },
    {
        id: 'gotovye',
        name: 'Готовые деликатесы',
        desc: 'Запечённые корейки и окорок',
        icon: '🔥',
        imageUrl: 'images/categories/деликатесы готовые.jpg',
        count: 5
    },
    {
        id: 'polufabrikaty',
        name: 'Полуфабрикаты',
        desc: 'Мясо для приготовления и пельмени',
        icon: '🥓',
        imageUrl: 'images/categories/раздел полуфарикаты.jpg',
        count: 11
    },
    {
        id: 'pirogi-sytnye',
        name: 'Пироги сытные',
        desc: 'С олениной, грибами, трюфелем',
        icon: '🥧',
        imageUrl: 'images/categories/Пирог с грибами_small (1).jpg',
        count: 7
    },
    {
        id: 'pirogi-sladkie',
        name: 'Пироги сладкие',
        desc: 'С ягодами и творогом',
        icon: '🧁',
        imageUrl: 'images/categories/Пирог с грибами_1_small.jpg',
        count: 8
    },
    
    // 🆕 НОВЫЕ КАТЕГОРИИ (ПУСТЫЕ)
    {
        id: 'sousy-marinad',
        name: 'Соусы и маринады',
        desc: 'Авторские соусы и маринады',
        icon: '🍯',
        imageUrl: 'images/categories/sousy-placeholder.jpg',
        count: 0
    },
    {
        id: 'napitki',
        name: 'Напитки',
        desc: 'Натуральные соки и компоты',
        icon: '🧃',
        imageUrl: 'images/categories/napitki-placeholder.jpg',
        count: 0
    },
    {
        id: 'deserty',
        name: 'Десерты',
        desc: 'Сладкие деликатесы',
        icon: '🍰',
        imageUrl: 'images/categories/deserty-placeholder.jpg',
        count: 0
    },
    {
        id: 'konditerka',
        name: 'Кондитерские изделия',
        desc: 'Торты, пирожные, печенье',
        icon: '🎂',
        imageUrl: 'images/categories/konditerka-placeholder.jpg',
        count: 0
    }
];

// Данные товаров (будут загружены с сервера или используется fallback)
let products = {
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
                   storage: '180 суток'
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
                   storage: '180 суток'
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
                   storage: '180 суток'
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
            storage: '180 суток'
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
            storage: '180 суток'
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
            storage: '180 суток'
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
            storage: '180 суток'
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
            storage: '180 суток'
        },
        {
            id: 'test',
            name: 'Тест',
            price: 10,
            unit: '/шт.',
            maxQty: 100,
            image: '🧪',
            imageUrl: 'images/products/kolbasy/test.jpg',
            composition: 'тестовый товар для проверки',
            nutrition: 'тест',
            calories: '10 ккал',
            storage: '1 день'
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
            imageUrl: 'images/products/pashtet/riyet-olene-griby1200.jpg',
            composition: 'мясо северного оленя, грибы белые, трюфель черный 0,02%, жир олений, лук репчатый',
            nutrition: 'белки - 17,8 г, жиры - 19,8 г, углеводы - 2,6 г',
            calories: '259,8 ккал/1087 кДж',
            storage: '90 суток'
        },
        {
            id: 'riyet-serdtse',
            name: 'Рийет из сердца оленя с шампиньонами, ягодами, можжевельника и розмарином',
            price: 360,
            unit: '/85 гр.',
            maxQty: 15,
            image: '🥫',
            imageUrl: 'images/products/pashtet/riyet-serdtse1200.jpg',
            composition: 'мясо северного оленя, морковь, лук, вино белое сухое, соль морская, масло растительное, масло сливочное, соль, ягоды можжевельника, перец',
            nutrition: 'белки - 12 г, жиры - 10 г, углеводы - 9 г',
            calories: '182 ккал/762 кДж',
            storage: '90 суток'
        },
        {
            id: 'riyet-utka',
            name: 'Рийет из полярной утки с трюфелем',
            price: 378,
            unit: '/85 гр.',
            maxQty: 15,
            image: '🥫',
            imageUrl: 'images/products/pashtet/riyet-utka1200.jpg',
            composition: 'мясо утки, белые грибы, вино белое сухое, утиный жир, трюфель черный 0,02%, лук, соль морская, специи',
            nutrition: 'белки - 13,3 г, жиры - 45,9 г, углеводы - 2,3 г',
            calories: '496 ккал/2077 кДж',
            storage: '90 суток'
        },
        {
            id: 'riyet-yagnenok',
            name: 'Рийет из ягненка',
            price: 365,
            unit: '/85 гр.',
            maxQty: 15,
            image: '🥫',
            imageUrl: 'images/products/pashtet/riyet-yagnenok1200.jpg',
            composition: 'мясо ягненка, масло растительное, лук, соль морская, специи',
            nutrition: 'белки - 15,7 г, жиры - 15,4 г, углеводы - 5,5 г',
            calories: '223,4 ккал/935 кДж',
            storage: '90 суток'
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
            storage: '180 суток'
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
            storage: '180 суток'
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
            storage: '180 суток'
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
            storage: '180 суток'
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
            storage: '180 суток'
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
            storage: '180 суток'
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
            storage: '20 суток'
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
            storage: '20 суток'
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
            storage: '20 суток'
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
            storage: '20 суток'
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
            storage: '20 суток'
        }
    ],
    'polufabrikaty': [
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
            storage: '10 месяцев'
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
            storage: '10 месяцев'
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
            storage: '10 месяцев'
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
            storage: '10 месяцев'
        },
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
            storage: '10 месяцев'
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
            storage: '10 месяцев'
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
            storage: '10 месяцев'
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
            storage: '12 месяцев'
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
            storage: '12 месяцев'
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
            storage: '10 месяцев'
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
            storage: '10 месяцев'
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
            storage: '6 месяцев'
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
            storage: '6 месяцев'
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
            storage: '6 месяцев'
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
            storage: '6 месяцев'
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
            storage: '6 месяцев'
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
            storage: '6 месяцев'
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
            storage: '6 месяцев'
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
            storage: '6 месяцев'
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
            storage: '6 месяцев'
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
            storage: '6 месяцев'
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
            storage: '6 месяцев'
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
            storage: '6 месяцев'
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
            storage: '6 месяцев'
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
            storage: '6 месяцев'
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
            storage: '6 месяцев'
        }
    ],
    
    // 🆕 НОВЫЕ КАТЕГОРИИ (ПУСТЫЕ МАССИВЫ)
    'sousy-marinad': [],
    'napitki': [],
    'deserty': [],
    'konditerka': []
};

// Глобальная карта актуальных названий категорий из БД
const categoryNameMap = new Map();

// 🔄 ЗАГРУЗКА КАТЕГОРИЙ С СЕРВЕРА
async function loadCategoriesFromServer() {
    try {
        const url = `/api/categories/visible?_=${Date.now()}`; // cache-busting
        console.log('ЗАГРУЖАЕМ КАТЕГОРИИ: запрос к', url);
        const response = await fetch(url, { cache: 'no-store' });
        
        console.log('ОТВЕТ СЕРВЕРА: статус', response.status, response.statusText);
        
        if (response.ok) {
            const result = await response.json();
            console.log('ДАННЫЕ СЕРВЕРА:', JSON.stringify(result, null, 2));
            
            if (result.ok && result.categories && result.categories.length > 0) {
                // Создаем карту данных категорий из БД (с актуальными названиями)
                const dbCategoriesMap = new Map();
                result.categories.forEach(cat => {
                    dbCategoriesMap.set(cat.category_id, {
                        id: cat.category_id,
                        name: cat.name, // ИСПОЛЬЗУЕМ НАЗВАНИЕ ИЗ БД
                        imageUrl: categories.find(c => c.id === cat.category_id)?.imageUrl || ''
                    });
                    // Запоминаем актуальное имя в глобальную карту
                    categoryNameMap.set(cat.category_id, cat.name);
                });

                // Обновляем глобальный массив categories именами из БД (чтобы везде были актуальные названия)
                console.log('ОБНОВЛЯЕМ ЛОКАЛЬНЫЕ НАЗВАНИЯ:');
                for (let i = 0; i < categories.length; i++) {
                    const dbName = categoryNameMap.get(categories[i].id);
                    if (dbName && dbName !== categories[i].name) {
                        console.log(`${categories[i].id}: "${categories[i].name}" -> "${dbName}"`);
                        categories[i].name = dbName;
                    }
                }
                console.log('ФИНАЛЬНЫЕ ЛОКАЛЬНЫЕ НАЗВАНИЯ:', categories.map(c => `${c.id}: ${c.name}`));
                
                console.log('КАТЕГОРИИ ИЗ БД:', Array.from(dbCategoriesMap.values()).map(c => `${c.id} - ${c.name}`));
                
                // Возвращаем категории с названиями из БД
                const resultCategories = Array.from(dbCategoriesMap.values());
                
                console.log('ИТОГОВЫЕ КАТЕГОРИИ:', resultCategories.map(c => `${c.id} - ${c.name}`));
                console.log('КОЛИЧЕСТВО:', resultCategories.length);
                
                return resultCategories;
            } else {
                console.log('НЕКОРРЕКТНЫЕ ДАННЫЕ С СЕРВЕРА - используем все локальные');
            }
        } else {
            console.log('ОШИБКА ОТВЕТА СЕРВЕРА - используем все локальные');
        }
        
        console.log('FALLBACK: используем все локальные категории');
        return categories; // Fallback к локальным категориям
    } catch (error) {
        console.error('ОШИБКА ЗАГРУЗКИ КАТЕГОРИЙ:', error);
        return categories; // Fallback к локальным категориям
    }
}

// 🔄 ЗАГРУЗКА ТОВАРОВ С СЕРВЕРА
async function loadProductsFromServer() {
    try {
        const response = await fetch(`${API_BASE}/api/products`);
        
        if (response.ok) {
            const result = await response.json();
            
            if (result.ok && result.products) {
                // Обновляем товары, если получили с сервера
                const serverProducts = result.products;
                
                // Проверяем, есть ли товары с сервера
                const hasServerProducts = Object.keys(serverProducts).some(
                    categoryId => serverProducts[categoryId] && serverProducts[categoryId].length > 0
                );
                
                if (hasServerProducts) {
                    products = serverProducts;
                    updateCategoryCounts();
                    return true;
                }
            }
        }
        
        return false;
    } catch (error) {
        console.error('❌ Ошибка загрузки товаров с сервера:', error);
        return false;
    }
}

// Обновление счетчиков категорий после загрузки товаров
function updateCategoryCounts() {
    categories.forEach(category => {
        const categoryProducts = products[category.id] || [];
        category.count = categoryProducts.length;
    });
}

// Функции навигации
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
    
    // Останавливаем автообновление заказов при уходе с экрана
    if (screenId !== 'my-orders-screen' && window.ordersUpdateInterval) {
        clearInterval(window.ordersUpdateInterval);
        window.ordersUpdateInterval = null;
        console.log('🛑 CLIENT: Остановлено автообновление заказов');
    }
    
    // Обновляем Telegram кнопки
    if (typeof updateMainButton === 'function') {
        updateMainButton(screenId);
    }
}

function showMain() {
    showScreen('main-screen');
    updateWorkStatus();
}

async function showCategory(categoryId) {
    currentCategory = categoryId;

    // Обеспечиваем наличие категории в списке и корректное название
    const category = categories.find(c => c.id === categoryId) || { id: categoryId, name: categoryNameMap.get(categoryId) || categoryId };
    const resolvedName = categoryNameMap.get(categoryId) || category.name || categoryId;
    document.getElementById('category-title').textContent = resolvedName;
    
    const productsList = document.getElementById('products-list');
    productsList.innerHTML = '';

    // Если для категории нет товаров в памяти — пробуем догрузить с сервера
    if (!Array.isArray(products[categoryId])) {
        console.log('Товары категории отсутствуют в кэше, пробуем загрузить с сервера:', categoryId);
        await loadProductsFromServer();
    }

    const categoryProducts = Array.isArray(products[categoryId]) ? products[categoryId] : [];

    if (categoryProducts.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.style.cssText = 'padding: 24px; color: #666; text-align: center;';
        emptyEl.textContent = 'В этой категории пока нет товаров';
        productsList.appendChild(emptyEl);
        showScreen('category-screen');
        updateCartBadge();
        return;
    }
    
    categoryProducts.forEach(product => {
        console.log('Loading product:', product.name, 'with imageUrl:', product.imageUrl);
        const productCard = document.createElement('div');
        productCard.className = 'product-card';
        productCard.onclick = () => showProductDetail(categoryId, product.id);
        
        // Определяем, что отображать: изображение или эмодзи
        let imageContent = '';
        let emojiContent = '';
        
        if (product.imageUrl) {
            console.log('Product has imageUrl:', product.imageUrl);
            console.log('Full image path:', window.location.origin + '/' + product.imageUrl);
            imageContent = `<img src="${product.imageUrl}" alt="${product.name}" class="product-image-img" onload="console.log('Image loaded successfully:', '${product.imageUrl}')" onerror="console.error('Image failed to load:', '${product.imageUrl}'); this.style.display='none'; this.nextElementSibling.style.display='flex';">`;
            emojiContent = `<div class="product-image-emoji" style="display: none;">${product.image}</div>`;
        } else {
            console.log('Product has no imageUrl, using emoji:', product.image);
            imageContent = '';
            emojiContent = `<div class="product-image-emoji">${product.image}</div>`;
        }
        const promoActive = isProductPromoActive(product);
        const promoBadge = promoActive ? '<div class="product-badge">Акция</div>' : '';
        const activePrice = getProductActivePrice(product);
        const unitText = product.unit ? String(product.unit) : '';
        const priceLabel = `${formatPriceValue(activePrice)}₽${unitText}`;
        const priceHtml = promoActive
            ? `<div class="product-price">
                    <span class="price-new">${formatPriceValue(activePrice)}₽${unitText}</span>
                    <span class="price-old">${formatPriceValue(product.price)}₽${unitText}</span>
               </div>`
            : `<div class="product-price"><span class="price-new">${formatPriceValue(product.price)}₽${unitText}</span></div>`;
        
        // Получаем текущее количество товара в корзине
        const cartKey = `${categoryId}_${product.id}`;
        const currentQty = cart[cartKey] ? cart[cartKey].quantity : 0;
        
        productCard.innerHTML = `
            <div class="product-image">
                ${imageContent}
                ${emojiContent}
                ${promoBadge}
            </div>
            <div class="product-name">${product.name}</div>
            <div class="product-footer">
            <div class="product-actions">
                    <div class="price-control ${currentQty > 0 ? 'has-qty' : 'pc-empty'}" id="pc-${cartKey}" data-price="${priceLabel}" data-category="${categoryId}" data-product="${product.id}">
                        <button class="pc-btn pc-minus" onclick="event.stopPropagation(); changeProductQuantity('${categoryId}', '${product.id}', -1)">-</button>
                        <span class="pc-price">${priceLabel}</span>
                        <div class="pc-qty">${currentQty > 0 ? currentQty : ''}</div>
                        <button class="pc-btn pc-plus" onclick="event.stopPropagation(); changeProductQuantity('${categoryId}', '${product.id}', 1)">+</button>
                </div>
                </div>
            </div>
        `;
        
        productsList.appendChild(productCard);
    });
    
    showScreen('category-screen');
    updateCartBadge(); // Обновляем счетчик корзины
}

// Функция изменения количества товара на карточке
function changeProductQuantity(categoryId, productId, delta) {
    const cartKey = `${categoryId}_${productId}`;
    const product = products[categoryId].find(p => p.id === productId);
    
    if (!cart[cartKey]) {
        cart[cartKey] = { ...product, quantity: 0, categoryId, productId };
    }
    cart[cartKey].price = getProductActivePrice(product);
    cart[cartKey].basePrice = Number(product.price);
    cart[cartKey].promoApplied = isProductPromoActive(product);
    
    const newQty = Math.max(0, Math.min(product.maxQty, cart[cartKey].quantity + delta));
    
    if (newQty === 0) {
        delete cart[cartKey];
    } else {
        cart[cartKey].quantity = newQty;
    }
    
    renderPriceControl(cartKey, newQty);
    updateCartBadge();
    localStorage.setItem('tundra_cart', JSON.stringify(cart));
}

// Обновляем контрол цены/количества на карточке
function renderPriceControl(cartKey, qty) {
    const el = document.getElementById(`pc-${cartKey}`);
    if (!el) return;
    const price = el.dataset.price || '';
    const categoryId = el.dataset.category;
    const productId = el.dataset.product;
    
    if (qty > 0) {
        el.classList.add('has-qty');
        el.classList.remove('pc-empty');
        el.querySelector('.pc-qty').textContent = qty;
    } else {
        el.classList.remove('has-qty');
        el.classList.add('pc-empty');
        el.querySelector('.pc-qty').textContent = '';
    }
}

function parseMacroValue(text, pattern) {
    if (!text) return null;
    const match = text.match(pattern);
    return match ? match[1].replace(',', '.') : null;
}

function getDetailWeight(unit) {
    if (!unit) return '';
    const match = unit.match(/(\d+(?:[.,]\d+)?)\s*(г|гр)/i);
    if (!match) return '';
    return `${match[1].replace(',', '.')} г`;
}

function getDetailNutrition(product) {
    const nutritionText = product?.nutrition || '';
    const caloriesText = product?.calories || '';
    const kcal = parseMacroValue(caloriesText, /(\d+(?:[.,]\d+)?)\s*ккал/i);
    const protein = parseMacroValue(nutritionText, /белк[аи]?\s*[-–]?\s*(\d+(?:[.,]\d+)?)/i);
    const fat = parseMacroValue(nutritionText, /жир[ыа]?\s*[-–]?\s*(\d+(?:[.,]\d+)?)/i);
    const carbs = parseMacroValue(nutritionText, /углевод[ыа]?\s*[-–]?\s*(\d+(?:[.,]\d+)?)/i);
    return {
        kcal: kcal || '—',
        protein: protein || '—',
        fat: fat || '—',
        carbs: carbs || '—'
    };
}

function closeProductDetail() {
    if (currentProduct?.categoryId) {
        showCategory(currentProduct.categoryId);
    } else {
        showMain();
    }
}

function showProductDetail(categoryId, productId) {
    currentProduct = { categoryId, productId };
    const product = products[categoryId].find(p => p.id === productId);
    
    // Определяем, что отображать: изображение или эмодзи
    let detailImageContent = '';
    let detailEmojiContent = '';
    
    if (product.imageUrl) {
        detailImageContent = `<img src="${product.imageUrl}" alt="${product.name}" class="detail-image-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'; console.log('Detail image failed to load:', product.imageUrl);">`;
        detailEmojiContent = `<div class="detail-image-emoji" style="display: none;">${product.image}</div>`;
    } else {
        detailImageContent = '';
        detailEmojiContent = `<div class="detail-image-emoji">${product.image}</div>`;
    }
    const promoActive = isProductPromoActive(product);
    const detailPriceHtml = promoActive
        ? `<div class="detail-price">
                <span class="price-new">${formatPriceValue(getProductActivePrice(product))}₽${product.unit}</span>
                <span class="price-old">${formatPriceValue(product.price)}₽${product.unit}</span>
           </div>`
        : `<div class="detail-price">${formatPriceValue(product.price)}₽${product.unit}</div>`;
    const detailBadge = promoActive ? '<div class="detail-badge">Акция</div>' : '';
    const detailWeight = getDetailWeight(product.unit);
    const nutrition = getDetailNutrition(product);
    const bottomPriceHtml = promoActive
        ? `<div class="detail-bottom-price">
                <div class="current">${formatPriceValue(getProductActivePrice(product))}₽</div>
                <div class="old">${formatPriceValue(product.price)}₽</div>
           </div>`
        : `<div class="detail-bottom-price">
                <div class="current">${formatPriceValue(getProductActivePrice(product))}₽</div>
           </div>`;
    
    document.getElementById('product-detail').innerHTML = `
        <div class="detail-image">
            ${detailImageContent}
            ${detailEmojiContent}
            <button class="detail-close-btn" onclick="closeProductDetail()" aria-label="Закрыть">×</button>
        </div>
        <div class="detail-scroll">
            <div class="detail-name">
                ${product.name}${detailWeight ? ` <span class="detail-weight">${detailWeight}</span>` : ''}
            </div>
            ${detailBadge}

            <div class="detail-divider"></div>
            <div class="detail-nutrition">
                <div class="detail-nutrition-title">На 100 г</div>
                <div class="detail-nutrition-grid">
                    <div class="detail-nutrition-item">
                        <div class="value">${nutrition.kcal}</div>
                        <div class="label">ккал</div>
                    </div>
                    <div class="detail-nutrition-item">
                        <div class="value">${nutrition.protein}</div>
                        <div class="label">белки</div>
                    </div>
                    <div class="detail-nutrition-item">
                        <div class="value">${nutrition.fat}</div>
                        <div class="label">жиры</div>
                    </div>
                    <div class="detail-nutrition-item">
                        <div class="value">${nutrition.carbs}</div>
                        <div class="label">углеводы</div>
                    </div>
                </div>
            </div>

            <div class="detail-divider"></div>
            <div class="detail-info">
                <h4>Состав:</h4>
                <p>${product.composition}</p>
            </div>

            <div class="detail-divider"></div>
            <div class="detail-info">
                <h4>Условия хранения:</h4>
                <p>${product.storage}</p>
            </div>
        </div>

        <div class="detail-bottom-bar">
            ${bottomPriceHtml}
            <div class="product-actions">
                <div class="quantity-selector" id="detail-qty-selector" style="display: none;">
                    <button class="qty-btn" onclick="changeDetailQuantity(-1)" id="qty-minus">-</button>
                    <div class="qty-display" id="detail-quantity">1</div>
                    <button class="qty-btn" onclick="changeDetailQuantity(1)" id="qty-plus">+</button>
                </div>
                <button class="add-to-cart-btn" id="detail-add-btn" onclick="addFromDetail()">
                    В корзину
                </button>
            </div>
        </div>
    `;

    // Проверяем, есть ли товар в корзине
    const cartKey = `${categoryId}_${productId}`;
    const currentQty = cart[cartKey] ? cart[cartKey].quantity : 0;
    
    if (currentQty > 0) {
        // Товар уже в корзине - показываем счетчик
        document.getElementById('detail-qty-selector').style.display = 'flex';
        document.getElementById('detail-add-btn').style.display = 'none';
        document.getElementById('detail-quantity').textContent = currentQty;
    } else {
        // Товара нет в корзине - показываем кнопку
        document.getElementById('detail-qty-selector').style.display = 'none';
        document.getElementById('detail-add-btn').style.display = 'block';
        document.getElementById('detail-quantity').textContent = 1;
    }

    showScreen('product-detail-screen');
}

// Функция изменения количества в детальной карточке
function changeDetailQuantity(delta) {
    const cartKey = `${currentProduct.categoryId}_${currentProduct.productId}`;
    const product = products[currentProduct.categoryId].find(p => p.id === currentProduct.productId);
    
    if (!cart[cartKey]) {
        cart[cartKey] = { ...product, quantity: 0, categoryId: currentProduct.categoryId, productId: currentProduct.productId };
    }
    cart[cartKey].price = getProductActivePrice(product);
    cart[cartKey].basePrice = Number(product.price);
    cart[cartKey].promoApplied = isProductPromoActive(product);
    
    const newQty = Math.max(0, Math.min(product.maxQty, cart[cartKey].quantity + delta));
    
    if (newQty === 0) {
        // Удаляем товар из корзины
        delete cart[cartKey];
        
        // Скрываем счетчик, показываем кнопку
        document.getElementById('detail-qty-selector').style.display = 'none';
        document.getElementById('detail-add-btn').style.display = 'block';
        document.getElementById('detail-quantity').textContent = 1;
    } else {
        // Обновляем количество
        cart[cartKey].quantity = newQty;
        document.getElementById('detail-quantity').textContent = newQty;
        
        // Показываем счетчик, скрываем кнопку
        document.getElementById('detail-qty-selector').style.display = 'flex';
        document.getElementById('detail-add-btn').style.display = 'none';
    }
    
    updateCartBadge();
    localStorage.setItem('tundra_cart', JSON.stringify(cart));
}

// Функция добавления из детальной карточки
function addFromDetail() {
    const qty = parseInt(document.getElementById('detail-quantity').textContent);
    addToCart(currentProduct.categoryId, currentProduct.productId, qty);
    
    // Переключаем интерфейс на счетчик
    document.getElementById('detail-qty-selector').style.display = 'flex';
    document.getElementById('detail-add-btn').style.display = 'none';
    
    // Обновляем отображение количества
    const cartKey = `${currentProduct.categoryId}_${currentProduct.productId}`;
    const currentQty = cart[cartKey] ? cart[cartKey].quantity : qty;
    document.getElementById('detail-quantity').textContent = currentQty;
}

// Функция возврата из детальной карточки
function goBackFromProduct() {
    if (currentCategory) {
        showCategory(currentCategory);
    } else {
        showMain();
    }
}

// Функция добавления товара в корзину
function addToCart(categoryId, productId, quantity) {
    if (!isWorkingHours()) {
        showNotification('К сожалению, сейчас мы не работаем. Заказы принимаются ежедневно с 10:00 до 21:00', 'warning');
        return;
    }

    const cartKey = `${categoryId}_${productId}`;
    const product = products[categoryId].find(p => p.id === productId);

    if (!cart[cartKey]) {
        cart[cartKey] = {
            categoryId,
            productId,
            name: product.name,
            price: getProductActivePrice(product),
            basePrice: Number(product.price),
            promoApplied: isProductPromoActive(product),
            unit: product.unit,
            image: product.image,
            imageUrl: product.imageUrl,
            maxQty: product.maxQty,
            quantity: 0
        };
    }
    cart[cartKey].price = getProductActivePrice(product);
    cart[cartKey].basePrice = Number(product.price);
    cart[cartKey].promoApplied = isProductPromoActive(product);
    cart[cartKey].unit = product.unit;

    const newQuantity = cart[cartKey].quantity + quantity;
    if (newQuantity > product.maxQty) {
        showNotification(`Максимальное количество: ${product.maxQty} шт.`, 'warning');
        return;
    }

    cart[cartKey].quantity = newQuantity;
    localStorage.setItem('tundra_cart', JSON.stringify(cart));
    updateCartBadge();
    
    renderPriceControl(cartKey, newQuantity);
}

// Функция обновления счетчика корзины
function updateCartBadge() {
    const totalItems = Object.values(cart).reduce((sum, item) => sum + item.quantity, 0);
    
    // Обновляем главный счетчик
    const mainCartBadge = document.getElementById('cart-badge');
    if (mainCartBadge) mainCartBadge.textContent = totalItems;
    
    // Обновляем счетчик на экране категории
    const categoryCartBadge = document.getElementById('category-cart-badge');
    if (categoryCartBadge) categoryCartBadge.textContent = totalItems;
}

// Функция показа корзины
function showCart() {
    // Переключаемся на экран корзины перед рендером содержимого
    if (typeof showScreen === 'function') {
        showScreen('cart-screen');
    }

    const cartContent = document.getElementById('cart-content');
    const cartItems = Object.values(cart).filter(item => item.quantity > 0);

    if (cartItems.length === 0) {
        promoState = { enabled: false, code: '', validation: null };
        cartContent.innerHTML = `
            <div class="empty-cart">
                <!-- Иконка скрыта по просьбе пользователя -->
                <div class="empty-cart-title">Корзина пуста</div>
                <div class="empty-cart-desc">Добавьте товары из каталога</div>
                <button class="go-shopping-btn" onclick="showMain()">
                    Перейти к покупкам
                </button>
            </div>
        `;
        return;
    }

    let cartHTML = '<div style="padding: 20px;">';

    cartItems.forEach(item => {
        let cartImageContent = '';

        if (item.imageUrl) {
            cartImageContent = `<img src="${item.imageUrl}" alt="${item.name}" class="cart-item-image-img" onerror="this.style.display='none';">`;
        }
        const itemPriceHtml = item.promoApplied
            ? `<div class="cart-item-price">
                    <span class="price-new">${formatPriceValue(item.price)}₽${item.unit}</span>
                    <span class="price-old">${formatPriceValue(item.basePrice)}₽${item.unit}</span>
               </div>`
            : `<div class="cart-item-price">${formatPriceValue(item.price)}₽${item.unit}</div>`;
        const itemPromoBadge = item.promoApplied ? '<div class="cart-item-badge">Акция</div>' : '';
        
        cartHTML += `
            <div class="cart-item">
                <div class="cart-item-header">
                    <div class="cart-item-image">
                        ${cartImageContent}
                    </div>
                    <div class="cart-item-info">
                        <div class="cart-item-name">${item.name}</div>
                        ${itemPriceHtml}
                        ${itemPromoBadge}
                    </div>
                </div>
                <div class="cart-item-controls">
                    <div class="cart-qty-controls">
                        <button class="cart-qty-btn" onclick="changeCartQuantity('${item.categoryId}_${item.productId}', -1)">-</button>
                        <span class="qty-display">${item.quantity}</span>
                        <button class="cart-qty-btn" onclick="changeCartQuantity('${item.categoryId}_${item.productId}', 1)">+</button>
                    </div>
                    <div class="cart-item-total">${formatPriceValue(item.price * item.quantity)}₽</div>
                </div>
            </div>
        `;
    });

    const totals = calculateCartTotal();
    const {
        rawSubtotal,
        loyaltyDiscount,
        loyaltyPercent,
        promoDiscount,
        promoFreeDelivery,
        appliedPromoCode,
        subtotal,
        delivery,
        total
    } = totals;
    const hasPromoDiscount = promoDiscount > 0;
    const hasPromo = promoState.enabled && (hasPromoDiscount || promoFreeDelivery);
    
    cartHTML += `
        <div class="cart-summary">
            <div class="summary-row">
                <span>Товары:</span>
                <span>${formatPriceValue(rawSubtotal)}₽</span>
            </div>`;
    
    // Показываем скидку лояльности если она есть
    if (loyaltyDiscount > 0) {
        cartHTML += `
            <div class="summary-row loyalty-discount">
                <span>🔥 Скидка лояльности (${loyaltyPercent}%):</span>
                <span>-${formatPriceValue(loyaltyDiscount)}₽</span>
            </div>`;
    }
    if (hasPromoDiscount) {
        cartHTML += `
            <div class="summary-row promo-discount">
                <span>🎟️ Промокод ${appliedPromoCode ? `(${appliedPromoCode})` : ''}:</span>
                <span>-${formatPriceValue(promoDiscount)}₽</span>
            </div>`;
    } else if (promoFreeDelivery && promoState.enabled) {
        cartHTML += `
            <div class="summary-row promo-discount">
                <span>🎟️ Промокод ${appliedPromoCode ? `(${appliedPromoCode})` : ''}:</span>
                <span>Бесплатная доставка</span>
            </div>`;
    }
    
    cartHTML += `
            <div class="summary-row">
                <span>Доставка:</span>
                <span>${formatPriceValue(delivery)}₽</span>
            </div>
            <div class="summary-row summary-total">
                <span>Итого:</span>
                <span>${formatPriceValue(total)}₽</span>
            </div>
            <div class="promo-block">
                <label class="promo-toggle">
                    <input type="checkbox" id="promo-toggle-checkbox" ${promoState.enabled ? 'checked' : ''}>
                    <span>Использовать промокод</span>
                </label>
                <div class="promo-input-wrapper" id="promo-input-wrapper" style="display: ${promoState.enabled ? 'flex' : 'none'};">
                    <input type="text" id="promo-code-input" class="form-input" placeholder="Введите промокод" value="${promoState.enabled ? promoState.code : ''}" ${promoState.enabled ? '' : 'disabled'}>
                    <button type="button" class="promo-apply-btn" id="promo-apply-btn">${promoState.validation?.ok ? 'Применён' : 'Применить'}</button>
                </div>
                <div class="form-hint" id="promo-hint">${hasPromo ? (promoFreeDelivery ? 'Бесплатная доставка по промокоду' : hasPromoDiscount ? `Скидка по промокоду: -${promoDiscount}₽` : '') : ''}</div>
            </div>
            <button class="checkout-btn" onclick="proceedToOrder()">
                Оформить заказ
            </button>
            <!-- Временно убрано ограничение минимального заказа -->
        </div>
    </div>`;

    cartContent.innerHTML = cartHTML;
    setupPromoControls();
}

function setupPromoControls() {
    const checkbox = document.getElementById('promo-toggle-checkbox');
    const wrapper = document.getElementById('promo-input-wrapper');
    const input = document.getElementById('promo-code-input');
    const applyBtn = document.getElementById('promo-apply-btn');

    if (!checkbox || !wrapper || !input || !applyBtn) {
        return;
    }

    checkbox.checked = promoState.enabled;
    wrapper.style.display = promoState.enabled ? 'flex' : 'none';
    input.disabled = !promoState.enabled;
    input.value = promoState.enabled ? (promoState.code || '') : '';

    checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
            promoState.enabled = true;
            promoState.validation = null;
            wrapper.style.display = 'flex';
            input.disabled = false;
            input.focus();
            updatePromoHint('');
        } else {
            promoState = { enabled: false, code: '', validation: null };
            showCart();
        }
    });

    input.addEventListener('input', () => {
        const value = input.value.trim().toUpperCase();
        input.value = value;
        promoState.code = value;
        promoState.validation = null;
        updatePromoHint('');
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            applyPromoCode();
        }
    });

    applyBtn.addEventListener('click', () => applyPromoCode());
}

async function applyPromoCode() {
    const input = document.getElementById('promo-code-input');
    const applyBtn = document.getElementById('promo-apply-btn');
    const checkbox = document.getElementById('promo-toggle-checkbox');

    if (!input || !applyBtn || !checkbox) return;

    const code = input.value.trim().toUpperCase();
    if (!code) {
        updatePromoHint('Введите промокод', 'error');
        return;
    }

    promoState.enabled = true;
    promoState.code = code;
    promoState.validation = null;
    checkbox.checked = true;
    updatePromoHint('');

    const originalText = applyBtn.textContent;
    applyBtn.disabled = true;
    applyBtn.textContent = 'Проверяем...';

    try {
        const totalsBeforePromo = calculateCartTotal();
        const subtotalForPromo = totalsBeforePromo.subtotalAfterLoyalty ?? totalsBeforePromo.subtotal;
        const response = await fetch(`${API_BASE}/api/promocodes/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                userId: getUserId(),
                subtotal: subtotalForPromo
            })
        });
        const data = await response.json();

        if (!response.ok || !data.ok) {
            const message = data?.error || 'Ваш промокод больше не действителен';
            updatePromoHint(message, 'error');
            showNotification(message, 'error');
            applyBtn.disabled = false;
            applyBtn.textContent = originalText;
            promoState.validation = null;
            return;
        }

        promoState.validation = data;
        updatePromoHint(
            data.discount?.appliesToDelivery
                ? 'Бесплатная доставка по промокоду'
                : data.discount?.amount
                    ? `Скидка по промокоду: -${data.discount.amount}₽`
                    : 'Промокод применён',
            'success'
        );
        showCart();
    } catch (error) {
        console.error('Ошибка проверки промокода:', error);
        showNotification('Не удалось проверить промокод', 'error');
        updatePromoHint('Не удалось проверить промокод', 'error');
        applyBtn.disabled = false;
        applyBtn.textContent = originalText;
    }
}

// Функция изменения количества в корзине
function changeCartQuantity(cartKey, delta) {
    const item = cart[cartKey];
    if (!item) return;

    const newQuantity = item.quantity + delta;
    if (newQuantity <= 0) {
        delete cart[cartKey];
    } else if (newQuantity > item.maxQty) {
        showNotification(`Максимальное количество: ${item.maxQty} шт.`, 'warning');
        return;
    } else {
        item.quantity = newQuantity;
    }

    localStorage.setItem('tundra_cart', JSON.stringify(cart));
    updateCartBadge();
    if (promoState.enabled) {
        promoState.validation = null;
        updatePromoHint('');
    }
    showCart(); // Перерисовываем корзину
}

// Функция расчета итогов корзины
function calculateCartTotal() {
    const cartItems = Object.values(cart);
    const rawSubtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    const loyalty = calculateLoyalty(userProfile.totalSpent);
    const loyaltyDiscount = Math.round(rawSubtotal * (loyalty.discount / 100));
    let subtotalAfterLoyalty = Math.max(0, rawSubtotal - loyaltyDiscount);

    let promoDiscount = 0;
    let promoFreeDelivery = false;
    let appliedPromoCode = null;

    if (promoState.enabled && promoState.validation?.ok) {
        const discountInfo = promoState.validation.discount || {};
        promoDiscount = Math.min(subtotalAfterLoyalty, Math.max(0, discountInfo.amount || 0));
        promoFreeDelivery = Boolean(discountInfo.appliesToDelivery);
        appliedPromoCode = promoState.validation.promo?.code || promoState.code || null;
    }

    let subtotalAfterPromo = Math.max(0, subtotalAfterLoyalty - promoDiscount);

    const deliveryZone = document.getElementById('delivery-zone')?.value;
    let delivery = 0;
    if (promoFreeDelivery) {
        delivery = 0;
    } else if (deliveryZone === 'moscow') {
        delivery = subtotalAfterPromo >= 5000 ? 0 : 400;
    } else if (deliveryZone === 'mo') {
        delivery = 1000;
    }

    const total = subtotalAfterPromo + delivery;

    return {
        rawSubtotal,
        loyaltyDiscount,
        loyaltyPercent: loyalty.discount,
        subtotalAfterLoyalty,
        promoDiscount,
        promoFreeDelivery,
        appliedPromoCode,
        subtotal: subtotalAfterPromo,
        delivery,
        total
    };
}

// 📞 ФУНКЦИЯ ВАЛИДАЦИИ НОМЕРА ТЕЛЕФОНА
function validatePhoneNumber(phone) {
    if (!phone) {
        return { valid: false, message: 'Введите номер телефона' };
    }
    
    // Убираем все символы кроме цифр и +
    const cleanPhone = phone.replace(/[^\d+]/g, '');
    
    // Проверяем длину
    if (cleanPhone.length < 10) {
        return { valid: false, message: 'Номер телефона слишком короткий' };
    }
    
    if (cleanPhone.length > 15) {
        return { valid: false, message: 'Номер телефона слишком длинный' };
    }
    
    // Проверяем формат (должен начинаться с +7, 8, или 7)
    const phoneRegex = /^(\+7|8|7)[\d]{10}$/;
    if (!phoneRegex.test(cleanPhone)) {
        return { valid: false, message: 'Неверный формат номера. Используйте: +7XXXXXXXXXX или 8XXXXXXXXXX' };
    }
    
    return { valid: true, message: 'Номер телефона корректен' };
}

function updatePromoHint(text = '', type = null) {
    const hint = document.getElementById('promo-hint');
    if (!hint) return;
    hint.textContent = text || '';
    hint.classList.remove('promo-hint-success', 'promo-hint-error');
    if (type === 'success') {
        hint.classList.add('promo-hint-success');
    } else if (type === 'error') {
        hint.classList.add('promo-hint-error');
    }
}

// Функция перехода к оформлению заказа
function proceedToOrder() {
    // Временно убрана проверка минимального заказа
    
    // Проверяем, есть ли товары в корзине
    const cartItems = Object.values(cart).filter(item => item.quantity > 0);
    if (cartItems.length === 0) {
        showNotification('Корзина пуста', 'warning');
        return;
    }
    
    showScreen('order-form-screen');
}

// Функция показа профиля
function showProfile() {
    console.log('📱 ПРОФИЛЬ: Открываем профиль, вызываем updateLoyaltyCard(true)');
    // showNotification('🔄 Синхронизируем карту лояльности...', 'info'); // скрываем всплывающее сообщение
    showScreen('profile-screen');
    
    // Принудительно обновляем профиль
    updateLoyaltyCard(true).then(() => {
        // Не показываем уведомление об успешной синхронизации, чтобы не шуметь UI
        // showNotification('✅ Данные обновлены', 'success');
    }).catch((error) => {
        console.error('❌ Ошибка синхронизации:', error);
        // Оставляем только лог/консоль. Если нужно – можно включить уведомление об ошибке.
        // showNotification('❌ Ошибка обновления данных', 'error');
    });
}




// 🆕 ФУНКЦИИ ДЛЯ НОВЫХ ПУНКТОВ МЕНЮ
function showFavorites() {
    showNotification('Функция "Избранное" в разработке', 'info');
    // TODO: Реализовать систему избранных товаров
}

function showAddresses() {
    showNotification('Функция "Адреса доставки" в разработке', 'info');
    // TODO: Реализовать сохраненные адреса
}

function syncUserData() {
    const syncBtn = event.target.closest('.menu-item');
    const originalText = syncBtn.querySelector('.menu-item-text').textContent;
    
    // Показываем процесс синхронизации
    syncBtn.querySelector('.menu-item-text').textContent = 'Синхронизация...';
    syncBtn.style.opacity = '0.6';
    
    Promise.all([
        syncProfileWithServer(),
        syncLoyaltyWithServer()
    ]).then(() => {
        // Обновляем все данные профиля
        updateUserInfo();
        updateLoyaltyCard(true); // Принудительная синхронизация при ручном запросе
        updateQuickStats();
        
        // Сохраняем время синхронизации
        localStorage.setItem('last_sync_time', new Date().toISOString());
        
        showNotification('✅ Данные обновлены', 'success');
    }).catch((error) => {
        console.error('❌ Ошибка синхронизации:', error);
        showNotification('❌ Ошибка обновления данных', 'error');
    }).finally(() => {
        // Восстанавливаем кнопку
        syncBtn.querySelector('.menu-item-text').textContent = originalText;
        syncBtn.style.opacity = '1';
        updateSyncStatus();
    });
}

function showAbout() {
    const modal = document.getElementById('about-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.classList.add('modal-open');
    }
}

function hideAbout() {
    const modal = document.getElementById('about-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
    }
}

// 📋 ФУНКЦИЯ ЗАГРУЗКИ ИСТОРИИ ПОКУПОК
async function loadPurchaseHistory() {
    try {
        const userId = getUserId();
        const response = await fetch(`${API_BASE}/api/user-purchases/${userId}`);
        
        if (response.ok) {
            const data = await response.json();
            return data.purchases || [];
        } else {
            console.warn('Не удалось загрузить историю покупок');
            return [];
        }
    } catch (error) {
        console.error('Ошибка загрузки истории покупок:', error);
        return [];
    }
}

// 💳 ФУНКЦИЯ ОБРАБОТКИ УСПЕШНОЙ ОПЛАТЫ
function handlePaymentSuccess() {
    const urlParams = new URLSearchParams(window.location.search);
    const orderId = urlParams.get('order');
    
    if (orderId) {
        console.log(`✅ Обрабатываем успешную оплату заказа #${orderId}`);
        
        // Проверяем статус заказа в базе данных
        checkOrderStatusAndShowSuccess(orderId);
    }
}

// 💳 ФУНКЦИЯ ПРОВЕРКИ СТАТУСА ЗАКАЗА И ПОКАЗА УСПЕХА
async function checkOrderStatusAndShowSuccess(orderId) {
    try {
        console.log(`🔍 Проверяем статус заказа #${orderId} в базе данных...`);
        
        const response = await fetch(`/api/orders/${orderId}`);
        if (response.ok) {
            const order = await response.json();
            console.log(`📦 Статус заказа #${orderId}:`, order);
            
            if (order.status === 'accepted' && order.paymentStatus === 'paid') {
                // Заказ оплачен - показываем экран успеха
                document.getElementById('success-order-id').textContent = orderId;
                document.getElementById('success-amount').textContent = order.totals?.total || 0;
                showScreen('payment-success-screen');
                
                // ❌ ОБНОВЛЕНИЕ ПРОФИЛЯ УБРАНО - будет при завершении заказа админом
                // Профиль обновляется только когда админ нажмет "✅ Доставлен"
                console.log('💭 Профиль НЕ обновлен - ждем завершения заказа админом');
                
                // Удаляем данные ожидающего заказа
                localStorage.removeItem('pending_order');
                
                console.log('✅ Экран успешной оплаты показан');
            } else {
                console.log(`⏳ Заказ #${orderId} еще не оплачен, статус: ${order.status}, платеж: ${order.paymentStatus}`);
                // Показываем экран ожидания или обновляем через несколько секунд
                setTimeout(() => checkOrderStatusAndShowSuccess(orderId), 3000);
            }
        } else {
            console.error('❌ Ошибка получения заказа:', response.status);
            // Fallback на данные из localStorage
            showSuccessFromLocalStorage(orderId);
        }
    } catch (error) {
        console.error('❌ Ошибка проверки статуса заказа:', error);
        // Fallback на данные из localStorage
        showSuccessFromLocalStorage(orderId);
    }
}

// 💳 FALLBACK ФУНКЦИЯ ДЛЯ ПОКАЗА УСПЕХА ИЗ LOCALSTORAGE
function showSuccessFromLocalStorage(orderId) {
    const pendingOrder = localStorage.getItem('pending_order');
    if (pendingOrder) {
        try {
            const orderData = JSON.parse(pendingOrder);
            
            // Показываем экран успешной оплаты
            document.getElementById('success-order-id').textContent = orderId;
            document.getElementById('success-amount').textContent = orderData.amount || 0;
            showScreen('payment-success-screen');
            
            // ❌ ОБНОВЛЕНИЕ ПРОФИЛЯ УБРАНО - будет при завершении заказа админом
            // Профиль обновляется только когда админ нажмет "✅ Доставлен"
            console.log('💭 Профиль НЕ обновлен - ждем завершения заказа админом');
            
            // Удаляем данные ожидающего заказа
            localStorage.removeItem('pending_order');
            
            // 🚫 УБРАЛИ ОБНОВЛЕНИЕ КАРТЫ ЛОЯЛЬНОСТИ ПОСЛЕ ОПЛАТЫ
            // Карта обновится только при завершении заказа админом
            
            // Очищаем URL
            window.history.replaceState({}, document.title, window.location.pathname);
            
        } catch (error) {
            console.error('Ошибка обработки данных заказа:', error);
            showMain();
        }
    } else {
        console.log('❌ Нет данных о заказе в localStorage');
        showMain();
    }
}

// Функция быстрого перехода к истории покупок
function viewPurchaseHistory() {
    showProfile();
    setTimeout(() => {
        showMyOrders();
    }, 100);
}

// Функция показа моих заказов
async function showMyOrders() {
    showScreen('my-orders-screen');
    await loadUserOrders();
    
    // Запускаем автообновление заказов каждые 10 секунд
    if (window.ordersUpdateInterval) {
        clearInterval(window.ordersUpdateInterval);
    }
    window.ordersUpdateInterval = setInterval(async () => {
        console.log('🔄 CLIENT: Автообновление списка заказов');
        await loadUserOrders();
    }, 10000);
}

// Загрузка заказов пользователя
async function loadUserOrders() {
    try {
        const userId = getUserId();
        console.log('🔍 CLIENT: Загружаем заказы для пользователя ' + userId);
        console.log('🔍 CLIENT: URL: ' + API_BASE + '/api/user-orders/' + userId);
        
        const response = await fetch(API_BASE + '/api/user-orders/' + userId);
        console.log('🔍 CLIENT: Ответ сервера: ' + response.status);
        
        if (response.ok) {
            const result = await response.json();
            console.log('🔍 CLIENT: Результат:', result);
            
            if (result.ok) {
                console.log('🔍 CLIENT: Заказов получено: ' + result.orders.length);
                displayOrders(result.orders);
            } else {
                console.error('Ошибка загрузки заказов:', result.error);
                showEmptyOrders();
            }
        } else {
            console.error('Ошибка HTTP:', response.status);
            showEmptyOrders();
        }
    } catch (error) {
        console.error('Ошибка загрузки заказов:', error);
        showEmptyOrders();
    }
}

// Отображение списка заказов
function displayOrders(orders) {
    console.log('🔍 CLIENT: displayOrders вызвана с ' + orders.length + ' заказами');
    
    const ordersList = document.getElementById('orders-list');
    const emptyOrders = document.getElementById('empty-orders');
    
    // Проверяем, что элементы существуют
    if (!ordersList || !emptyOrders) {
        console.error('❌ CLIENT: Не найдены элементы orders-list или empty-orders');
        return;
    }
    
    if (orders.length === 0) {
        console.log('🔍 CLIENT: Нет заказов, показываем пустой экран');
        showEmptyOrders();
        return;
    }
    
    console.log('🔍 CLIENT: Отображаем заказы');
    ordersList.innerHTML = '';
    
    orders.forEach((order, index) => {
        console.log('🔍 CLIENT: Заказ ' + (index + 1) + ':', {
            order_id: order.order_id,
            status: order.status,
            total_amount: order.total_amount
        });
        const orderItem = createOrderItem(order);
        if (orderItem) {
            ordersList.appendChild(orderItem);
        }
    });
    
    ordersList.style.display = 'block';
    emptyOrders.style.display = 'none';
}

// Глобальные тексты статусов
const ORDER_STATUS_TEXTS = {
    'new': '⏳ Новый',
    'accepted': '🟡 Принят',
    'preparing': '🔵 Готовится',
    'delivering': '🚚 В доставке',
    'completed': '✅ Доставлен',
    'cancelled': '🔴 Отменен'
};

// Создание элемента заказа (упрощенный вид)
function createOrderItem(order) {
    try {
        if (!order || !order.order_id) {
            console.error('❌ CLIENT: Некорректные данные заказа:', order);
            return null;
        }
        
        const orderItem = document.createElement('div');
        orderItem.className = 'order-item';
        orderItem.onclick = () => showOrderDetails(order.order_id);
        
        // Получаем состав заказа
        let itemsText = 'Состав недоступен';
        try {
            const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
            if (Array.isArray(items) && items.length > 0) {
                itemsText = items.map(item => item.name + ' x' + item.quantity).join(', ');
            }
        } catch (e) {
            console.warn('⚠️ CLIENT: Ошибка парсинга items:', e);
        }
        
        // Форматируем дату и сумму (для purchase_history используем purchase_date и amount)
        const orderDate = order.purchase_date || order.created_at || order.createdAt;
        const orderAmount = order.amount || order.total_amount || order.totals?.total || 0;
        
        const orderDateText = orderDate ? new Date(orderDate).toLocaleDateString('ru-RU') : 'Не указана';
        const orderTimeText = orderDate ? new Date(orderDate).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Не указано';
        
        orderItem.innerHTML = 
            '<div class="order-header">' +
                '<div class="order-date">' + orderDateText + '</div>' +
                '<div class="order-time">' + orderTimeText + '</div>' +
            '</div>' +
            '<div class="order-info">' +
                '<div class="order-composition">' + itemsText + '</div>' +
                '<div class="order-amount">' + orderAmount + '₽</div>' +
            '</div>';
        
        return orderItem;
    } catch (error) {
        console.error('❌ CLIENT: Ошибка создания элемента заказа:', error);
        return null;
    }
}

// Показать пустой список заказов
function showEmptyOrders() {
    const ordersList = document.getElementById('orders-list');
    const emptyOrders = document.getElementById('empty-orders');
    
    // Проверяем, что элементы существуют
    if (!ordersList || !emptyOrders) {
        console.error('❌ CLIENT: Не найдены элементы orders-list или empty-orders в showEmptyOrders');
        return;
    }
    
    ordersList.style.display = 'none';
    emptyOrders.style.display = 'block';
}

// Показать детали заказа
async function showOrderDetails(orderId) {
    try {
        const response = await fetch(`${API_BASE}/api/orders/${orderId}`);
        
        if (response.ok) {
            const result = await response.json();
            if (result.ok) {
                displayOrderDetails(result.order);
                showScreen('order-details-screen');
                
                // Убрано автообновление - показываем только доставленные заказы
                
            } else {
                showNotification('Ошибка загрузки деталей заказа', 'error');
            }
        } else {
            showNotification('Ошибка загрузки деталей заказа', 'error');
        }
    } catch (error) {
        console.error('Ошибка загрузки деталей заказа:', error);
        showNotification('Ошибка загрузки деталей заказа', 'error');
    }
}

// Отображение деталей заказа
function displayOrderDetails(order) {
    const content = document.getElementById('order-details-content');
    
    const address = typeof order.address === 'string' ? JSON.parse(order.address) : order.address;
    const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
    
    const fullAddress = [
        address?.street,
        address?.house,
        address?.apartment && `кв. ${address.apartment}`,
        address?.floor && `эт. ${address.floor}`,
        address?.entrance && `под. ${address.entrance}`,
        address?.intercom && `домофон: ${address.intercom}`
    ].filter(Boolean).join(', ');
    
    // Форматируем дату и время
    const orderDate = order.createdAt || order.created_at;
    const orderAmount = order.totals?.total || order.total_amount || 0;
    
    content.innerHTML = `
        <div class="order-detail-section">
            <div class="order-detail-title">Информация о заказе</div>
            <div><strong>Дата:</strong> ${orderDate ? new Date(orderDate).toLocaleDateString('ru-RU') : 'Не указана'}</div>
            <div><strong>Время:</strong> ${orderDate ? new Date(orderDate).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Не указано'}</div>
            <div><strong>Сумма:</strong> ${orderAmount}₽</div>
        </div>
        
        <div class="order-detail-section">
            <div class="order-detail-title">Адрес доставки</div>
            <div>${fullAddress}</div>
            <div><strong>Зона:</strong> ${order.delivery_zone === 'moscow' ? 'Москва' : 'МО'}</div>
        </div>
        
        <div class="order-detail-section">
            <div class="order-detail-title">Состав заказа</div>
            <ul class="order-items-list">
                ${items.map(item => `
                    <li>
                        <div>
                            <div class="item-name">${item.name}</div>
                            <div class="item-quantity">Количество: ${item.quantity}</div>
                        </div>
                        <div class="item-price">${item.price * item.quantity}₽</div>
                    </li>
                `).join('')}
            </ul>
        </div>
    `;
}

// Функция проверки рабочих часов
function isWorkingHours() {
    // В тестовом режиме снимаем ограничение по времени, чтобы удобно гонять сценарии
    if (TEST_MODE) return true;
    const now = new Date();
    const hour = now.getHours();
    return hour >= 10 && hour < 21;
}

// Функция обновления статуса работы - включена
function updateWorkStatus() {
    const statusEl = document.getElementById('work-status');
    if (!statusEl) return;
    if (isWorkingHours()) {
        statusEl.textContent = 'Работаем';
        statusEl.style.color = '#27ae60';
    } else {
        statusEl.textContent = 'Закрыто';
        statusEl.style.color = '#e74c3c';
    }
}

// Функция показа уведомлений
function showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.opacity = '1';
    notification.style.display = 'block';
    
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            notification.style.display = 'none';
        }, 300); // Даем время для анимации
    }, 3000);
}

// Функции для модального окна с часами работы
function showWorkHours() {
    const modal = document.getElementById('work-hours-modal');
    modal.classList.add('active');
}

function hideWorkHours() {
    const modal = document.getElementById('work-hours-modal');
    modal.classList.remove('active');
}

// Функция открытия поддержки
function openSupport() {
    if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.openTelegramLink('https://t.me/tundrasupport');
    } else {
        window.open('https://t.me/tundrasupport', '_blank');
    }
}

// Функция обновления информации о доставке
function updateDeliveryInfo() {
    const deliveryZone = document.getElementById('delivery-zone').value;
    const deliveryInfo = document.querySelector('.delivery-info');
    
    if (deliveryZone === 'moscow') {
        deliveryInfo.innerHTML = `
            <h4>Информация о доставке</h4>
            <div class="delivery-rules">
                <div class="delivery-rule">
                    <strong>Москва (МКАД):</strong> 400₽, бесплатно от 5000₽
                </div>
                <div class="delivery-rule">
                    <strong>Минимальный заказ:</strong> ${getMinOrderAmount()}₽${TEST_MODE ? ' (тестовый режим' + (FORCE_DEMO_MODE ? ', демо-режим' : '') + ')' : ''}
                </div>
            </div>
        `;
    } else if (deliveryZone === 'mo') {
        deliveryInfo.innerHTML = `
            <h4>Информация о доставке</h4>
            <div class="delivery-rules">
                <div class="delivery-rule">
                    <strong>Московская область:</strong> доставка 1000₽
                </div>
                <div class="delivery-rule">
                    <strong>Минимальный заказ:</strong> ${getMinOrderAmount()}₽${TEST_MODE ? ' (тестовый режим' + (FORCE_DEMO_MODE ? ', демо-режим' : '') + ')' : ''}
                </div>
            </div>
        `;
    } else {
        deliveryInfo.innerHTML = `
            <h4>Информация о доставке</h4>
            <div class="delivery-rules">
                <div class="delivery-rule">
                    <strong>Москва (МКАД):</strong> 400₽, бесплатно от 5000₽
                </div>
                <div class="delivery-rule">
                    <strong>МО:</strong> доставка 1000₽
                </div>
                <div class="delivery-rule">
                    <strong>Минимальный заказ:</strong> ${getMinOrderAmount()}₽${TEST_MODE ? ' (тестовый режим' + (FORCE_DEMO_MODE ? ', демо-режим' : '') + ')' : ''}
                </div>
            </div>
        `;
    }
}

// Функция старта из приветственного экрана
function startFromWelcome() {
    showScreen('main-screen');
    updateWorkStatus();
    setInterval(updateWorkStatus, 60000);
}

// Обработчик отправки формы заказа
document.addEventListener('DOMContentLoaded', () => {
    const orderForm = document.getElementById('orderForm');
    if (orderForm) {
        // Добавляем валидацию номера телефона в реальном времени
        const phoneInput = document.getElementById('phone');
        if (phoneInput) {
            phoneInput.addEventListener('input', function() {
                const phone = this.value.trim();
                const validation = validatePhoneNumber(phone);
                
                // Убираем предыдущие стили
                this.style.borderColor = '';
                this.style.backgroundColor = '';
                
                if (phone.length > 0) {
                    if (validation.valid) {
                        // Зеленый цвет для правильного номера
                        this.style.borderColor = '#4CAF50';
                        this.style.backgroundColor = '#f0f8f0';
                    } else {
                        // Красный цвет для неправильного номера
                        this.style.borderColor = '#ff6b6b';
                        this.style.backgroundColor = '#ffe6e6';
                    }
                }
            });
        }
        orderForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // 🚫 ЗАЩИТА ОТ МНОЖЕСТВЕННОЙ ОТПРАВКИ
            if (window.isSubmittingOrder) {
                console.log('⚠️ Заказ уже отправляется, игнорируем повторную отправку');
                return;
            }
            window.isSubmittingOrder = true;
            const releaseSubmissionFlag = () => {
                window.isSubmittingOrder = false;
            };
            
            // Проверяем минимальный заказ в зависимости от зоны доставки
            const deliveryZone = document.getElementById('delivery-zone').value;
            const { subtotal } = calculateCartTotal();
            
            const minOrder = getMinOrderAmount();
            if (deliveryZone === 'mo' && subtotal < minOrder) {
                showNotification(`Для Московской области минимальный заказ: ${formatPriceValue(minOrder)}₽`, 'warning');
                releaseSubmissionFlag();
                return;
            } else if (deliveryZone === 'moscow' && subtotal < minOrder) {
                const suffix = TEST_MODE ? ' (тестовый режим' + (FORCE_DEMO_MODE ? ', демо-режим' : '') + ')' : '';
                showNotification(`Для Москвы минимальный заказ: ${formatPriceValue(minOrder)}₽${suffix}`, 'warning');
                releaseSubmissionFlag();
                return;
            } else if (!deliveryZone) {
                showNotification('Выберите зону доставки', 'warning');
                releaseSubmissionFlag();
                return;
            }
            
            // Проверяем обязательные поля
            const street = document.getElementById('street').value.trim();
            const house = document.getElementById('house').value.trim();
            const phone = document.getElementById('phone').value.trim();
            
            if (!street || !house) {
                showNotification('Заполните адрес доставки', 'warning');
                releaseSubmissionFlag();
                return;
            }
            
            // Проверяем имя клиента
            const customerName = document.getElementById('customerName').value.trim();
            if (!customerName) {
                showNotification('Введите имя клиента', 'error');
                
                // Подсвечиваем поле имени красным
                const nameInput = document.getElementById('customerName');
                nameInput.style.borderColor = '#ff6b6b';
                nameInput.style.backgroundColor = '#ffe6e6';
                
                // Убираем подсветку через 3 секунды
                setTimeout(() => {
                    nameInput.style.borderColor = '';
                    nameInput.style.backgroundColor = '';
                }, 3000);
                
                releaseSubmissionFlag();
                return;
            }
            
            // Валидируем номер телефона
            const phoneValidation = validatePhoneNumber(phone);
            if (!phoneValidation.valid) {
                showNotification(phoneValidation.message, 'error');
                
                // Подсвечиваем поле телефона красным
                const phoneInput = document.getElementById('phone');
                phoneInput.style.borderColor = '#ff6b6b';
                phoneInput.style.backgroundColor = '#ffe6e6';
                
                // Убираем подсветку через 3 секунды
                setTimeout(() => {
                    phoneInput.style.borderColor = '';
                    phoneInput.style.backgroundColor = '';
                }, 3000);
                
                releaseSubmissionFlag();
                return;
            }
            
            // Получаем данные пользователя Telegram
            const telegramUser = getTelegramUserData();
            
            const userId = getUserId();
            console.log(`🔍 CLIENT: Создаем заказ для пользователя: ${userId}`);
            
            const formData = {
                userId: userId, // Добавляем ID пользователя
                telegramUser: telegramUser, // Данные Telegram профиля
                customerName: document.getElementById('customerName').value.trim(), // Имя из формы
                deliveryZone: deliveryZone,
                address: {
                    street: document.getElementById('street').value.trim(),
                    house: document.getElementById('house').value.trim(),
                    apartment: document.getElementById('apartment').value.trim(),
                    floor: document.getElementById('floor').value.trim(),
                    entrance: document.getElementById('entrance').value.trim(),
                    intercom: document.getElementById('intercom').value.trim()
                },
                phone: document.getElementById('phone').value.trim(),
                comment: document.getElementById('comment').value.trim(),
                cartItems: Object.values(cart).filter(i => i.quantity > 0),
                totals: calculateCartTotal(),
                // Режим продакшена - без демо-режима
            };

            // Показываем индикатор загрузки
            const submitBtn = e.target.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'Отправляем заказ...';
            submitBtn.disabled = true;
            
            if (promoState.enabled) {
                const promoInputElement = document.getElementById('promo-code-input');
                const promoCodeRaw = (promoState.code || promoInputElement?.value || '').trim().toUpperCase();
                if (!promoCodeRaw) {
                    showNotification('Введите промокод', 'warning');
                    updatePromoHint('Введите промокод', 'error');
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                    window.isSubmittingOrder = false;
                    return;
                }

                const subtotalForPromo = formData.totals?.subtotal ?? 0;

                try {
                    const promoResponse = await fetch(`${API_BASE}/api/promocodes/validate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            code: promoCodeRaw,
                            userId,
                            subtotal: subtotalForPromo
                        })
                    });
                    const promoJson = await promoResponse.json();
                    if (!promoResponse.ok || !promoJson.ok) {
                        const message = promoJson?.error || 'Ваш промокод больше не действителен';
                        showNotification(message, 'error');
                        updatePromoHint(message, 'error');
                        submitBtn.textContent = originalText;
                        submitBtn.disabled = false;
                        window.isSubmittingOrder = false;
                        return;
                    }
                    promoState.code = promoJson.promo?.code || promoCodeRaw;
                    promoState.validation = promoJson;
                    if (promoJson.discount?.appliesToDelivery) {
                        updatePromoHint('Бесплатная доставка по промокоду', 'success');
                    } else if (promoJson.discount?.amount) {
                        updatePromoHint(`Скидка по промокоду: -${promoJson.discount.amount}₽`, 'success');
                    } else {
                        updatePromoHint('Промокод применён', 'success');
                    }
                    formData.promoCode = promoState.code;
                } catch (promoError) {
                    console.error('Ошибка проверки промокода:', promoError);
                    showNotification('Не удалось проверить промокод', 'error');
                    updatePromoHint('Не удалось проверить промокод', 'error');
                    submitBtn.textContent = originalText;
                    submitBtn.disabled = false;
                    window.isSubmittingOrder = false;
                    return;
                }
            } else {
                promoState.validation = null;
                updatePromoHint('');
                if (formData.promoCode) {
                    delete formData.promoCode;
                }
            }
            
            try {
                const response = await fetch(`${API_BASE}/api/orders`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                if (!response.ok) {
                    let errorMessage = 'Ошибка отправки заказа. Попробуйте еще раз.';
                    try {
                        const errorBody = await response.json();
                        if (errorBody?.error) {
                            errorMessage = errorBody.error;
                        }
                    } catch (_) {}
                    throw new Error(errorMessage);
                }
                
                const result = await response.json();
                console.log('📥 Ответ от сервера:', result);
                
                if (result.ok) {
                    // 🔥 ЗАКАЗ СОЗДАН - ПОЛУЧАЕМ URL ДЛЯ ОПЛАТЫ
                    currentOrderId = parseInt(result.order.id);
                    orderCounter = currentOrderId;
                    localStorage.setItem('tundra_order_counter', orderCounter.toString());
                    
                    // Сохраняем данные заказа для обновления профиля ПОСЛЕ оплаты
                    const serverTotals = result.order.totals || calculateCartTotal();
                    const orderData = {
                        orderId: currentOrderId,
                        cartTotal: serverTotals,
                        cartItems: Object.values(cart).filter(i => i.quantity > 0),
                        timestamp: Date.now(),
                        paymentId: result.order.paymentId,
                        paymentUrl: result.order.paymentUrl,
                        amount: serverTotals?.total
                    };
                    localStorage.setItem('pending_order', JSON.stringify(orderData));
                    promoState = { enabled: false, code: '', validation: null };
                    const promoCheckboxElement = document.getElementById('promo-toggle-checkbox');
                    const promoGroupElement = document.getElementById('promo-code-group');
                    const promoInputElement = document.getElementById('promo-code-input');
                    if (promoCheckboxElement) promoCheckboxElement.checked = false;
                    if (promoGroupElement) promoGroupElement.style.display = 'none';
                    if (promoInputElement) promoInputElement.value = '';
                    updatePromoHint('');
                    
                    console.log(`💳 Заказ #${currentOrderId} создан, перенаправляем на оплату ЮKassa...`);
                    
                    // Очищаем корзину
                    cart = {};
                    localStorage.setItem('tundra_cart', JSON.stringify(cart));
                    updateCartBadge();
                    
                    // 💳 ОБРАБАТЫВАЕМ ОТВЕТ ОТ СЕРВЕРА
                    if (result.isTestMode && result.isPaid) {
                        // ДЕМО РЕЖИМ: Заказ автоматически оплачен
                        console.log(`🎭 ДЕМО РЕЖИМ: Заказ автоматически оплачен`);
                        showNotification('Заказ успешно создан! (Демо-режим)', 'success');
                        
                        // Показываем экран успешной оплаты
                        setTimeout(() => {
                            handleSuccessfulPayment({
                                id: currentOrderId,
                                status: 'accepted',
                                paymentStatus: 'paid',
                                totals: { total: result.amount }
                            });
                        }, 1000);
                        
                    } else if (result.order.paymentUrl) {
                        // ОБЫЧНЫЙ РЕЖИМ: Перенаправляем на оплату
                        console.log(`🚀 Открываем страницу оплаты: ${result.order.paymentUrl}`);
                        console.log(`🤖 Telegram WebApp доступен:`, !!window.Telegram?.WebApp);
                        
                        // Проверяем, запускается ли в Telegram
                        if (window.Telegram?.WebApp && window.Telegram.WebApp.openLink) {
                            console.log(`📱 Открываем через Telegram WebApp...`);
                            // В Telegram Web App открываем через openLink
                            window.Telegram.WebApp.openLink(result.order.paymentUrl);
                        } else {
                            console.log(`🌐 Открываем в браузере...`);
                            // В обычном браузере открываем в том же окне
                            window.location.href = result.order.paymentUrl;
                        }
                        
                        // Показываем экран ожидания оплаты как fallback
                        setTimeout(() => {
                            startPaymentTimer(currentOrderId);
                        }, 1000);
                    } else {
                        // Fallback: показываем экран ожидания оплаты
                        console.warn('⚠️ PaymentUrl не получен, показываем экран ожидания');
                        startPaymentTimer(currentOrderId);
                    }
                    
                    return; // Выходим из функции
                }
            } catch (err) {
                console.error('Ошибка отправки заказа:', err);
                showNotification(err.message || 'Ошибка отправки заказа. Попробуйте еще раз.', 'error');
                showCart();
            } finally {
                // Восстанавливаем кнопку
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
                
                // 🔄 СБРАСЫВАЕМ ФЛАГ МНОЖЕСТВЕННОЙ ОТПРАВКИ
                window.isSubmittingOrder = false;
            }
        });
    }
});

// 🎨 ФУНКЦИИ ДЛЯ РАБОТЫ С БАННЕРАМИ

let bannersData = [];
let currentBannerIndex = 0;
let bannerAutoRotateTimer = null;
let bannerAutoRotateSeconds = 5;

// Загрузка баннеров с сервера
async function loadBanners() {
    try {
        const response = await fetch('/api/banners');
        const data = await response.json();
        if (data.ok && data.banners && data.banners.length > 0) {
            bannersData = data.banners;
            // Используем время автопрокрутки из первого баннера (или по умолчанию 5 секунд)
            bannerAutoRotateSeconds = bannersData[0]?.auto_rotate_seconds || 5;
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ Ошибка загрузки баннеров:', error);
        return false;
    }
}

// Рендеринг карусели баннеров
function renderBanners() {
    const carousel = document.getElementById('banners-carousel');
    const container = document.getElementById('banners-container');
    const indicators = document.getElementById('banners-indicators');
    
    if (!carousel || !container || !indicators) {
        console.error('❌ Элементы карусели баннеров не найдены');
        return;
    }
    
    if (bannersData.length === 0) {
        carousel.style.display = 'none';
        return;
    }
    
    carousel.style.display = 'block';
    container.innerHTML = '';
    indicators.innerHTML = '';
    
    // Создаем слайды
    bannersData.forEach((banner, index) => {
        const slide = document.createElement('div');
        slide.className = 'banner-slide' + (banner.link_url ? '' : ' no-link');
        
        const img = document.createElement('img');
        img.src = banner.image_url;
        img.alt = `Баннер ${index + 1}`;
        img.className = 'banner-image';
        
        if (banner.link_url) {
            slide.onclick = () => {
                window.open(banner.link_url, '_blank');
            };
        }
        
        slide.appendChild(img);
        container.appendChild(slide);
        
        // Создаем индикатор
        const indicator = document.createElement('button');
        indicator.className = 'banner-indicator' + (index === 0 ? ' active' : '');
        indicator.setAttribute('aria-label', `Баннер ${index + 1}`);
        indicator.onclick = () => goToBanner(index);
        indicators.appendChild(indicator);
    });
    
    // Устанавливаем начальную позицию
    currentBannerIndex = 0;
    updateBannerPosition();
    
    // Запускаем автопрокрутку
    startBannerAutoRotate();
    
    // Добавляем обработчики свайпа
    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;
    let isSwiping = false;
    
    carousel.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length === 0) return;
        touchStartX = e.touches[0].screenX;
        touchStartY = e.touches[0].screenY;
        touchEndX = touchStartX;
        touchEndY = touchStartY;
        isSwiping = true;
    }, { passive: true });

    carousel.addEventListener('touchmove', (e) => {
        if (!isSwiping || !e.touches || e.touches.length === 0) return;
        touchEndX = e.touches[0].screenX;
        touchEndY = e.touches[0].screenY;
        const diffX = Math.abs(touchStartX - touchEndX);
        const diffY = Math.abs(touchStartY - touchEndY);
        if (diffX > diffY && diffX > 10) {
            e.preventDefault();
        }
    }, { passive: false });
    
    carousel.addEventListener('touchend', (e) => {
        if (!isSwiping) return;
        if (e.changedTouches && e.changedTouches.length > 0) {
            touchEndX = e.changedTouches[0].screenX;
            touchEndY = e.changedTouches[0].screenY;
        }
        handleBannerSwipe();
        isSwiping = false;
    });
    
    function handleBannerSwipe() {
        const swipeThreshold = 50;
        const diff = touchStartX - touchEndX;
        const diffY = Math.abs(touchStartY - touchEndY);
        
        if (Math.abs(diff) > swipeThreshold && Math.abs(diff) > diffY) {
            if (diff > 0) {
                // Свайп влево - следующий баннер
                nextBanner();
            } else {
                // Свайп вправо - предыдущий баннер
                prevBanner();
            }
        }
    }
}

// Переход к конкретному баннеру
function goToBanner(index) {
    if (index < 0 || index >= bannersData.length) return;
    currentBannerIndex = index;
    updateBannerPosition();
    startBannerAutoRotate();
}

// Следующий баннер
function nextBanner() {
    currentBannerIndex = (currentBannerIndex + 1) % bannersData.length;
    updateBannerPosition();
    startBannerAutoRotate();
}

// Предыдущий баннер
function prevBanner() {
    currentBannerIndex = (currentBannerIndex - 1 + bannersData.length) % bannersData.length;
    updateBannerPosition();
    startBannerAutoRotate();
}

// Обновление позиции карусели
function updateBannerPosition() {
    const container = document.getElementById('banners-container');
    if (!container) return;
    
    container.style.transform = `translateX(-${currentBannerIndex * 100}%)`;
    
    // Обновляем индикаторы
    const indicators = document.querySelectorAll('.banner-indicator');
    indicators.forEach((indicator, index) => {
        if (index === currentBannerIndex) {
            indicator.classList.add('active');
        } else {
            indicator.classList.remove('active');
        }
    });
}

// Запуск автопрокрутки
function startBannerAutoRotate() {
    if (bannerAutoRotateTimer) {
        clearInterval(bannerAutoRotateTimer);
    }
    
    if (bannersData.length <= 1) return;
    
    bannerAutoRotateTimer = setInterval(() => {
        nextBanner();
    }, bannerAutoRotateSeconds * 1000);
}

// Остановка автопрокрутки (при наведении или взаимодействии)
function stopBannerAutoRotate() {
    if (bannerAutoRotateTimer) {
        clearInterval(bannerAutoRotateTimer);
        bannerAutoRotateTimer = null;
    }
}

// Функция рендеринга категорий
async function renderCategories() {
    console.log('РЕНДЕРИНГ КАТЕГОРИЙ: начинаем');
    const grid = document.getElementById('categories-grid');
    grid.innerHTML = '';

    // Загружаем видимые категории с сервера
    console.log('ВЫЗЫВАЕМ loadCategoriesFromServer()...');
    const visibleCategories = await loadCategoriesFromServer();
    console.log('loadCategoriesFromServer() ЗАВЕРШЕН, получили:', visibleCategories.length, 'категорий');
    
    // Рендерим ВСЕ видимые категории без дополнительной фильтрации по товарам
    const categoriesToRender = visibleCategories;
    
    console.log('БУДЕМ РЕНДЕРИТЬ:', categoriesToRender.length, 'категорий');
    console.log('СПИСОК ДЛЯ РЕНДЕРИНГА:', categoriesToRender.map(c => `${c.id} - ${c.name}`));

    categoriesToRender.forEach((category, index) => {
        console.log(`РЕНДЕРИМ ${index + 1}/${categoriesToRender.length}:`, category.name, `(ID: ${category.id})`);
        
        const card = document.createElement('div');
        card.className = 'category-card';
        card.onclick = () => showCategory(category.id);

        console.log('Loading category:', category.name, 'with imageUrl:', category.imageUrl);
        
        card.innerHTML = `
            <div class="category-image">
                <img src="${category.imageUrl}" alt="${category.name}" onerror="console.error('Category image failed to load:', '${category.imageUrl}'); this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div class="category-icon" style="display: none;">${category.icon}</div>
            </div>
            <div class="category-name">${category.name}</div>
        `;

        grid.appendChild(card);
    });
    
    console.log('РЕНДЕРИНГ ЗАВЕРШЁН: добавлено', grid.children.length, 'карточек в DOM');
}

// Инициализация приложения
async function initApp() {
    // 💳 ПРОВЕРЯЕМ ВОЗВРАТ С ОПЛАТЫ (делаем это первым)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('order')) {
        handlePaymentSuccess();
        return; // Выходим, т.к. обработка успешной оплаты покажет нужный экран
    }
    
    // 🧪 Показываем индикатор тестового режима
    if (TEST_MODE) {
        showTestModeIndicator();
    }
    
    // Загружаем товары с сервера (ждём завершения, важно для фильтрации категорий)
    try {
        await loadProductsFromServer();
    } catch (error) {
        console.error('❌ Ошибка загрузки товаров:', error);
        // Продолжаем работу с локальными товарами
    }
    
    // 🔄 ПЕРИОДИЧЕСКИ ОБНОВЛЯЕМ ТОВАРЫ (каждые 2 минуты)
    setInterval(async () => {
        await loadProductsFromServer();
        // Обновляем отображение категорий если на главной странице
        const currentScreen = document.querySelector('.screen.active');
        if (currentScreen && currentScreen.id === 'main-screen') {
            await renderCategories();
        }
    }, 120000); // 2 минуты
    
    // Показываем приветственный экран
    // Сразу показываем каталог
    showMain();

    // Загружаем и рендерим баннеры
    const hasBanners = await loadBanners();
    if (hasBanners) {
        renderBanners();
    }

    // Рендерим категории
    await renderCategories();

    // Обновляем счетчик корзины
    updateCartBadge();
    
    // 🚫 УБРАЛИ АВТОМАТИЧЕСКУЮ СИНХРОНИЗАЦИЮ ПРИ ЗАГРУЗКЕ
    // Синхронизация происходит только при ручном запросе или завершении заказа
    console.log('📱 Приложение загружено, синхронизация отключена');

    // 🚫 УБРАЛИ АВТОМАТИЧЕСКУЮ СИНХРОНИЗАЦИЮ ПРИ ВОЗВРАЩЕНИИ
    // Синхронизация происходит только при ручном запросе пользователя
    console.log('👁️ Автоматическая синхронизация при возвращении отключена');

    // Инициализируем Telegram Web App
    if (window.Telegram?.WebApp) {
        // Убрана отображение пользовательской информации по требованию
        console.log('✅ Telegram WebApp инициализирован (отображение имени пользователя отключено)');
    }
    
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', initApp);

// Обработчик клика вне модального окна для закрытия
document.addEventListener('click', (e) => {
    const modal = document.getElementById('work-hours-modal');
    if (e.target === modal) {
        hideWorkHours();
    }
});

// Функция расчета уровня лояльности
function calculateLoyalty(totalSpent) {
    if (totalSpent >= 50000) {
        return { level: 'VIP', discount: 10, nextLevel: null, progress: 100 };
    } else if (totalSpent >= 25000) {
        return { level: 'Gold', discount: 5, nextLevel: 50000, progress: ((totalSpent - 25000) / 25000) * 100 };
    } else if (totalSpent >= 10000) {
        return { level: 'Silver', discount: 3, nextLevel: 25000, progress: ((totalSpent - 10000) / 15000) * 100 };
    } else {
        return { level: 'Bronze', discount: 0, nextLevel: 10000, progress: (totalSpent / 10000) * 100 };
    }
}

// 🏆 ФУНКЦИЯ ЗАГРУЗКИ ДАННЫХ ЛОЯЛЬНОСТИ С СЕРВЕРА
async function loadLoyaltyData() {
    try {
        const userId = getUserId();
        console.log(`🔍 CLIENT: Загружаем данные лояльности для пользователя: ${userId}`);
        
        const response = await fetch(`${API_BASE}/api/loyalty/${userId}`);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`🔍 CLIENT: Получены данные лояльности:`, data);
            if (data && data.ok && data.data) {
                return {
                    totalSpent: data.data.totalSpent,
                    totalPurchases: data.data.totalPurchases,
                    currentDiscount: data.data.currentDiscount,
                    nextLevelTarget: null, // будет рассчитано позже
                    nextLevelProgress: null, // будет рассчитано позже
                    levelName: null // будет рассчитано позже
                };
            }
            return null;
        } else {
            console.warn('Не удалось загрузить данные лояльности с сервера');
            return null;
        }
    } catch (error) {
        console.error('❌ CLIENT: Ошибка загрузки данных лояльности:', error);
        return null;
    }
}

// Функция обновления отображения лояльности
function updateLoyaltyDisplay() {
    // Обновляем карту лояльности если открыт профиль
    const profileScreen = document.getElementById('profile-screen');
    if (profileScreen && profileScreen.classList.contains('active')) {
        updateLoyaltyCard();
    }
}

// Функция обновления карты лояльности
async function updateLoyaltyCard(forceServerSync = false) {
    console.log(`🔄 ЛОЯЛЬНОСТЬ: updateLoyaltyCard вызвана с forceServerSync=${forceServerSync}`);
    
    const loyaltyCard = document.querySelector('.loyalty-card');
    if (!loyaltyCard) {
        console.log('⚠️ ЛОЯЛЬНОСТЬ: Карта лояльности не найдена в DOM');
        return;
    }

    let serverStats = null;
    
    // ТОЛЬКО при явном запросе синхронизации загружаем с сервера
    if (forceServerSync) {
        // Загружаем данные с сервера
        serverStats = await loadLoyaltyData();
        console.log('🔄 Принудительная синхронизация данных лояльности');
    } else {
        console.log('📱 Отображение локальных данных лояльности');
    }
    
    let stats;
    if (serverStats) {
        // Используем данные с сервера
        stats = {
            totalSpent: serverStats.totalSpent,
            totalPurchases: serverStats.totalPurchases,
            currentDiscount: serverStats.currentDiscount,
            nextLevelTarget: serverStats.nextLevelTarget,
            nextLevelProgress: serverStats.nextLevelProgress,
            levelName: serverStats.levelName
        };
    } else {
        // Fallback: используем локальные данные
        const loyalty = calculateLoyalty(userProfile.totalSpent);
        stats = {
            totalSpent: userProfile.totalSpent,
            totalPurchases: userProfile.totalPurchases ?? userProfile.completedOrders,
            currentDiscount: loyalty.discount,
            nextLevelTarget: loyalty.nextLevel,
            nextLevelProgress: loyalty.progress,
            levelName: loyalty.level
        };
    }

    const derivedLoyalty = calculateLoyalty(stats.totalSpent || 0);
    stats.currentDiscount = derivedLoyalty.discount;
    stats.nextLevelTarget = derivedLoyalty.nextLevel;
    stats.nextLevelProgress = Math.max(0, Math.min(100, derivedLoyalty.progress ?? 0));
    stats.levelName = derivedLoyalty.level;

    // Определяем следующую скидку
    const amountToNextLevel = stats.nextLevelTarget ? Math.max(stats.nextLevelTarget - stats.totalSpent, 0) : 0;
    const progressPercent = Math.max(0, Math.min(100, stats.nextLevelProgress ?? 0));
    const nextDiscount = stats.nextLevelTarget ? 
        (stats.currentDiscount === 0 ? 3 : 
         stats.currentDiscount === 3 ? 5 : 
         stats.currentDiscount === 5 ? 10 : 'максимальная') : 'максимальная';

    // Проверяем достижение максимальной скидки
    const isMaxDiscount = stats.currentDiscount >= 10;
    
    // Отображаем карту лояльности
    if (isMaxDiscount) {
        // Специальное отображение для максимального уровня
        loyaltyCard.innerHTML = `
            <div class="loyalty-header">
                <div class="loyalty-title">Программа лояльности</div>
            </div>
            <div class="loyalty-stats">
                <div class="loyalty-stat">
                    <div class="stat-value">${stats.totalSpent.toLocaleString()}₽</div>
                    <div class="stat-label">Потрачено всего</div>
                </div>
                <div class="loyalty-stat">
                    <div class="stat-value">${stats.totalPurchases}</div>
                    <div class="stat-label">Заказов сделано</div>
                </div>
                <div class="loyalty-stat">
                    <div class="stat-value">${stats.currentDiscount}%</div>
                    <div class="stat-label">Текущая скидка</div>
                </div>
            </div>
            <div class="loyalty-max-message">
                <div class="max-achievement-text">
                    <h3>Поздравляем!</h3>
                    <p>Вы достигли максимума нашей карты лояльности</p>
                    <p class="max-achievement-subtitle">Вы получаете постоянную скидку 10% на все товары</p>
                </div>
            </div>
            <div class="loyalty-tiers">
                <div class="tier-item">
                    <div class="tier-info">0₽ - 9,999₽ → 0%</div>
                </div>
                <div class="tier-item">
                    <div class="tier-info">10,000₽ - 24,999₽ → 3%</div>
                </div>
                <div class="tier-item">
                    <div class="tier-info">25,000₽ - 49,999₽ → 5%</div>
                </div>
                <div class="tier-item current">
                    <div class="tier-info">50,000₽+ → 10%</div>
                </div>
            </div>
        `;
    } else {
        // Обычное отображение с прогресс-баром
        loyaltyCard.innerHTML = `
            <div class="loyalty-header">
                <div class="loyalty-title">Программа лояльности</div>
            </div>
            <div class="loyalty-stats">
                <div class="loyalty-stat">
                    <div class="stat-value">${stats.totalSpent.toLocaleString()}₽</div>
                    <div class="stat-label">Потрачено всего</div>
                </div>
                <div class="loyalty-stat">
                    <div class="stat-value">${stats.totalPurchases}</div>
                    <div class="stat-label">Заказов сделано</div>
                </div>
                <div class="loyalty-stat">
                    <div class="stat-value">${stats.currentDiscount}%</div>
                    <div class="stat-label">Текущая скидка</div>
                </div>
            </div>
            <div class="loyalty-progress">
                <div class="progress-text">До скидки ${nextDiscount} осталось: ${amountToNextLevel.toLocaleString()}₽</div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progressPercent}%"></div>
                </div>
            </div>
            <div class="loyalty-tiers">
                <div class="tier-item ${stats.currentDiscount === 0 ? 'current' : ''}">
                    <div class="tier-info">0₽ - 9,999₽ → 0%</div>
                </div>
                <div class="tier-item ${stats.currentDiscount === 3 ? 'current' : ''}">
                    <div class="tier-info">10,000₽ - 24,999₽ → 3%</div>
                </div>
                <div class="tier-item ${stats.currentDiscount === 5 ? 'current' : ''}">
                    <div class="tier-info">25,000₽ - 49,999₽ → 5%</div>
                </div>
                <div class="tier-item ${stats.currentDiscount === 10 ? 'current' : ''}">
                    <div class="tier-info">50,000₽+ → 10%</div>
                </div>
            </div>
        `;
    }
}

// Функция получения следующей скидки
function getNextDiscount(currentLevel) {
    switch (currentLevel) {
        case 'Bronze': return '3%';
        case 'Silver': return '5%';
        case 'Gold': return '10%';
        default: return 'максимальной';
    }
}

// 🧪 ТЕСТОВАЯ ФУНКЦИЯ ДЛЯ ПРОВЕРКИ СИСТЕМЫ ЛОЯЛЬНОСТИ (только для разработки)
function testLoyaltySystem() {
    console.log('🧪 Тестирование системы лояльности...');
    
    // Сохраняем текущий профиль
    const originalProfile = { ...userProfile };
    
    // Тест 1: Bronze уровень (0₽)
    userProfile.totalSpent = 0;
    let loyalty = calculateLoyalty(userProfile.totalSpent);
    console.log('Test 1 - Bronze (0₽):', loyalty);
    
    // Тест 2: Silver уровень (15000₽)
    userProfile.totalSpent = 15000;
    loyalty = calculateLoyalty(userProfile.totalSpent);
    console.log('Test 2 - Silver (15000₽):', loyalty);
    
    // Тест 3: Gold уровень (30000₽)
    userProfile.totalSpent = 30000;
    loyalty = calculateLoyalty(userProfile.totalSpent);
    console.log('Test 3 - Gold (30000₽):', loyalty);
    
    // Тест 4: VIP уровень (60000₽)
    userProfile.totalSpent = 60000;
    loyalty = calculateLoyalty(userProfile.totalSpent);
    console.log('Test 4 - VIP (60000₽):', loyalty);
    
    // Тест корзины со скидкой
    cart = {
        'kolbasy_1': { categoryId: 'kolbasy', productId: '1', name: 'Тест товар', price: 1000, quantity: 2 }
    };
    
    userProfile.totalSpent = 15000; // Silver уровень
    const cartTotal = calculateCartTotal();
    console.log('Test - Корзина со скидкой Silver (3%):', cartTotal);
    
    // Восстанавливаем профиль
    userProfile = originalProfile;
    cart = {};
    console.log('✅ Тестирование завершено. Профиль восстановлен.');
}

// 🧪 ФУНКЦИЯ СБРОСА ПРОФИЛЯ (только для разработки/тестирования)
function resetUserProfile() {
    const confirmed = confirm('⚠️ Сбросить профиль пользователя? (Обнулить потрачено и заказы)');
    if (!confirmed) return;
    
    userProfile = {
        totalSpent: 0,
        totalPurchases: 0
    };
    // сохраняем и старое имя поля для совместимости
    userProfile.completedOrders = userProfile.totalPurchases;
    
    localStorage.setItem('tundra_profile', JSON.stringify(userProfile));
    localStorage.removeItem('pending_order');
    
    // Обновляем карту лояльности если открыт профиль
    const profileScreen = document.getElementById('profile-screen');
    if (profileScreen && profileScreen.classList.contains('active')) {
        updateLoyaltyCard();
    }
    
    showNotification('🔄 Профиль сброшен', 'info');
    console.log('🔄 Профиль пользователя сброшен:', userProfile);
}

// 🔄 ФУНКЦИЯ СИНХРОНИЗАЦИИ ЛОЯЛЬНОСТИ С СЕРВЕРОМ  
async function syncLoyaltyWithServer() {
    try {
        if (!window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
            console.log('⚠️ ЛОЯЛЬНОСТЬ: Нет Telegram ID для синхронизации');
            return;
        }
        
        const userId = window.Telegram.WebApp.initDataUnsafe.user.id;
        console.log(`🔄 ЛОЯЛЬНОСТЬ: Синхронизируем данные лояльности для пользователя ${userId}`);
        
        const response = await fetch(`${API_BASE}/api/loyalty/${userId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const serverStats = await response.json();
        if (serverStats && serverStats.ok) {
            // Обновляем локальный профиль данными с сервера
            userProfile.totalSpent = serverStats.data.totalSpent || 0;
            userProfile.totalPurchases = serverStats.data.totalPurchases || 0;
            userProfile.completedOrders = userProfile.totalPurchases; // совместимость
            
            // Сохраняем обновленный профиль
            localStorage.setItem('tundra_profile', JSON.stringify(userProfile));
            
            console.log('✅ ЛОЯЛЬНОСТЬ: Профиль синхронизирован с сервером:', {
                totalSpent: userProfile.totalSpent,
                totalPurchases: userProfile.totalPurchases,
                currentDiscount: serverStats.data.currentDiscount
            });
            
            // Обновляем отображение карты лояльности с серверными данными
            await updateLoyaltyCard(true);
            
            return serverStats.data;
        }
        
    } catch (error) {
        console.error('❌ ЛОЯЛЬНОСТЬ: Ошибка синхронизации с сервером:', error);
        // Продолжаем работу с локальными данными
        return null;
    }
}

// 🔄 ФУНКЦИЯ СИНХРОНИЗАЦИИ ПРОФИЛЯ С СЕРВЕРОМ
async function syncProfileWithServer() {
    try {
        const userId = getUserId();
        if (!userId) {
            console.log('⚠️ ID пользователя не найден, пропускаем синхронизацию');
            return false;
        }
        
        const response = await fetch(`${API_BASE}/api/user-purchases/${userId}`);
        
        if (response.ok) {
            const data = await response.json();
            if (data.stats) {
                // Обновляем локальный профиль данными с сервера
                userProfile.totalSpent = data.stats.totalSpent || 0;
                userProfile.totalPurchases = data.stats.totalPurchases || 0;
                userProfile.completedOrders = userProfile.totalPurchases; // совместимость
                localStorage.setItem('tundra_profile', JSON.stringify(userProfile));
                
                console.log('✅ Профиль синхронизирован с сервером:', userProfile);
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error('❌ Ошибка синхронизации профиля:', error);
        return false;
    }
}


// Добавляем тестовые функции в window для вызова из консоли
if (typeof window !== 'undefined') {
    window.testLoyaltySystem = testLoyaltySystem;
    window.resetUserProfile = resetUserProfile;
    window.syncProfileWithServer = syncProfileWithServer;
}

// 🔥 ФУНКЦИИ ДЛЯ ТАЙМЕРА ОПЛАТЫ

// Запуск таймера оплаты
function startPaymentTimer(orderId) {
    console.log('🔥 Запуск таймера оплаты для заказа:', orderId);
    
    currentOrderId = orderId;
    paymentTimeLeft = 10 * 60; // 10 минут
    
    // Обновляем UI
    showScreen('payment-waiting-screen');
    
    // Запускаем таймер обратного отсчета
    paymentTimer = setInterval(() => {
        paymentTimeLeft--;
        updateTimerDisplay();
        
        if (paymentTimeLeft <= 0) {
            cancelPaymentTimer();
            autoExpireOrder();
        }
    }, 1000);
    
    // Запускаем проверку статуса оплаты
    startPaymentStatusChecker(orderId);
    
    updateTimerDisplay();
}

// Обновление отображения таймера
function updateTimerDisplay() {
    const minutes = Math.floor(paymentTimeLeft / 60);
    const seconds = paymentTimeLeft % 60;
    const display = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    const timerElement = document.getElementById('payment-timer');
    if (timerElement) {
        timerElement.textContent = display;
        
        // Изменяем цвет таймера при критичном времени
        if (paymentTimeLeft <= 300) { // 5 минут
            timerElement.style.color = '#ff6b6b';
            timerElement.style.animation = 'blink 1s infinite';
        } else if (paymentTimeLeft <= 600) { // 10 минут
            timerElement.style.color = '#ffa500';
        }
    }
}

// Проверка статуса оплаты
function startPaymentStatusChecker(orderId) {
    console.log(`🔍 CLIENT: Запуск проверки статуса заказа ${orderId}`);
    paymentStatusChecker = setInterval(async () => {
        try {
            console.log(`🔍 CLIENT: Проверяем статус заказа ${orderId}...`);
            const response = await fetch(`${API_BASE}/api/orders/${orderId}`);
            if (response.ok) {
                const result = await response.json();
                console.log(`🔍 CLIENT: Ответ сервера для заказа ${orderId}:`, result);
                if (result.ok && result.order) {
                    const order = result.order;
                    console.log(`🔍 CLIENT: Статус заказа ${orderId}:`, {
                        status: order.status,
                        paymentStatus: order.paymentStatus,
                        total: order.totals?.total
                    });
                    
                    if (order.paymentStatus === 'paid') {
                        // Оплата прошла успешно!
                        console.log(`✅ CLIENT: Заказ ${orderId} оплачен! Переключаем на экран успеха`);
                        handleSuccessfulPayment(order);
                        return;
                    }
                    
                    // Обновляем статус
                    const statusElement = document.getElementById('payment-status');
                    if (statusElement) {
                        const statusTexts = {
                            'new': 'Ожидаем оплату...',
                            'pending': 'Обрабатываем платеж...',
                            'paid': 'Оплата получена!',
                            'cancelled': 'Заказ отменен'
                        };
                        statusElement.textContent = statusTexts[order.paymentStatus] || 'Проверяем статус...';
                    }
                }
            }
        } catch (error) {
            console.error('Ошибка проверки статуса:', error);
        }
    }, 5000); // Проверяем каждые 5 секунд
}

// Успешная оплата
function handleSuccessfulPayment(order) {
    console.log('✅ CLIENT: Оплата успешна:', order);
    
    // Останавливаем таймер и проверки
    console.log('🛑 CLIENT: Останавливаем таймер оплаты');
    cancelPaymentTimer();
    
    // ❌ ОБНОВЛЕНИЕ ПРОФИЛЯ УБРАНО - будет при завершении заказа админом
    // Профиль обновляется только когда админ нажмет "✅ Доставлен"
    console.log('💭 Профиль НЕ обновлен - ждем завершения заказа админом');
    console.log('💰 Сумма заказа для будущего начисления:', order.totals?.total || 0);
    
    // Очищаем pending order
    localStorage.removeItem('pending_order');
    
    // Показываем экран успеха
    console.log('🎉 CLIENT: Переключаем на экран успешной оплаты');
    showScreen('order-success-screen');
    
    showNotification('🎉 Заказ успешно оплачен!', 'success');
}

// Отмена таймера
function cancelPaymentTimer() {
    if (paymentTimer) {
        clearInterval(paymentTimer);
        paymentTimer = null;
    }
    
    if (paymentStatusChecker) {
        clearInterval(paymentStatusChecker);
        paymentStatusChecker = null;
    }
    
    currentOrderId = null;
}

// Автоматическая отмена заказа по истечении времени
async function autoExpireOrder() {
    console.log('⏰ Время оплаты истекло, отменяем заказ:', currentOrderId);
    
    try {
        if (currentOrderId) {
            // Отменяем заказ на сервере
            await fetch(`${API_BASE}/api/orders/${currentOrderId}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'expired' })
            });
        }
    } catch (error) {
        console.error('Ошибка отмены заказа:', error);
    }
    
    // ⚠️ ВАЖНО: При истечении времени профиль НЕ обновляется!
    // Очищаем все данные о заказе
    localStorage.removeItem('pending_order');
    
    console.log('❌ Заказ отменен по истечении времени. Профиль НЕ обновлен.');
    
    // Показываем сообщение и возвращаем к каталогу
    showNotification('⏰ Время оплаты истекло. Заказ отменен.', 'warning');
    showMain();
}

// Ручная отмена оплаты
async function cancelPayment() {
    if (!currentOrderId) return;
    
    const confirmed = confirm('Вы уверены, что хотите отменить заказ?');
    if (!confirmed) return;
    
    console.log('❌ Ручная отмена заказа:', currentOrderId);
    
    try {
        // Отменяем заказ на сервере
        await fetch(`${API_BASE}/api/orders/${currentOrderId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'cancelled' })
        });
    } catch (error) {
        console.error('Ошибка отмены заказа:', error);
    }
    
    // Останавливаем таймер
    cancelPaymentTimer();
    
    // ⚠️ ВАЖНО: При ручной отмене профиль НЕ обновляется!
    // Очищаем данные о заказе
    localStorage.removeItem('pending_order');
    
    console.log('❌ Заказ отменен вручную. Профиль НЕ обновлен.');
    
    showNotification('❌ Заказ отменен', 'info');
    showMain();
}

// Переход к оплате
function redirectToPayment() {
    if (!currentOrderId) return;
    
    showNotification('🔄 Перенаправляем на оплату...', 'info');
    
    // Получаем URL оплаты из localStorage
    const pendingOrder = localStorage.getItem('pending_order');
    if (pendingOrder) {
        try {
            const orderData = JSON.parse(pendingOrder);
            if (orderData.paymentUrl) {
                console.log('💳 Переход к оплате заказа:', currentOrderId);
                console.log('🔗 Payment URL:', orderData.paymentUrl);
                
                // Открываем страницу оплаты
                if (window.Telegram?.WebApp && window.Telegram.WebApp.openLink) {
                    window.Telegram.WebApp.openLink(orderData.paymentUrl);
                } else {
                    window.location.href = orderData.paymentUrl;
                }
                return;
            }
        } catch (error) {
            console.error('Ошибка получения paymentUrl:', error);
        }
    }
    
    showNotification('❌ Ошибка: URL оплаты не найден', 'error');
}





