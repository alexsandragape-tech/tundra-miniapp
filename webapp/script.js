// Telegram Web App MainButton and BackButton logic
let tg = window.Telegram?.WebApp;

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
            const minOrderAmount = 3500;
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
    originalShowScreen(screenId);
    updateMainButton(screenId);
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

// Базовый URL сервера (Railway)
const API_BASE = 'https://nodejs-production-64ed.up.railway.app';

// Глобальные переменные
let currentCategory = null;
let currentProduct = null;
let cart = JSON.parse(localStorage.getItem('tundra_cart') || '{}');
let userProfile = JSON.parse(localStorage.getItem('tundra_profile') || '{"totalSpent": 5700, "notificationsEnabled": true}');
let orderCounter = parseInt(localStorage.getItem('tundra_order_counter') || '125');

// Данные категорий
const categories = [
    {
        id: 'kolbasy',
        name: 'Колбасы',
        desc: 'Сыровяленые деликатесы из оленины',
        icon: '🌭',
        count: 8
    },
    {
        id: 'pashtet',
        name: 'Паштеты',
        desc: 'Рийеты с трюфелем и грибами',
        icon: '🥫',
        count: 4
    },
    {
        id: 'delikatesy',
        name: 'Деликатесы',
        desc: 'Карпаччо, хамон, снеки премиум',
        icon: '🥩',
        count: 6
    },
    {
        id: 'gotovye',
        name: 'Готовые деликатесы',
        desc: 'Запечённые корейки и окорок',
        icon: '🔥',
        count: 5
    },
    {
        id: 'zamorozhennye',
        name: 'Замороженные',
        desc: 'Пельмени с олениной и трюфелем',
        icon: '❄️',
        count: 4
    },
    {
        id: 'polufabrikaty',
        name: 'Полуфабрикаты',
        desc: 'Мясо для приготовления',
        icon: '🥓',
        count: 7
    },
    {
        id: 'pirogi-sytnye',
        name: 'Пироги сытные',
        desc: 'С олениной, грибами, трюфелем',
        icon: '🥧',
        count: 7
    },
    {
        id: 'pirogi-sladkie',
        name: 'Пироги сладкие',
        desc: 'С ягодами и творогом',
        icon: '🧁',
        count: 8
    }
];

// Данные товаров
const products = {
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
            composition: 'оленина, жир говяжий, орех кедровый, смесь специй и пряностей, соль поваренная пищевая',
            nutrition: 'белок - 15 г, жир - 20 г, углеводы - 8 г',
            calories: '540 ккал/2266 кДж',
            storage: '180 суток'
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
            maxQty: 20,
            image: '🥩',
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
            composition: 'окорок северного оленя высший сорт, смесь специй (тимьян, розмарин, кориандр), маринад (вино красное сухое, мёд), соль поваренная пищевая',
            nutrition: 'белки - 22 г, жиры - 6 г',
            calories: '160 ккал/620 кДж',
            storage: '20 суток'
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
            composition: 'фарш - оленина, масло сливочное, ежевика, соль, мускатный орех, орегано, трюфель -0,02%, Тесто – мука пшеничная в/с, вода, соль, яичный меланж, чернила каракатицы',
            nutrition: 'белки - 22 г, жиры - 6 г, углеводы - 28 г',
            calories: '220 ккал/921 кДж',
            storage: '10 месяцев'
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
            composition: 'мука в/с, яблоки натуральные, соль, сахар, яйцо, вода, масло растительное, дрожжи хлебопекарные',
            nutrition: 'Белки 9.2 г, Жиры 5.4 г, Углеводы 52.8 г',
            calories: '258.4 ккал/1184.3 кДж',
            storage: '6 месяцев'
        }
    ]
};

// Функции навигации
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
    
    // Обновляем Telegram кнопки
    if (typeof updateMainButton === 'function') {
        updateMainButton(screenId);
    }
}

function showMain() {
    showScreen('main-screen');
    updateWorkStatus();
}

