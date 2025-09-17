// Базовый URL API
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:3000' 
    : 'https://tundra-miniapp-production.up.railway.app';

console.log('🔍 admin-script.js загружен');

// Глобальные переменные
let products = {};
let originalProducts = {};
// Карта видимости категорий из БД
let categoryVisibility = {};

// 📝 НАЗВАНИЯ КАТЕГОРИЙ ДЛЯ АДМИН-ПАНЕЛИ
const categories = {
    'kolbasy': 'Колбасы',
    'pashtet': 'Паштеты', 
    'delikatesy': 'Деликатесы',
    'gotovye': 'Готовые деликатесы',
    'zamorozhennye': 'Замороженные',
    'polufabrikaty': 'Полуфабрикаты',
    'pirogi-sytnye': 'Пироги сытные',
    'pirogi-sladkie': 'Пироги сладкие',
    // 🆕 НОВЫЕ КАТЕГОРИИ
    'sousy-marinad': 'Соусы и маринады',
    'napitki': 'Напитки',
    'deserty': 'Десерты',
    'konditerka': 'Кондитерские изделия'
};
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
    
    // ⚡ ГЛОБАЛЬНЫЕ ФУНКЦИИ ДЛЯ ONCLICK
    window.toggleProductAvailability = toggleProductAvailability;
    window.editProduct = editProduct;
    window.editCategoryName = editCategoryName;
    window.showAddProductModal = showAddProductModal;
    window.filterByStatus = filterByStatus;
    window.filterProducts = filterProducts;
    window.saveAllChanges = saveAllChanges;
    window.toggleMobileMenu = toggleMobileMenu;
    
    console.log('✅ Глобальные функции экспортированы:', {
        toggleProductAvailability: typeof window.toggleProductAvailability,
        editProduct: typeof window.editProduct,
        filterByStatus: typeof window.filterByStatus
    });
    
    loadProducts();
    // Загрузим видимость категорий для корректных подписей кнопок
    refreshCategoryVisibility().catch(() => {});
    // Загрузим актуальные названия категорий из БД и применим к UI
    loadCategoryNamesFromServer().catch(() => {});
    
    // 📱 ИНИЦИАЛИЗАЦИЯ МОБИЛЬНОГО ИНТЕРФЕЙСА
    initMobileInterface();
    
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
                // Сохраняем базовую копию названий категорий для отслеживания изменений
                if (!originalProducts.categories) {
                    originalProducts.categories = JSON.parse(JSON.stringify(categories));
                }
                
                // Параллельно подтянем актуальные названия категорий из БД
                loadCategoryNamesFromServer().catch(() => {});
                
                // Подсчитываем скрытые товары
                let hiddenCount = 0;
                for (const [categoryId, categoryProducts] of Object.entries(products)) {
                    for (const product of categoryProducts) {
                        if (product.available === false) {
                            hiddenCount++;
                        }
                    }
                }
                
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

// Загрузка актуальных названий категорий из сервера (БД)
async function loadCategoryNamesFromServer() {
    try {
        const resp = await fetch(`${API_BASE}/api/admin/categories`, {
            headers: { 'X-Admin-Password': getAdminPassword() }
        });
        if (!resp.ok) throw new Error('Не удалось загрузить категории');
        const data = await resp.json();
        if (data && Array.isArray(data.categories)) {
            data.categories.forEach(row => {
                if (row.category_id && row.name) {
                    categories[row.category_id] = row.name;
                }
            });
            // Зафиксируем как исходные названия для трекинга сохранений
            if (!originalProducts.categories) {
                originalProducts.categories = {};
            }
            originalProducts.categories = JSON.parse(JSON.stringify(categories));
            // Перерисуем UI с актуальными названиями
            renderProducts();
        }
    } catch (e) {
        console.warn('Не удалось загрузить названия категорий:', e.message);
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
        ],
        
        // 🆕 НОВЫЕ КАТЕГОРИИ (ПУСТЫЕ МАССИВЫ)
        'sousy-marinad': [],
        'napitki': [],
        'deserty': [],
        'konditerka': []
    };
    
    // 🎯 ВСЕ 60 ТОВАРОВ ДОБАВЛЕНЫ! (49+11) + 4 НОВЫЕ КАТЕГОРИИ
    // Создаем копию для отслеживания изменений
    originalProducts = JSON.parse(JSON.stringify(products));
    // Базовая копия названий категорий для последующего сравнения
    originalProducts.categories = JSON.parse(JSON.stringify(categories));
}

