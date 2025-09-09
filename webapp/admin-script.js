// Базовый URL API
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:3000' 
    : 'https://tundra-miniapp-production.up.railway.app';

console.log('🔍 admin-script.js загружен');
console.log('🔍 API_BASE:', API_BASE);

// Проверяем, что все функции определены
console.log('🔍 Проверка функций:');
console.log('🔍 toggleProductAvailability:', typeof toggleProductAvailability);
console.log('🔍 saveProductsToServer:', typeof saveProductsToServer);
console.log('🔍 renderProducts:', typeof renderProducts);

// Глобальные переменные
let products = {};
let originalProducts = {};
let hasUnsavedChanges = false;
let currentEditingProduct = null;
let adminPassword = null;

// Получаем пароль из URL
function getAdminPassword() {
    if (!adminPassword) {
        const urlParams = new URLSearchParams(window.location.search);
        adminPassword = urlParams.get('password');
    }
    return adminPassword;
}

// Инициализация админ панели
document.addEventListener('DOMContentLoaded', () => {
    console.log('🔍 DOM загружен, инициализируем админ-панель');
    loadProducts();
    
    // Обработчик закрытия модального окна при клике вне его
    window.onclick = function(event) {
        const modal = document.getElementById('edit-modal');
        if (event.target === modal) {
            closeEditModal();
        }
    };
});

// Загрузка товаров
async function loadProducts() {
    try {
        showNotification('Загружаем товары...', 'info');
        
        // Пытаемся загрузить с сервера, fallback на локальные данные
        const loadedFromServer = await loadProductsFromServer();
        if (!loadedFromServer) {
            await loadProductsFromClient();
        }
        
        renderProducts();
        updateStats();
        showNotification('Товары загружены успешно!', 'success');
        
    } catch (error) {
        console.error('Ошибка загрузки товаров:', error);
        showNotification('Ошибка загрузки товаров', 'error');
    }
}

// Загрузка товаров с сервера
async function loadProductsFromServer() {
    try {
        console.log('🔍 ===== НАЧАЛО loadProductsFromServer =====');
        const password = getAdminPassword();
        if (!password) {
            console.log('⚠️ Пароль не найден, используем локальные данные');
            return false;
        }
        
        console.log('🔍 Отправляем GET запрос на:', `${API_BASE}/api/admin/products`);
        const response = await fetch(`${API_BASE}/api/admin/products`, {
            headers: { 'X-Admin-Password': password }
        });
        
        console.log('🔍 Ответ сервера:', response.status, response.statusText);
        
        if (response.ok) {
            const result = await response.json();
            console.log('🔍 Данные с сервера:', result);
            
            if (result.ok && result.products) {
                console.log('✅ Товары загружены с сервера для админ панели');
                products = result.products;
                originalProducts = JSON.parse(JSON.stringify(products));
                
                // Подсчитываем скрытые товары
                let hiddenCount = 0;
                for (const [categoryId, categoryProducts] of Object.entries(products)) {
                    for (const product of categoryProducts) {
                        if (product.available === false) {
                            hiddenCount++;
                            console.log(`🔍 Скрытый товар при загрузке: ${product.name} (${categoryId})`);
                        }
                    }
                }
                console.log(`🔍 Всего товаров: ${Object.values(products).flat().length}, скрыто: ${hiddenCount}`);
                
                return true;
            }
        }
        
        console.log('⚠️ Не удалось загрузить с сервера, используем локальные данные');
        return false;
    } catch (error) {
        console.error('❌ Ошибка загрузки с сервера:', error);
        return false;
    }
}

// Загрузка товаров из клиентского кода (все 60 товаров!)
async function loadProductsFromClient() {
    // 🔥 ПОЛНАЯ КОПИЯ ВСЕХ ТОВАРОВ ИЗ script.js
    products = {
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
    };
    
    // 🎯 ВСЕ 60 ТОВАРОВ ДОБАВЛЕНЫ! (49+11)
    // Создаем копию для отслеживания изменений
    originalProducts = JSON.parse(JSON.stringify(products));
}

