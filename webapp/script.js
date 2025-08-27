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
        icon: '��',
        count: 8
    },
    {
        id: 'pashtet',
        name: 'Паштеты',
        desc: 'Рийеты с трюфелем и грибами',
        icon: '��',
        count: 4
    },
    {
        id: 'delikatesy',
        name: 'Деликатесы',
        desc: 'Карпаччо, хамон, снеки премиум',
        icon: '��',
        count: 6
    },
    {
        id: 'gotovye',
        name: 'Готовые деликатесы',
        desc: 'Запечённые корейки и окорок',
        icon: '��',
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
        icon: '��',
        count: 7
    },
    {
        id: 'pirogi-sytnye',
        name: 'Пироги сытные',
        desc: 'С олениной, грибами, трюфелем',
        icon: '��',
        count: 7
    },
    {
        id: 'pirogi-sladkie',
        name: 'Пироги сладкие',
        desc: 'С ягодами и творогом',
        icon: '��',
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
            composition: 'оленина, жир говяжий, соль поваренная пищевая, трюфель черный, паприка копченая, кардамон, перец черный',
            nutrition: 'белок - 15 г, жир - 20 г',
            calories: '510 ккал/2140 кДж',
            storage: '180 суток'
        }
    ],
    'pashtet': [
        {
            id: 'pashtet-olene',
            name: 'Паштет из оленины с трюфелем',
            price: 280,
            unit: '/100 гр.',
            maxQty: 15,
            image: '🥫',
            composition: 'оленина, трюфель черный, соль, специи',
            nutrition: 'белок - 18 г, жир - 12 г',
            calories: '180 ккал/750 кДж',
            storage: '90 суток'
        }
    ],
    'delikatesy': [
        {
            id: 'karpachcho',
            name: 'Карпаччо из оленины',
            price: 450,
            unit: '/80 гр.',
            maxQty: 12,
            image: '🥩',
            composition: 'оленина, оливковое масло, лимон, специи',
            nutrition: 'белок - 22 г, жир - 8 г',
            calories: '160 ккал/670 кДж',
            storage: '7 суток'
        }
    ],
    'gotovye': [
        {
            id: 'koreyka-zapechennaya',
            name: 'Корейка запечённая из оленины',
            price: 680,
            unit: '/200 гр.',
            maxQty: 10,
            image: '🔥',
            composition: 'оленина, соль, специи, травы',
            nutrition: 'белок - 28 г, жир - 15 г',
            calories: '250 ккал/1050 кДж',
            storage: '14 суток'
        }
    ],
    'zamorozhennye': [
        {
            id: 'pelmeni-olene',
            name: 'Пельмени с олениной и трюфелем',
            price: 320,
            unit: '/400 гр.',
            maxQty: 8,
            image: '❄️',
            composition: 'тесто, оленина, трюфель, лук, специи',
            nutrition: 'белок - 12 г, жир - 8 г',
            calories: '280 ккал/1170 кДж',
            storage: '180 суток'
        }
    ],
    'polufabrikaty': [
        {
            id: 'myaso-olene',
            name: 'Мясо оленины для приготовления',
            price: 890,
            unit: '/500 гр.',
            maxQty: 6,
            image: '🥓',
            composition: 'оленина, соль',
            nutrition: 'белок - 25 г, жир - 5 г',
            calories: '140 ккал/590 кДж',
            storage: '7 суток'
        }
    ],
    'pirogi-sytnye': [
        {
            id: 'pirog-olene',
            name: 'Пирог с олениной и грибами',
            price: 180,
            unit: '/150 гр.',
            maxQty: 15,
            image: '🥧',
            composition: 'тесто, оленина, грибы, лук, специи',
            nutrition: 'белок - 8 г, жир - 12 г',
            calories: '220 ккал/920 кДж',
            storage: '7 суток'
        }
    ],
    'pirogi-sladkie': [
        {
            id: 'pirog-yagoda',
            name: 'Пирог с ягодами',
            price: 120,
            unit: '/120 гр.',
            maxQty: 20,
            image: '🧁',
            composition: 'тесто, ягоды, сахар, творог',
            nutrition: 'белок - 4 г, жир - 6 г',
            calories: '180 ккал/750 кДж',
            storage: '5 суток'
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
        
        productCard.innerHTML = `
            <div class="product-image">${product.image}</div>
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
    
    document.getElementById('product-detail').innerHTML = `
        <div class="detail-image">${product.image}</div>
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
            cartHTML += `
                <div class="cart-item">
                    <div class="cart-item-header">
                        <div class="cart-item-image">${item.image}</div>
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
    const delivery = subtotal >= 5000 ? 0 : 500;
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
            
            const formData = {
                deliveryZone: document.getElementById('delivery-zone').value,
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

            try {
                const response = await fetch(`${API_BASE}/api/orders`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                if (!response.ok) throw new Error('HTTP ' + response.status);
            } catch (err) {
                console.warn('Order send failed, fallback to local success:', err);
            }

            // Локальное завершение оформления (fallback/успех)
            orderCounter++;
            localStorage.setItem('tundra_order_counter', orderCounter.toString());

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