// Отображение товаров
function renderProducts() {
    const container = document.getElementById('categories-container');
    container.innerHTML = '';
    
    // Показываем все категории (включая пустые новые)
    Object.keys(categories).forEach(categoryId => {
        const categoryProducts = products[categoryId] || [];
        const availableCount = categoryProducts.filter(p => p.available !== false).length;
        const hiddenCount = categoryProducts.filter(p => p.available === false).length;
        const isCategoryVisible = categoryVisibility[categoryId] !== false; // по умолчанию видима
        
        const categoryHtml = `
            <div class="category-section" data-category="${categoryId}">
                <div class="category-header">
                    <div class="category-info">
                        <div class="category-title" id="category-title-${categoryId}">${categories[categoryId]}</div>
                        <div class="category-stats">
                            Всего: ${categoryProducts.length} | 
                            В наличии: ${availableCount} | 
                            Скрыто: ${hiddenCount}${isCategoryVisible ? '' : ' | Категория: скрыта'}
                        </div>
                    </div>
                    <div class="category-actions">
                        <button class="edit-category-btn" onclick="editCategoryName('${categoryId}')" title="Редактировать название категории">
                            Изменить название
                        </button>
                        <button class="edit-category-btn" 
                                onclick="toggleCategoryVisibility('${categoryId}')" title="Скрыть/Показать категорию в клиентском приложении">
                            ${isCategoryVisible ? 'Скрыть' : 'Показать'}
                        </button>
                        <button class="add-product-btn" onclick="showAddProductModal('${categoryId}')" title="Добавить товар в категорию">
                            Добавить товар
                        </button>
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
                toggleProductAvailability(categoryId, productId);
            });
        });
    }, 100);
}

// Загрузить карту видимости категорий из сервера
async function refreshCategoryVisibility() {
    try {
        const resp = await fetch(`${API_BASE}/api/admin/categories`, {
            headers: { 'X-Admin-Password': getAdminPassword() }
        });
        if (!resp.ok) throw new Error('Не удалось загрузить категории');
        const data = await resp.json();
        if (data && data.categories) {
            categoryVisibility = {};
            data.categories.forEach(c => {
                categoryVisibility[c.category_id] = c.is_visible !== false;
            });
        }
    } catch (e) {
        console.warn('Не удалось обновить видимость категорий:', e.message);
    }
}

// Отображение карточки товара
function renderProductCard(categoryId, product) {
    const isHidden = product.available === false;
    const isModified = hasProductChanged(categoryId, product);
    
    // Экранируем специальные символы для JavaScript
    const safeCategoryId = categoryId.replace(/'/g, "\\'");
    const safeProductId = product.id.replace(/'/g, "\\'");
    
    return `
        <div class="product-card ${isHidden ? 'hidden' : ''} ${isModified ? 'modified' : ''}" 
             data-category="${categoryId}" 
             data-product="${product.id}"
             data-category-id="${categoryId}"
             data-product-id="${product.id}">
            
            <div class="product-info" onclick="editProduct('${safeCategoryId}', '${safeProductId}')">
                <div class="product-name">${product.name}</div>
                <div class="product-price">${product.price}₽</div>
                <div class="product-unit">${product.unit}</div>
            </div>
            
            <div class="product-actions">
                <button class="toggle-btn ${isHidden ? 'show' : 'hide'}" 
                        data-category="${safeCategoryId}" 
                        data-product="${safeProductId}"
                        onclick="event.stopPropagation(); toggleProductAvailability('${safeCategoryId}', '${safeProductId}');">
                    ${isHidden ? 'Показать' : 'Скрыть'}
                </button>
                <div class="status-indicator ${isHidden ? 'hidden' : ''} ${isModified ? 'modified' : ''}">
                    ${isHidden ? 'Скрыто' : isModified ? 'Изменено' : 'В наличии'}
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
    console.log('🔍 toggleProductAvailability вызвана:', { categoryId, productId });
    
    // Проверяем существование категории и товара
    if (!products[categoryId]) {
        console.error('❌ Категория не найдена:', categoryId);
        return;
    }
    
    const product = products[categoryId].find(p => p.id === productId);
    if (!product) {
        console.error('❌ Товар не найден:', categoryId, productId);
        return;
    }
    
    const oldStatus = product.available;
    
    // 🔥 ИСПОЛЬЗУЕМ НОВЫЙ API ENDPOINT ПО АНАЛОГИИ С КАТЕГОРИЯМИ
    try {
        const response = await fetch(`/api/admin/products/${categoryId}/${productId}/visibility`, {
            method: 'PUT',
            headers: {
                'X-Admin-Password': getAdminPassword()
            }
        });
        
        if (!response.ok) {
            throw new Error('Ошибка изменения видимости товара');
        }
        
        const data = await response.json();
        
        // Обновляем локальные данные на основе ответа сервера
        product.available = data.isAvailable;
        
        // Показываем уведомление от сервера
        showNotification(data.message, 'success');
        
        // Перерисовываем интерфейс
        renderProducts();
        updateStats();
        
        console.log('✅ Статус товара успешно изменен и сохранен в БД');
        
    } catch (error) {
        console.error('❌ Ошибка переключения видимости товара:', error);
        showNotification('Ошибка изменения видимости товара', 'error');
        
        // НЕ откатываем изменения, так как мы их не делали локально
        console.log('Локальные данные не изменялись, откат не нужен');
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
        await saveProductsToServer();
        showNotification(`Товар "${product.name}" сохранен на сервере!`, 'success');
        
        // Обновляем оригинальную копию
        originalProducts = JSON.parse(JSON.stringify(products));
        hasUnsavedChanges = false;
        
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
    
    // Проверяем, есть ли изменения в категориях
    const hasOriginalCategories = typeof originalProducts === 'object' && originalProducts.categories;
    let useNewCategoriesEndpoint = false;
    
    // Если изменились названия категорий - используем новый endpoint
    if (hasOriginalCategories) {
        const categoriesChanged = JSON.stringify(categories) !== JSON.stringify(originalProducts.categories);
        if (categoriesChanged) {
            useNewCategoriesEndpoint = true;
        }
    }
    
    // API запрос к серверу
    try {
        let response;
        
        if (useNewCategoriesEndpoint) {
            // Сохраняем товары и категории через новый endpoint
            response = await fetch(`${API_BASE}/api/admin/categories`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Admin-Password': password
                },
                body: JSON.stringify({ products, categories })
            });
        } else {
            // Сохраняем только товары через старый endpoint
            response = await fetch(`${API_BASE}/api/admin/products`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Admin-Password': password
                },
                body: JSON.stringify({ products })
            });
        }
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Ошибка сервера:', errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const result = await response.json();
        
        if (!result.ok) {
            throw new Error(result.error || 'Ошибка сервера');
        }
        
        // Сохраняем в localStorage как backup
        localStorage.setItem('admin_products', JSON.stringify(products));
        localStorage.setItem('admin_categories', JSON.stringify(categories));
        
        // Обновляем исходную копию для отслеживания изменений
        originalProducts = JSON.parse(JSON.stringify(products));
        originalProducts.categories = JSON.parse(JSON.stringify(categories));
        
        console.log('✅ Товары и категории сохранены:', useNewCategoriesEndpoint ? 'с категориями' : 'только товары');
        
    } catch (error) {
        console.error('❌ Ошибка сохранения на сервер:', error);
        // Fallback - сохраняем локально
        localStorage.setItem('admin_products', JSON.stringify(products));
        localStorage.setItem('admin_categories', JSON.stringify(categories));
        throw error;
    }
}