// Отображение товаров
function renderProducts() {
    console.log('🔍 renderProducts: Начинаем отрисовку товаров');
    const container = document.getElementById('categories-container');
    container.innerHTML = '';
    
    const categories = {
        'kolbasy': 'Колбасы',
        'pashtet': 'Паштеты', 
        'delikatesy': 'Деликатесы',
        'gotovye': 'Готовые деликатесы',
        'zamorozhennye': 'Замороженные',
        'polufabrikaty': 'Полуфабрикаты',
        'pirogi-sytnye': 'Пироги сытные',
        'pirogi-sladkie': 'Пироги сладкие'
    };
    
    Object.keys(categories).forEach(categoryId => {
        if (!products[categoryId] || products[categoryId].length === 0) return;
        
        const categoryProducts = products[categoryId];
        const availableCount = categoryProducts.filter(p => p.available !== false).length;
        const hiddenCount = categoryProducts.filter(p => p.available === false).length;
        
        const categoryHtml = `
            <div class="category-section" data-category="${categoryId}">
                <div class="category-header">
                    <div class="category-title">${categories[categoryId]}</div>
                    <div class="category-stats">
                        Всего: ${categoryProducts.length} | 
                        В наличии: ${availableCount} | 
                        Скрыто: ${hiddenCount}
                    </div>
                </div>
                <div class="products-grid">
                    ${categoryProducts.map(product => renderProductCard(categoryId, product)).join('')}
                </div>
            </div>
        `;
        
        container.innerHTML += categoryHtml;
    });
    
    // Добавляем обработчики событий для кнопок
    setTimeout(() => {
        const toggleButtons = document.querySelectorAll('.toggle-btn');
        toggleButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                const categoryId = this.getAttribute('data-category');
                const productId = this.getAttribute('data-product');
                console.log('🔍 КНОПКА НАЖАТА через addEventListener!');
                console.log('🔍 categoryId:', categoryId);
                console.log('🔍 productId:', productId);
                toggleProductAvailability(categoryId, productId);
            });
        });
        console.log(`🔍 Добавлено ${toggleButtons.length} обработчиков событий для кнопок`);
    }, 100);
}