function showCategory(categoryId) {
    currentCategory = categoryId;
    const category = categories.find(c => c.id === categoryId);
    document.getElementById('category-title').textContent = category.name;
    
    const productsList = document.getElementById('products-list');
    productsList.innerHTML = '';
    
    products[categoryId].forEach(product => {
        const productCard = document.createElement('div');
        productCard.className = 'product-card';
        productCard.onclick = () => showProductDetail(categoryId, product.id);
        
        // Определяем, что отображать: изображение или эмодзи
        const imageContent = product.imageUrl ? 
            `<img src="${product.imageUrl}" alt="${product.name}" class="product-image-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : '';
        const emojiContent = `<div class="product-image-emoji">${product.image}</div>`;
        
        productCard.innerHTML = `
            <div class="product-image">
                ${imageContent}
                ${emojiContent}
            </div>
            <div class="product-name">${product.name}</div>
            <div class="product-price">${product.price}₽${product.unit}</div>
            <button class="add-to-cart-btn" onclick="event.stopPropagation(); addToCart('${categoryId}', '${product.id}', 1)">
                Добавить в корзину
            </button>
        `;
        
        productsList.appendChild(productCard);
    });
    
    showScreen('category-screen');
}

function showProductDetail(categoryId, productId) {
    currentProduct = { categoryId, productId };
    const product = products[categoryId].find(p => p.id === productId);
    
    // Определяем, что отображать: изображение или эмодзи
    const detailImageContent = product.imageUrl ? 
        `<img src="${product.imageUrl}" alt="${product.name}" class="detail-image-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : '';
    const detailEmojiContent = `<div class="detail-image-emoji">${product.image}</div>`;
    
    document.getElementById('product-detail').innerHTML = `
        <div class="detail-image">
            ${detailImageContent}
            ${detailEmojiContent}
        </div>
        <div class="detail-name">${product.name}</div>
        <div class="detail-price">${product.price}₽${product.unit}</div>
        
        <div class="detail-info">
            <h4>Состав:</h4>
            <p>${product.composition}</p>
            
            <h4>Пищевая ценность:</h4>
            <p>${product.nutrition}</p>
            
            <h4>Калорийность:</h4>
            <p>${product.calories}</p>
            
            <h4>Срок хранения:</h4>
            <p>${product.storage}</p>
        </div>
        
        <div class="quantity-selector">
            <button class="qty-btn" onclick="changeDetailQuantity(-1)" id="qty-minus">-</button>
            <div class="qty-display" id="detail-quantity">1</div>
            <button class="qty-btn" onclick="changeDetailQuantity(1)" id="qty-plus">+</button>
        </div>
        
        <button class="add-to-cart-btn" onclick="addFromDetail()">
            Добавить в корзину
        </button>
    `;

    showScreen('product-detail-screen');
}

// Функция изменения количества в детальной карточке
function changeDetailQuantity(delta) {
    const qtyEl = document.getElementById('detail-quantity');
    const currentQty = parseInt(qtyEl.textContent);
    const product = products[currentProduct.categoryId].find(p => p.id === currentProduct.productId);

    const newQty = Math.max(1, Math.min(product.maxQty, currentQty + delta));
    qtyEl.textContent = newQty;
}

// Функция добавления из детальной карточки
function addFromDetail() {
    const qty = parseInt(document.getElementById('detail-quantity').textContent);
    addToCart(currentProduct.categoryId, currentProduct.productId, qty);
    showNotification('Товар добавлен в корзину!', 'success');
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
            price: product.price,
            unit: product.unit,
            image: product.image,
            imageUrl: product.imageUrl,
            maxQty: product.maxQty,
            quantity: 0
        };
    }

    const newQuantity = cart[cartKey].quantity + quantity;
    if (newQuantity > product.maxQty) {
        showNotification(`Максимальное количество: ${product.maxQty} шт.`, 'warning');
        return;
    }

    cart[cartKey].quantity = newQuantity;
    localStorage.setItem('tundra_cart', JSON.stringify(cart));
    updateCartBadge();
}

// Функция обновления счетчика корзины
function updateCartBadge() {
    const totalItems = Object.values(cart).reduce((sum, item) => sum + item.quantity, 0);
    document.getElementById('cart-badge').textContent = totalItems;
}