// 🆕 ФУНКЦИЯ ПОКАЗА МОДАЛЬНОГО ОКНА ДОБАВЛЕНИЯ ТОВАРА
function showAddProductModal(categoryId) {
    const modal = document.getElementById('add-modal');
    const categorySelect = document.getElementById('add-category');
    
    // Заполняем select категории
    categorySelect.innerHTML = '';
    for (const [id, name] of Object.entries(categories)) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        option.selected = id === categoryId;
        categorySelect.appendChild(option);
    }
    
    // Очищаем форму
    clearAddForm();
    
    // Показываем модальное окно
    modal.style.display = 'block';
}

// 🆕 ФУНКЦИЯ ЗАКРЫТИЯ МОДАЛЬНОГО ОКНА ДОБАВЛЕНИЯ
function closeAddModal() {
    const modal = document.getElementById('add-modal');
    modal.style.display = 'none';
    clearAddForm();
}

// 🆕 ФУНКЦИЯ ОЧИСТКИ ФОРМЫ ДОБАВЛЕНИЯ
function clearAddForm() {
    document.getElementById('add-id').value = '';
    document.getElementById('add-name').value = '';
    document.getElementById('add-price').value = '';
    document.getElementById('add-unit').value = '';
    document.getElementById('add-maxQty').value = '10';
    document.getElementById('add-image').value = '';
    document.getElementById('add-imageUrl').value = '';
    document.getElementById('add-composition').value = '';
    document.getElementById('add-nutrition').value = '';
    document.getElementById('add-calories').value = '';
    document.getElementById('add-storage').value = '';
    document.getElementById('add-available').checked = true;
}