// Отображение карточки товара
function renderProductCard(categoryId, product) {
    const isHidden = product.available === false;
    const isModified = hasProductChanged(categoryId, product);
    
    console.log(`🔍 renderProductCard: ${product.name} (${product.id}), available: ${product.available}, isHidden: ${isHidden}`);
    
    // Экранируем специальные символы для JavaScript
    const safeCategoryId = categoryId.replace(/'/g, "\\'");
    const safeProductId = product.id.replace(/'/g, "\\'");
    
    return `
        <div class="product-card ${isHidden ? 'hidden' : ''} ${isModified ? 'modified' : ''}" 
             data-category="${categoryId}" 
             data-product="${product.id}">
            
            <div class="product-status ${isHidden ? 'hidden' : ''} ${isModified ? 'modified' : ''}">
                ${isHidden ? 'Скрыто' : isModified ? 'Изменено' : 'В наличии'}
            </div>
            
            <div class="product-header">
                <div class="product-info">
                    <div class="product-name">${product.name}</div>
                    <div class="product-price">${product.price}₽</div>
                    <div class="product-unit">${product.unit}</div>
                </div>
                <div class="product-actions">
                    <button class="toggle-btn ${isHidden ? 'hidden' : ''}" 
                            data-category="${safeCategoryId}" 
                            data-product="${safeProductId}"
                            onclick="console.log('🔍 КНОПКА НАЖАТА!'); console.log('🔍 categoryId:', '${safeCategoryId}'); console.log('🔍 productId:', '${safeProductId}'); toggleProductAvailability('${safeCategoryId}', '${safeProductId}')">
                        ${isHidden ? '👁️ Показать' : '🙈 Скрыть'}
                    </button>
                    <button class="edit-btn" onclick="editProduct('${safeCategoryId}', '${safeProductId}')">
                        ✏️ Изменить
                    </button>
                </div>
            </div>
            
            <div class="product-details">
                <div class="detail-row">
                    <span class="detail-label">Макс. кол-во:</span>
                    <span class="detail-value">${product.maxQty} шт.</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Эмодзи:</span>
                    <span class="detail-value">${product.image}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Состав:</span>
                    <span class="detail-value">${(product.composition || '').substring(0, 50)}${product.composition && product.composition.length > 50 ? '...' : ''}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Хранение:</span>
                    <span class="detail-value">${product.storage || ''}</span>
                </div>
            </div>
        </div>
    `;
}

// Проверка изменений товара
function hasProductChanged(categoryId, product) {
    const original = originalProducts[categoryId]?.find(p => p.id === product.id);
    if (!original) return false;
    
    return JSON.stringify(product) !== JSON.stringify(original);
}

// Переключение доступности товара
async function toggleProductAvailability(categoryId, productId) {
    // Проверяем, что функция вызывается
    if (typeof window !== 'undefined') {
        window.toggleProductAvailability = toggleProductAvailability;
    }
    console.log('🔍 ===== НАЧАЛО toggleProductAvailability =====');
    console.log('🔍 toggleProductAvailability вызвана:', categoryId, productId);
    console.log('🔍 Текущие products:', Object.keys(products));
    
    const product = products[categoryId].find(p => p.id === productId);
    if (!product) {
        console.error('❌ Товар не найден:', categoryId, productId);
        return;
    }
    
    console.log('🔍 Товар найден:', product.name, 'текущий статус:', product.available);
    
    product.available = !product.available;
    console.log('🔍 Новый статус товара:', product.available);
    
    markAsChanged();
    renderProducts();
    updateStats();
    
    const status = product.available ? 'показан' : 'скрыт';
    showNotification(`Товар "${product.name}" ${status}`, 'info');
    
    console.log('🔍 Пытаемся сохранить на сервер...');
    
    // 🔥 АВТОМАТИЧЕСКИ СОХРАНЯЕМ НА СЕРВЕР
    try {
        await saveProductsToServer();
        showNotification(`Товар "${product.name}" ${status} и сохранен на сервере!`, 'success');
        
        // Обновляем оригинальную копию
        originalProducts = JSON.parse(JSON.stringify(products));
        hasUnsavedChanges = false;
        document.getElementById('save-btn').disabled = true;
        
        console.log('✅ Товар успешно сохранен на сервере');
        
    } catch (error) {
        console.error('❌ Ошибка сохранения:', error);
        showNotification('Товар изменен локально, но не сохранен на сервере. Нажмите "Сохранить изменения"', 'warning');
    }
}

// Открытие модального окна редактирования
function editProduct(categoryId, productId) {
    const product = products[categoryId].find(p => p.id === productId);
    if (!product) return;
    
    currentEditingProduct = { categoryId, productId };
    
    // Заполняем форму
    document.getElementById('edit-name').value = product.name || '';
    document.getElementById('edit-price').value = product.price || '';
    document.getElementById('edit-unit').value = product.unit || '';
    document.getElementById('edit-maxQty').value = product.maxQty || '';
    document.getElementById('edit-image').value = product.image || '';
    document.getElementById('edit-imageUrl').value = product.imageUrl || '';
    document.getElementById('edit-composition').value = product.composition || '';
    document.getElementById('edit-nutrition').value = product.nutrition || '';
    document.getElementById('edit-storage').value = product.storage || '';
    document.getElementById('edit-available').checked = product.available !== false;
    
    // Показываем модальное окно
    document.getElementById('edit-modal').style.display = 'block';
}

// Сохранение изменений товара
async function saveProduct() {
    if (!currentEditingProduct) return;
    
    const { categoryId, productId } = currentEditingProduct;
    const product = products[categoryId].find(p => p.id === productId);
    if (!product) return;
    
    console.log('🔍 saveProduct вызвана для:', categoryId, productId);
    
    // Получаем данные из формы
    product.name = document.getElementById('edit-name').value;
    product.price = parseFloat(document.getElementById('edit-price').value);
    product.unit = document.getElementById('edit-unit').value;
    product.maxQty = parseInt(document.getElementById('edit-maxQty').value);
    product.image = document.getElementById('edit-image').value;
    product.imageUrl = document.getElementById('edit-imageUrl').value;
    product.composition = document.getElementById('edit-composition').value;
    product.nutrition = document.getElementById('edit-nutrition').value;
    product.storage = document.getElementById('edit-storage').value;
    product.available = document.getElementById('edit-available').checked;
    
    console.log('🔍 Товар обновлен:', product.name, 'цена:', product.price);
    
    markAsChanged();
    closeEditModal();
    renderProducts();
    updateStats();
    
    showNotification(`Товар "${product.name}" обновлен`, 'success');
    
    // Автоматически сохраняем на сервер
    try {
        console.log('🔍 Пытаемся сохранить изменения товара на сервер...');
        await saveProductsToServer();
        showNotification(`Товар "${product.name}" сохранен на сервере!`, 'success');
        
        // Обновляем оригинальную копию
        originalProducts = JSON.parse(JSON.stringify(products));
        hasUnsavedChanges = false;
        document.getElementById('save-btn').disabled = true;
        
        console.log('✅ Изменения товара успешно сохранены на сервере');
        
    } catch (error) {
        console.error('❌ Ошибка сохранения изменений товара:', error);
        showNotification('Изменения сохранены локально, но не на сервере. Нажмите "Сохранить изменения"', 'warning');
    }
}

// Закрытие модального окна
function closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
    currentEditingProduct = null;
}

// Фильтрация товаров
function filterProducts() {
    const searchTerm = document.getElementById('search-input').value.toLowerCase();
    const productCards = document.querySelectorAll('.product-card');
    
    productCards.forEach(card => {
        const productName = card.querySelector('.product-name').textContent.toLowerCase();
        const matches = productName.includes(searchTerm);
        card.style.display = matches ? 'block' : 'none';
    });
}

// Фильтрация по статусу
function filterByStatus(status) {
    // Обновляем активную кнопку
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    const productCards = document.querySelectorAll('.product-card');
    
    productCards.forEach(card => {
        const isHidden = card.classList.contains('hidden');
        let show = true;
        
        switch(status) {
            case 'available':
                show = !isHidden;
                break;
            case 'hidden':
                show = isHidden;
                break;
            case 'all':
            default:
                show = true;
                break;
        }
        
        card.style.display = show ? 'block' : 'none';
    });
}

// Отметка о наличии изменений
function markAsChanged() {
    hasUnsavedChanges = true;
    document.getElementById('save-btn').disabled = false;
}

// Сохранение всех изменений
async function saveAllChanges() {
    try {
        showNotification('Сохраняем изменения...', 'info');
        
        // Здесь будет API запрос к серверу для сохранения
        await saveProductsToServer();
        
        // Обновляем оригинальную копию
        originalProducts = JSON.parse(JSON.stringify(products));
        hasUnsavedChanges = false;
        document.getElementById('save-btn').disabled = true;
        
        renderProducts();
        showNotification('Все изменения сохранены!', 'success');
        
    } catch (error) {
        console.error('Ошибка сохранения:', error);
        showNotification('Ошибка сохранения изменений', 'error');
    }
}

// Сохранение товаров на сервер
async function saveProductsToServer() {
    const password = getAdminPassword();
    if (!password) {
        throw new Error('Пароль не найден');
    }
    
    console.log('🔍 ===== НАЧАЛО saveProductsToServer =====');
    console.log('🔍 Отправляем данные на сервер:', Object.keys(products));
    
    // Подсчитываем скрытые товары для отладки
    let hiddenCount = 0;
    let availableCount = 0;
    for (const [categoryId, categoryProducts] of Object.entries(products)) {
        for (const product of categoryProducts) {
            if (product.available === false) {
                hiddenCount++;
                console.log(`🔍 Скрытый товар: ${product.name} (${categoryId})`);
            } else {
                availableCount++;
            }
        }
    }
    console.log(`🔍 Всего товаров: ${availableCount + hiddenCount}, доступно: ${availableCount}, скрыто: ${hiddenCount}`);
    
    // API запрос к серверу
    try {
        console.log('🔍 Отправляем PUT запрос на:', `${API_BASE}/api/admin/products`);
        const response = await fetch(`${API_BASE}/api/admin/products`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'X-Admin-Password': password
            },
            body: JSON.stringify({ products })
        });
        
        console.log('🔍 Ответ сервера:', response.status, response.statusText);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Ошибка сервера:', errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const result = await response.json();
        console.log('🔍 Результат сервера:', result);
        
        if (!result.ok) {
            throw new Error(result.error || 'Ошибка сервера');
        }
        
        // Сохраняем в localStorage как backup
        localStorage.setItem('admin_products', JSON.stringify(products));
        console.log('✅ saveProductsToServer: Успешно сохранено на сервер и в localStorage');
        
    } catch (error) {
        console.error('❌ Ошибка сохранения на сервер:', error);
        // Fallback - сохраняем локально
        localStorage.setItem('admin_products', JSON.stringify(products));
        console.log('⚠️ saveProductsToServer: Fallback - сохранено только локально');
        throw error;
    }
}

// Обновление статистики
function updateStats() {
    let totalProducts = 0;
    let availableProducts = 0;
    let hiddenProducts = 0;
    
    Object.values(products).forEach(categoryProducts => {
        categoryProducts.forEach(product => {
            totalProducts++;
            if (product.available !== false) {
                availableProducts++;
            } else {
                hiddenProducts++;
            }
        });
    });
    
    document.getElementById('total-products').textContent = totalProducts;
    document.getElementById('available-products').textContent = availableProducts;
    document.getElementById('hidden-products').textContent = hiddenProducts;
}

// Показ уведомлений
function showNotification(message, type = 'info') {
    const notification = document.getElementById('admin-notification');
    notification.textContent = message;
    notification.className = `admin-notification ${type}`;
    notification.style.display = 'block';
    notification.style.opacity = '1';
    
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            notification.style.display = 'none';
        }, 300);
    }, 3000);
}

// Предупреждение о несохраненных изменениях
window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'У вас есть несохраненные изменения. Вы уверены, что хотите покинуть страницу?';
    }
});