// Функция показа корзины
function showCart() {
    const cartContent = document.getElementById('cart-content');
    const cartItems = Object.values(cart).filter(item => item.quantity > 0);

    if (cartItems.length === 0) {
        cartContent.innerHTML = `
            <div class="empty-cart">
                <div class="empty-cart-icon">🛒</div>
                <div class="empty-cart-title">Корзина пуста</div>
                <div class="empty-cart-desc">Добавьте товары из каталога</div>
                <button class="go-shopping-btn" onclick="showMain()">
                    Перейти к покупкам
                </button>
            </div>
        `;
    } else {
        let cartHTML = '<div style="padding: 20px;">';

        cartItems.forEach(item => {
            // Определяем, что отображать: изображение или эмодзи
            const cartImageContent = item.imageUrl ? 
                `<img src="${item.imageUrl}" alt="${item.name}" class="cart-item-image-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : '';
            const cartEmojiContent = `<div class="cart-item-image-emoji">${item.image}</div>`;
            
            cartHTML += `
                <div class="cart-item">
                    <div class="cart-item-header">
                        <div class="cart-item-image">
                            ${cartImageContent}
                            ${cartEmojiContent}
                        </div>
                        <div class="cart-item-info">
                            <div class="cart-item-name">${item.name}</div>
                            <div class="cart-item-price">${item.price}₽${item.unit}</div>
                        </div>
                    </div>
                    <div class="cart-item-controls">
                        <div class="cart-qty-controls">
                            <button class="cart-qty-btn" onclick="changeCartQuantity('${item.categoryId}_${item.productId}', -1)">-</button>
                            <span class="qty-display">${item.quantity}</span>
                            <button class="cart-qty-btn" onclick="changeCartQuantity('${item.categoryId}_${item.productId}', 1)">+</button>
                        </div>
                        <div class="cart-item-total">${item.price * item.quantity}₽</div>
                    </div>
                </div>
            `;
        });

        const { subtotal, delivery, total } = calculateCartTotal();
        
        cartHTML += `
            <div class="cart-summary">
                <div class="summary-row">
                    <span>Товары:</span>
                    <span>${subtotal}₽</span>
                </div>
                <div class="summary-row">
                    <span>Доставка:</span>
                    <span>${delivery}₽</span>
                </div>
                <div class="summary-row summary-total">
                    <span>Итого:</span>
                    <span>${total}₽</span>
                </div>
                <button class="checkout-btn" onclick="proceedToOrder()" ${subtotal < 3500 ? 'disabled' : ''}>
                    Оформить заказ
                </button>
            </div>
        </div>`;

        cartContent.innerHTML = cartHTML;
    }
    
    showScreen('cart-screen');
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
    showCart(); // Перерисовываем корзину
}

// Функция расчета итогов корзины
function calculateCartTotal() {
    const subtotal = Object.values(cart).reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const deliveryZone = document.getElementById('delivery-zone')?.value;
    
    let delivery = 0;
    if (deliveryZone === 'moscow') {
        delivery = subtotal >= 5000 ? 0 : 400;
    } else if (deliveryZone === 'mo') {
        delivery = 700;
    }
    
    const total = subtotal + delivery;
    
    return { subtotal, delivery, total };
}

// Функция перехода к оформлению заказа
function proceedToOrder() {
    const { subtotal } = calculateCartTotal();
    if (subtotal < 3500) {
        showNotification('Минимальная сумма заказа: 3,500₽', 'warning');
        return;
    }
    showScreen('order-form-screen');
}

// Функция показа профиля
function showProfile() {
    showScreen('profile-screen');
}

// Функция показа моих заказов
function showMyOrders() {
    showScreen('my-orders-screen');
}

// Функция проверки рабочих часов
function isWorkingHours() {
    const now = new Date();
    const hour = now.getHours();
    return hour >= 10 && hour < 21;
}

// Функция обновления статуса работы
function updateWorkStatus() {
    const statusEl = document.getElementById('work-status');
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
    
    setTimeout(() => {
        notification.style.opacity = '0';
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
        window.Telegram.WebApp.openTelegramLink('https://t.me/nextleveluppp');
    } else {
        window.open('https://t.me/nextleveluppp', '_blank');
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
                    <strong>Минимальный заказ:</strong> 3500₽
                </div>
            </div>
        `;
    } else if (deliveryZone === 'mo') {
        deliveryInfo.innerHTML = `
            <h4>Информация о доставке</h4>
            <div class="delivery-rules">
                <div class="delivery-rule">
                    <strong>Московская область:</strong> минималка 5000₽, доставка 700₽
                </div>
                <div class="delivery-rule">
                    <strong>Минимальный заказ:</strong> 5000₽
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
                    <strong>МО:</strong> минималка 5000₽, доставка 700₽
                </div>
                <div class="delivery-rule">
                    <strong>Минимальный заказ:</strong> 3500₽
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
        orderForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // Проверяем минимальный заказ в зависимости от зоны доставки
            const deliveryZone = document.getElementById('delivery-zone').value;
            const { subtotal } = calculateCartTotal();
            
            if (deliveryZone === 'mo' && subtotal < 5000) {
                showNotification('Для Московской области минимальный заказ: 5,000₽', 'warning');
                return;
            } else if (deliveryZone === 'moscow' && subtotal < 3500) {
                showNotification('Для Москвы минимальный заказ: 3,500₽', 'warning');
                return;
            } else if (!deliveryZone) {
                showNotification('Выберите зону доставки', 'warning');
                return;
            }
            
            // Проверяем обязательные поля
            const street = document.getElementById('street').value.trim();
            const house = document.getElementById('house').value.trim();
            const phone = document.getElementById('phone').value.trim();
            
            if (!street || !house || !phone) {
                showNotification('Заполните все обязательные поля', 'warning');
                return;
            }
            
            const formData = {
                deliveryZone: deliveryZone,
                address: {
                    street: document.getElementById('street').value.trim(),
                    house: document.getElementById('house').value.trim(),
                    apartment: document.getElementById('apartment').value.trim(),
                    floor: document.getElementById('floor').value.trim(),
                    intercom: document.getElementById('intercom').value.trim()
                },
                phone: document.getElementById('phone').value.trim(),
                comment: document.getElementById('comment').value.trim(),
                cartItems: Object.values(cart).filter(i => i.quantity > 0),
                totals: calculateCartTotal()
            };

            // Показываем индикатор загрузки
            const submitBtn = e.target.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = 'Отправляем заказ...';
            submitBtn.disabled = true;
            
            try {
                const response = await fetch(`${API_BASE}/api/orders`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                if (!response.ok) throw new Error('HTTP ' + response.status);
                
                const result = await response.json();
                if (result.ok) {
                    // Заказ успешно создан на сервере
                    orderCounter = parseInt(result.orderId);
                    localStorage.setItem('tundra_order_counter', orderCounter.toString());
                    
                    // Показываем успешное сообщение
                    document.getElementById('order-number').textContent = `Номер заказа: #${orderCounter}`;
                    showScreen('order-success-screen');
                    showNotification('Заказ успешно отправлен! Ожидайте подтверждения от администратора.', 'success');
                    
                    // Очищаем корзину
                    cart = {};
                    localStorage.setItem('tundra_cart', JSON.stringify(cart));
                    updateCartBadge();
                    
                    return; // Выходим из функции
                }
            } catch (err) {
                console.error('Ошибка отправки заказа:', err);
                showNotification('Ошибка отправки заказа. Попробуйте еще раз.', 'error');
            } finally {
                // Восстанавливаем кнопку
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }

            // Fallback - если что-то пошло не так
            showNotification('Заказ не был отправлен. Попробуйте еще раз.', 'error');

            // Очищаем корзину
            cart = {};
            localStorage.setItem('tundra_cart', JSON.stringify(cart));
            updateCartBadge();

            document.getElementById('order-number').textContent = `Номер заказа: #${orderCounter}`;
            showScreen('order-success-screen');
            showNotification('Заказ отправлен. Ожидайте подтверждения!', 'success');
        });
    }
});

// Функция рендеринга категорий
function renderCategories() {
    const grid = document.getElementById('categories-grid');
    grid.innerHTML = '';

    categories.forEach(category => {
        const card = document.createElement('div');
        card.className = 'category-card';
        card.onclick = () => showCategory(category.id);

        card.innerHTML = `
            <div class="category-icon">${category.icon}</div>
            <div class="category-name">${category.name}</div>
            <div class="category-desc">${category.desc}</div>
            <div class="category-count">${category.count} товаров</div>
        `;

        grid.appendChild(card);
    });
}

// Инициализация приложения
function initApp() {
    // Показываем приветственный экран до нажатия кнопки
    showScreen('welcome-screen');

    // Рендерим категории
    renderCategories();

    // Обновляем счетчик корзины
    updateCartBadge();

    // Инициализируем Telegram Web App
    if (window.Telegram?.WebApp) {
        const user = window.Telegram.WebApp.initDataUnsafe?.user;
        if (user) {
            const profileName = document.querySelector('.profile-name');
            if (profileName) {
                profileName.textContent = user.first_name + (user.last_name ? ` ${user.last_name}` : '');
            }
        }
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