// 🆕 ФУНКЦИЯ ДОБАВЛЕНИЯ НОВОГО ТОВАРА
function addNewProduct() {
    try {
        // Получаем данные формы
        const categoryId = document.getElementById('add-category').value;
        const productId = document.getElementById('add-id').value.trim();
        const name = document.getElementById('add-name').value.trim();
        const price = parseFloat(document.getElementById('add-price').value);
        const unit = document.getElementById('add-unit').value.trim();
        const maxQty = parseInt(document.getElementById('add-maxQty').value);
        const image = document.getElementById('add-image').value.trim();
        const imageUrl = document.getElementById('add-imageUrl').value.trim();
        const composition = document.getElementById('add-composition').value.trim();
        const nutrition = document.getElementById('add-nutrition').value.trim();
        const calories = document.getElementById('add-calories').value.trim();
        const storage = document.getElementById('add-storage').value.trim();
        const available = document.getElementById('add-available').checked;
        
        // Валидация
        if (!categoryId || !productId || !name || !price || !unit || !maxQty) {
            throw new Error('Заполните все обязательные поля');
        }
        
        // Проверяем уникальность ID в категории
        if (products[categoryId] && products[categoryId].find(p => p.id === productId)) {
            throw new Error('Товар с таким ID уже существует в этой категории');
        }
        
        // Создаем новый товар
        const newProduct = {
            id: productId,
            name: name,
            price: price,
            unit: unit,
            maxQty: maxQty,
            image: image || '🛍️',
            imageUrl: imageUrl || `images/products/${categoryId}/${productId}.jpg`,
            composition: composition,
            nutrition: nutrition,
            calories: calories,
            storage: storage,
            available: available
        };
        
        // Добавляем товар в категорию
        if (!products[categoryId]) {
            products[categoryId] = [];
        }
        
        products[categoryId].push(newProduct);
        
        // Отмечаем изменения
        markAsChanged();
        
        // Перерендериваем товары
        renderProducts();
        updateStats();
        
        // Закрываем модальное окно
        closeAddModal();
        
        showNotification(`Товар "${name}" добавлен в категорию "${categories[categoryId]}"`, 'success');
        
    } catch (error) {
        console.error('Ошибка добавления товара:', error);
        showNotification(error.message, 'error');
    }
}

// 🆕 ФУНКЦИЯ АВТОЗАПОЛНЕНИЯ ID НА ОСНОВЕ НАЗВАНИЯ
function generateProductId(name) {
    return name.toLowerCase()
        .replace(/[а-я]/g, function(match) {
            const cyrillicToLatin = {
                'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
                'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
                'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
                'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
                'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
            };
            return cyrillicToLatin[match] || match;
        })
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

// 🆕 ФУНКЦИЯ РЕДАКТИРОВАНИЯ НАЗВАНИЯ КАТЕГОРИИ
function editCategoryName(categoryId) {
    const currentName = categories[categoryId];
    const titleElement = document.getElementById(`category-title-${categoryId}`);
    
    // Создаем инлайн-редактор
    const inputElement = document.createElement('input');
    inputElement.type = 'text';
    inputElement.value = currentName;
    inputElement.className = 'category-name-editor';
    inputElement.style.cssText = `
        font-size: 20px;
        font-weight: 700;
        color: #0b5c56;
        background: white;
        border: 2px solid #0b5c56;
        border-radius: 6px;
        padding: 8px 12px;
        margin: 0;
        width: 100%;
        max-width: 300px;
    `;
    
    // Заменяем заголовок на поле ввода
    titleElement.innerHTML = '';
    titleElement.appendChild(inputElement);
    
    // Создаем кнопки сохранения и отмены
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'category-edit-actions';
    actionsDiv.style.cssText = 'margin-top: 8px; display: flex; gap: 8px;';
    
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '✅ Сохранить';
    saveBtn.className = 'btn-save-category';
    saveBtn.style.cssText = `
        background: #27ae60;
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
    `;
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '❌ Отмена';
    cancelBtn.className = 'btn-cancel-category';
    cancelBtn.style.cssText = `
        background: #e74c3c;
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
    `;
    
    actionsDiv.appendChild(saveBtn);
    actionsDiv.appendChild(cancelBtn);
    titleElement.appendChild(actionsDiv);
    
    // Фокусируемся на поле ввода и выделяем текст
    inputElement.focus();
    inputElement.select();
    
    // Обработчик сохранения
    const saveCategory = () => {
        const newName = inputElement.value.trim();
        
        if (!newName) {
            showNotification('Название категории не может быть пустым', 'error');
            inputElement.focus();
            return;
        }
        
        if (newName === currentName) {
            // Имя не изменилось - просто отменяем редактирование
            cancelEdit();
            return;
        }
        
        // Обновляем название в объекте категорий
        categories[categoryId] = newName;
        
        // Восстанавливаем заголовок
        titleElement.innerHTML = `<div class="category-title" id="category-title-${categoryId}">${newName}</div>`;
        
        showNotification(`Название категории изменено на "${newName}"`, 'info');
        
        console.log('✅ Категория переименована:', categoryId, '->', newName);
        
        // Автоматически сохраняем на сервер по аналогии с товарами
        saveCategoryToServer(categoryId, newName).catch(error => {
            console.error('❌ Ошибка сохранения названия категории:', error);
            showNotification('Название изменено локально, но не сохранено на сервере', 'warning');
        });
    };
    
    // Обработчик отмены
    const cancelEdit = () => {
        titleElement.innerHTML = `<div class="category-title" id="category-title-${categoryId}">${currentName}</div>`;
    };
    
    // События для кнопок
    saveBtn.addEventListener('click', saveCategory);
    cancelBtn.addEventListener('click', cancelEdit);
    
    // События для клавиш
    inputElement.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveCategory();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
        }
    });
    
    // Отмена при клике вне поля (опционально)
    inputElement.addEventListener('blur', (e) => {
        // Проверяем, что фокус не перешел на кнопки
        if (!e.relatedTarget || (!e.relatedTarget.classList.contains('btn-save-category') && !e.relatedTarget.classList.contains('btn-cancel-category'))) {
            setTimeout(cancelEdit, 100); // Небольшая задержка для срабатывания кнопок
        }
    });
}

// 📱 МОБИЛЬНОЕ МЕНЮ
function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    const btn = document.querySelector('.mobile-menu-btn');
    
    menu.classList.toggle('active');
    btn.classList.toggle('active');
    
    // Синхронизируем поиск между мобильным и десктопным
    const mobileSearch = document.getElementById('mobile-search-input');
    const desktopSearch = document.getElementById('search-input');
    
    if (mobileSearch && desktopSearch) {
        mobileSearch.value = desktopSearch.value;
    }
}

// Закрытие мобильного меню при клике вне его
document.addEventListener('click', function(e) {
    const menu = document.getElementById('mobile-menu');
    const btn = document.querySelector('.mobile-menu-btn');
    
    if (menu && menu.classList.contains('active')) {
        if (!menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.remove('active');
            btn.classList.remove('active');
        }
    }
});

// 📱 СИНХРОНИЗАЦИЯ МОБИЛЬНОЙ СТАТИСТИКИ
function updateMobileStats() {
    // Синхронизируем статистику между десктопной и мобильной версией
    const totalProducts = document.getElementById('total-products');
    const availableProducts = document.getElementById('available-products');
    const hiddenProducts = document.getElementById('hidden-products');
    
    const mobileTotalProducts = document.getElementById('mobile-total-products');
    const mobileAvailableProducts = document.getElementById('mobile-available-products');
    const mobileHiddenProducts = document.getElementById('mobile-hidden-products');
    
    if (totalProducts && mobileTotalProducts) {
        mobileTotalProducts.textContent = totalProducts.textContent;
    }
    if (availableProducts && mobileAvailableProducts) {
        mobileAvailableProducts.textContent = availableProducts.textContent;
    }
    if (hiddenProducts && mobileHiddenProducts) {
        mobileHiddenProducts.textContent = hiddenProducts.textContent;
    }
}

// 📱 СИНХРОНИЗАЦИЯ ПОИСКА И ФИЛЬТРОВ
function syncMobileSearch() {
    const mobileSearch = document.getElementById('mobile-search-input');
    const desktopSearch = document.getElementById('search-input');
    
    if (mobileSearch && desktopSearch) {
        // Синхронизируем поиск в обе стороны
        mobileSearch.addEventListener('input', function() {
            desktopSearch.value = mobileSearch.value;
            filterProducts();
        });
        
        desktopSearch.addEventListener('input', function() {
            mobileSearch.value = desktopSearch.value;
        });
    }
}

// 📱 СИНХРОНИЗАЦИЯ ФИЛЬТРОВ
function syncMobileFilters() {
    const mobileFilterBtns = document.querySelectorAll('.mobile-filter-btn');
    const desktopFilterBtns = document.querySelectorAll('.filter-btn');
    
    // Добавляем обработчики для мобильных фильтров
    mobileFilterBtns.forEach((btn, index) => {
        btn.addEventListener('click', function() {
            // Убираем активный класс у всех мобильных кнопок
            mobileFilterBtns.forEach(b => b.classList.remove('active'));
            // Добавляем активный класс к нажатой кнопке
            btn.classList.add('active');
            
            // Синхронизируем с десктопными фильтрами
            if (desktopFilterBtns[index]) {
                desktopFilterBtns.forEach(b => b.classList.remove('active'));
                desktopFilterBtns[index].classList.add('active');
            }
            
            // Закрываем мобильное меню после выбора фильтра
            setTimeout(() => {
                toggleMobileMenu();
            }, 300);
        });
    });
}

// 📱 ИНИЦИАЛИЗАЦИЯ МОБИЛЬНОГО ИНТЕРФЕЙСА
function initMobileInterface() {
    syncMobileSearch();
    syncMobileFilters();
    
    // Обновляем статистику при загрузке
    setTimeout(updateMobileStats, 100);
    
    // Переопределяем функцию обновления статистики
    const originalUpdateStats = updateStats;
    if (typeof originalUpdateStats === 'function') {
        window.updateStats = function() {
            originalUpdateStats();
            updateMobileStats();
        };
    }
    
    // Добавляем touch-события для свайпов
    initTouchGestures();
    
    console.log('📱 Мобильный интерфейс инициализирован');
}

// 📱 TOUCH-ЖЕСТЫ И СВАЙПЫ
function initTouchGestures() {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchendX = 0;
    let touchendY = 0;
    
    // Добавляем обработчики к карточкам товаров
    document.addEventListener('touchstart', function(e) {
        if (e.target.closest('.product-card')) {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }
    }, { passive: true });
    
    document.addEventListener('touchend', function(e) {
        const productCard = e.target.closest('.product-card');
        if (productCard) {
            touchendX = e.changedTouches[0].screenX;
            touchendY = e.changedTouches[0].screenY;
            handleSwipe(productCard);
        }
    }, { passive: true });
    
    function handleSwipe(productCard) {
        const swipeDistance = touchendX - touchStartX;
        const swipeThreshold = 50; // Минимальное расстояние для свайпа
        const verticalDistance = Math.abs(touchendY - touchStartY);
        
        // Проверяем что это горизонтальный свайп
        if (verticalDistance < 30 && Math.abs(swipeDistance) > swipeThreshold) {
            const productId = productCard.dataset.productId;
            const categoryId = productCard.dataset.categoryId;
            
            if (productId && categoryId) {
                // Свайп вправо или влево - переключить товар
                toggleProductAvailability(categoryId, productId);
                const product = products[categoryId]?.find(p => p.id === productId);
                if (product) {
                    const message = product.available ? '✅ Товар показан' : '❌ Товар скрыт';
                    showMobileNotification(message, product.available ? 'success' : 'warning');
                }
                
                // Визуальная обратная связь
                productCard.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    productCard.style.transform = '';
                }, 200);
            }
        }
    }
}

// 📱 МОБИЛЬНЫЕ УВЕДОМЛЕНИЯ
function showMobileNotification(message, type = 'info') {
    // Создаем уведомление
    const notification = document.createElement('div');
    notification.className = `mobile-notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 70px;
        left: 50%;
        transform: translateX(-50%);
        background: ${type === 'success' ? '#27ae60' : type === 'warning' ? '#f39c12' : '#3498db'};
        color: white;
        padding: 12px 20px;
        border-radius: 25px;
        font-size: 14px;
        font-weight: 600;
        z-index: 10000;
        opacity: 0;
        transition: all 0.3s ease;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    `;
    
    document.body.appendChild(notification);
    
    // Анимация появления
    setTimeout(() => {
        notification.style.opacity = '1';
        notification.style.transform = 'translateX(-50%) translateY(10px)';
    }, 10);
    
    // Удаление через 2 секунды
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(-50%) translateY(-10px)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 2000);
}

// 📱 ФУНКЦИЯ ДЛЯ МОБИЛЬНЫХ СВАЙПОВ - УДАЛЕНА, ИСПОЛЬЗУЕМ ОСНОВНУЮ toggleProductAvailability

// Сохранение названия категории на сервер
async function saveCategoryToServer(categoryId, newName) {
    try {
        // Используем новый API endpoint специально для изменения названия
        const response = await fetch(`/api/admin/categories/${categoryId}/name`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Password': getAdminPassword()
            },
            body: JSON.stringify({
                name: newName
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        
        const data = await response.json();
        showNotification(data.message, 'success');
        
        console.log('✅ Название категории успешно сохранено в БД');
        
    } catch (error) {
        console.error('❌ Ошибка сохранения названия категории:', error);
        throw error; // Пробрасываем ошибку для catch в вызывающей функции
    }
}

// Автозаполнение ID при вводе названия
document.addEventListener('DOMContentLoaded', function() {
    const nameInput = document.getElementById('add-name');
    const idInput = document.getElementById('add-id');
    
    if (nameInput && idInput) {
        nameInput.addEventListener('input', function() {
            if (!idInput.value) { // Только если ID еще не заполнен
                idInput.value = generateProductId(this.value);
            }
        });
    }
});

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

// ===== УПРАВЛЕНИЕ КАТЕГОРИЯМИ =====

// Переключение вкладок
function showTab(tabName) {
    // Обновляем кнопки вкладок
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[onclick="showTab('${tabName}')"]`).classList.add('active');
    
    // Переключаем контент
    if (tabName === 'products') {
        document.getElementById('categories-container').style.display = 'block';
        document.getElementById('categories-management').style.display = 'none';
    } else if (tabName === 'categories') {
        document.getElementById('categories-container').style.display = 'none';
        document.getElementById('categories-management').style.display = 'block';
        loadCategoriesManagement();
    }
}

// Загрузка списка категорий для управления
async function loadCategoriesManagement() {
    try {
        const response = await fetch('/api/admin/categories', {
            headers: {
                'X-Admin-Password': getAdminPassword()
            }
        });
        
        if (!response.ok) {
            throw new Error('Ошибка загрузки категорий');
        }
        
        const data = await response.json();
        renderCategoriesManagement(data.categories);
        
    } catch (error) {
        console.error('Ошибка загрузки категорий:', error);
        document.getElementById('categories-list').innerHTML = `
            <div style="text-align: center; padding: 40px; color: #666;">
                ❌ Ошибка загрузки категорий: ${error.message}
            </div>
        `;
    }
}

// Отображение списка категорий
function renderCategoriesManagement(categories) {
    const container = document.getElementById('categories-list');
    
    if (!categories || categories.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #666;">
                Категории не найдены. Сначала добавьте товары.
            </div>
        `;
        return;
    }
    
    container.innerHTML = categories.map(category => `
        <div class="category-item">
            <div class="category-info">
                <div class="category-details">
                    <h3>${category.name || category.category_id}</h3>
                    <div class="category-stats">
                        ${category.products_count || 0} товаров, 
                        ${category.available_products || 0} доступно
                    </div>
                </div>
            </div>
            <div class="category-actions">
                <button class="visibility-toggle ${category.is_visible ? 'visible' : ''}" 
                        onclick="toggleCategoryVisibility('${category.category_id}')">
                    ${category.is_visible ? 'Скрыть' : 'Показать'}
                </button>
            </div>
        </div>
    `).join('');
}

// Переключение видимости категории
async function toggleCategoryVisibility(categoryId) {
    try {
        const response = await fetch(`/api/admin/categories/${categoryId}/visibility`, {
            method: 'PUT',
            headers: {
                'X-Admin-Password': getAdminPassword()
            }
        });
        
        if (!response.ok) {
            throw new Error('Ошибка изменения видимости');
        }
        
        const data = await response.json();
        
        // Показываем уведомление
        showNotification(data.message, 'success');
        
        // Обновляем карту видимости и перерисовываем и список и карточки
        await refreshCategoryVisibility();
        loadCategoriesManagement();
        renderProducts();
        
    } catch (error) {
        console.error('Ошибка переключения видимости:', error);
        showNotification('❌ ' + error.message, 'error');
    }
}

// Показ уведомлений (если функция еще не существует)
function showNotification(message, type = 'info') {
    // Создаем элемент уведомления
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        transition: all 0.3s ease;
        max-width: 300px;
    `;
    
    // Устанавливаем цвет в зависимости от типа
    switch (type) {
        case 'success':
            notification.style.backgroundColor = '#4caf50';
            break;
        case 'error':
            notification.style.backgroundColor = '#f44336';
            break;
        case 'warning':
            notification.style.backgroundColor = '#ff9800';
            break;
        default:
            notification.style.backgroundColor = '#2196f3';
    }
    
    document.body.appendChild(notification);
    
    // Убираем через 3 секунды
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}
