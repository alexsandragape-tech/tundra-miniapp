let products = [];
let currentFilter = 'all';
let hasUnsavedChanges = false;

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM загружен, инициализируем приложение');
    initializeApp();
});

async function initializeApp() {
    try {
        await loadProducts();
        setupEventListeners();
        console.log('Приложение инициализировано успешно');
    } catch (error) {
        console.error('Ошибка инициализации:', error);
    }
}

function setupEventListeners() {
    // Кнопки фильтрации
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const filter = this.textContent.trim();
            let filterType;
            
            if (filter === 'Все') filterType = 'all';
            else if (filter === 'В наличии') filterType = 'available';
            else if (filter === 'Скрыто') filterType = 'hidden';
            
            setActiveFilter(this);
            filterProducts(filterType);
        });
    });

    // Кнопка сохранения изменений
    const saveButton = document.querySelector('.save-btn');
    if (saveButton) {
        saveButton.addEventListener('click', function(e) {
            e.preventDefault();
            saveAllChanges();
        });
    }

    // Поиск товаров
    const searchInput = document.querySelector('.search-input');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                searchProducts(this.value);
            }, 300);
        });
    }
}

// Загрузка товаров
async function loadProducts() {
    try {
        console.log('Загружаем товары...');
        
        const response = await fetch('/api/admin/products', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            },
            credentials: 'same-origin'
        });

        console.log('Статус ответа:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Ошибка сервера:', errorText);
            throw new Error(`Сервер вернул ошибку ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('Полученные данные:', data);

        if (data && data.success && Array.isArray(data.products)) {
            products = data.products;
            console.log(`Загружено товаров: ${products.length}`);
            
            renderProducts();
            updateStatistics();
            
            // Показываем уведомление
            showNotification('Товары загружены успешно', 'success');
            
        } else {
            console.error('Неверный формат данных:', data);
            throw new Error('Неверный формат данных от сервера');
        }

    } catch (error) {
        console.error('Ошибка загрузки товаров:', error);
        showNotification('Ошибка загрузки товаров: ' + error.message, 'error');
        
        // Показываем пустое состояние
        const container = document.querySelector('.products-container');
        if (container) {
            container.innerHTML = `
                <div class="error-state">
                    <h3>Не удалось загрузить товары</h3>
                    <p>${error.message}</p>
                    <button onclick="loadProducts()" class="retry-btn">Повторить</button>
                </div>
            `;
        }
    }
}

// Отображение товаров
function renderProducts(productsToRender = products) {
    const container = document.querySelector('.products-container');
    if (!container) {
        console.error('Контейнер для товаров не найден');
        return;
    }

    if (!productsToRender || productsToRender.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>Товары не найдены</h3>
                <p>Попробуйте изменить фильтры или поисковый запрос</p>
            </div>
        `;
        return;
    }

    const html = productsToRender.map(product => createProductCard(product)).join('');
    container.innerHTML = html;
    
    // Добавляем обработчики событий для карточек товаров
    attachProductEventListeners();
    
    console.log(`Отображено товаров: ${productsToRender.length}`);
}

// Создание карточки товара
function createProductCard(product) {
    const isAvailable = product.available !== false; // по умолчанию true если не указано
    const statusClass = isAvailable ? 'available' : 'hidden';
    const statusText = isAvailable ? 'В наличии' : 'Скрыто';
    const buttonText = isAvailable ? 'Скрыть' : 'Показать';
    const buttonClass = isAvailable ? 'hide-btn' : 'show-btn';

    return `
        <div class="product-card" data-product-id="${product.id || ''}">
            <div class="product-header">
                <div class="product-status">
                    <span class="status-indicator ${statusClass}"></span>
                    <span class="status-text">${statusText}</span>
                </div>
                <div class="product-actions">
                    <button class="toggle-btn ${buttonClass}" onclick="toggleProductVisibility('${product.id}')">
                        ${buttonText}
                    </button>
                </div>
            </div>
            
            <div class="product-content">
                <div class="product-main-info">
                    <input type="text" 
                           class="product-name-input" 
                           value="${product.name || ''}" 
                           data-field="name"
                           placeholder="Название товара">
                    
                    <div class="price-container">
                        <input type="number" 
                               class="price-input" 
                               value="${product.price || 0}" 
                               data-field="price"
                               min="0"
                               step="1">
                        <span class="currency">₽</span>
                    </div>
                </div>
                
                <div class="product-details">
                    <div class="detail-group">
                        <label>Макс. количество:</label>
                        <input type="number" 
                               class="max-quantity-input" 
                               value="${product.max_quantity || 0}" 
                               data-field="max_quantity"
                               min="0">
                        <span>шт.</span>
                    </div>
                    
                    <div class="detail-group">
                        <label>Эмодзи:</label>
                        <input type="text" 
                               class="emoji-input" 
                               value="${product.emoji || ''}" 
                               data-field="emoji"
                               maxlength="10"
                               placeholder="🍕">
                    </div>
                    
                    <div class="detail-group full-width">
                        <label>Состав:</label>
                        <textarea class="composition-input" 
                                  data-field="composition" 
                                  rows="3"
                                  placeholder="Описание состава товара...">${product.composition || ''}</textarea>
                    </div>
                    
                    <div class="detail-group full-width">
                        <label>Условия хранения:</label>
                        <input type="text" 
                               class="storage-input" 
                               value="${product.storage || ''}" 
                               data-field="storage"
                               placeholder="180 суток">
                    </div>
                </div>
            </div>
            
            <div class="product-footer">
                <button class="save-product-btn" onclick="saveProduct('${product.id}')">
                    Сохранить
                </button>
                <button class="edit-product-btn" onclick="editProduct('${product.id}')">
                    Редактировать
                </button>
            </div>
        </div>
    `;
}

// Добавление обработчиков событий для карточек товаров
function attachProductEventListeners() {
    // Отслеживание изменений в полях ввода
    document.querySelectorAll('.product-card input, .product-card textarea').forEach(input => {
        input.addEventListener('input', function() {
            markProductAsChanged(this.closest('.product-card'));
        });
        
        // Автосохранение при потере фокуса
        input.addEventListener('blur', function() {
            const card = this.closest('.product-card');
            if (card && card.classList.contains('changed')) {
                const productId = card.dataset.productId;
                if (productId) {
                    debounceAutoSave(productId);
                }
            }
        });
    });
}

// Отметка товара как измененного
function markProductAsChanged(productCard) {
    if (productCard) {
        productCard.classList.add('changed');
        hasUnsavedChanges = true;
        updateSaveButtonState();
    }
}

// Debounce для автосохранения
let autoSaveTimeouts = {};
function debounceAutoSave(productId) {
    if (autoSaveTimeouts[productId]) {
        clearTimeout(autoSaveTimeouts[productId]);
    }
    
    autoSaveTimeouts[productId] = setTimeout(() => {
        autoSaveProduct(productId);
        delete autoSaveTimeouts[productId];
    }, 1000);
}

// Автосохранение товара
async function autoSaveProduct(productId) {
    try {
        await saveProduct(productId, true); // true означает автосохранение
    } catch (error) {
        console.error('Ошибка автосохранения:', error);
    }
}

// Сохранение конкретного товара
async function saveProduct(productId, isAutoSave = false) {
    if (!productId) {
        console.error('Не указан ID товара для сохранения');
        return false;
    }

    try {
        const productCard = document.querySelector(`[data-product-id="${productId}"]`);
        if (!productCard) {
            throw new Error('Карточка товара не найдена');
        }

        const productData = collectProductData(productCard);
        
        if (!isAutoSave) {
            console.log('Сохраняем товар:', productId, productData);
        }

        // Добавляем индикатор загрузки
        const saveBtn = productCard.querySelector('.save-product-btn');
        const originalText = saveBtn.textContent;
        saveBtn.textContent = 'Сохранение...';
        saveBtn.disabled = true;

        const response = await fetch(`/api/admin/products/${productId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            credentials: 'same-origin',
            body: JSON.stringify(productData)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || result.error || `HTTP ${response.status}`);
        }

        // Обновляем данные в локальном массиве
        const productIndex = products.findIndex(p => p.id === productId);
        if (productIndex !== -1) {
            products[productIndex] = { ...products[productIndex], ...productData };
        }

        // Убираем отметку об изменениях
        productCard.classList.remove('changed');
        
        if (!isAutoSave) {
            showNotification(`Товар "${productData.name}" сохранен`, 'success');
            console.log('Товар сохранен успешно:', result);
        }

        // Восстанавливаем кнопку
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;

        updateHasUnsavedChanges();
        return true;

    } catch (error) {
        console.error('Ошибка сохранения товара:', error);
        
        if (!isAutoSave) {
            showNotification('Ошибка сохранения: ' + error.message, 'error');
        }
        
        // Восстанавливаем кнопку в случае ошибки
        const productCard = document.querySelector(`[data-product-id="${productId}"]`);
        if (productCard) {
            const saveBtn = productCard.querySelector('.save-product-btn');
            if (saveBtn) {
                saveBtn.textContent = 'Сохранить';
                saveBtn.disabled = false;
            }
        }
        
        return false;
    }
}

// Сбор данных товара из формы
function collectProductData(productCard) {
    if (!productCard) {
        throw new Error('Карточка товара не найдена');
    }

    const data = {};
    
    // Собираем данные из всех полей с data-field
    productCard.querySelectorAll('[data-field]').forEach(element => {
        const fieldName = element.dataset.field;
        let value = element.value || '';
        
        // Обработка разных типов полей
        if (element.type === 'number') {
            value = parseFloat(value) || 0;
        } else if (fieldName === 'name' || fieldName === 'composition' || fieldName === 'storage' || fieldName === 'emoji') {
            value = value.trim();
        }
        
        data[fieldName] = value;
    });

    return data;
}

// Переключение видимости товара
async function toggleProductVisibility(productId) {
    if (!productId) {
        console.error('Не указан ID товара');
        return;
    }

    try {
        const product = products.find(p => p.id === productId);
        if (!product) {
            throw new Error('Товар не найден');
        }

        const newAvailability = !product.available;
        console.log(`Переключаем видимость товара ${productId}: ${product.available} -> ${newAvailability}`);

        const response = await fetch(`/api/admin/products/${productId}/toggle`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            credentials: 'same-origin',
            body: JSON.stringify({ available: newAvailability })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || result.error || `HTTP ${response.status}`);
        }

        // Обновляем локальные данные
        product.available = newAvailability;

        // Обновляем интерфейс
        const productCard = document.querySelector(`[data-product-id="${productId}"]`);
        if (productCard) {
            updateProductCardStatus(productCard, newAvailability);
        }

        updateStatistics();

        const statusText = newAvailability ? 'показан' : 'скрыт';
        showNotification(`Товар "${product.name}" ${statusText}`, 'success');
        
        console.log('Видимость товара изменена:', result);

    } catch (error) {
        console.error('Ошибка переключения видимости товара:', error);
        showNotification('Ошибка изменения статуса: ' + error.message, 'error');
    }
}

// Обновление статуса карточки товара
function updateProductCardStatus(productCard, isAvailable) {
    const statusIndicator = productCard.querySelector('.status-indicator');
    const statusText = productCard.querySelector('.status-text');
    const toggleBtn = productCard.querySelector('.toggle-btn');

    if (isAvailable) {
        statusIndicator.className = 'status-indicator available';
        statusText.textContent = 'В наличии';
        toggleBtn.textContent = 'Скрыть';
        toggleBtn.className = 'toggle-btn hide-btn';
    } else {
        statusIndicator.className = 'status-indicator hidden';
        statusText.textContent = 'Скрыто';
        toggleBtn.textContent = 'Показать';
        toggleBtn.className = 'toggle-btn show-btn';
    }
}

// Сохранение всех изменений
async function saveAllChanges() {
    try {
        const changedCards = document.querySelectorAll('.product-card.changed');
        
        if (changedCards.length === 0) {
            showNotification('Нет изменений для сохранения', 'info');
            return;
        }

        console.log(`Сохраняем ${changedCards.length} товаров...`);
        
        // Показываем индикатор загрузки
        const saveButton = document.querySelector('.save-btn');
        if (saveButton) {
            saveButton.textContent = 'Сохранение...';
            saveButton.disabled = true;
        }

        let successCount = 0;
        let errorCount = 0;

        // Сохраняем товары по одному (чтобы избежать перегрузки сервера)
        for (const card of changedCards) {
            const productId = card.dataset.productId;
            if (productId) {
                const success = await saveProduct(productId, false);
                if (success) {
                    successCount++;
                } else {
                    errorCount++;
                }
                
                // Небольшая пауза между запросами
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        // Восстанавливаем кнопку
        if (saveButton) {
            saveButton.textContent = 'Сохранить изменения';
            saveButton.disabled = false;
        }

        updateHasUnsavedChanges();

        if (errorCount === 0) {
            showNotification(`Все изменения сохранены (${successCount} товаров)`, 'success');
        } else {
            showNotification(`Сохранено ${successCount} товаров, ошибок: ${errorCount}`, 'warning');
        }

        console.log(`Сохранение завершено: успешно ${successCount}, ошибок ${errorCount}`);

    } catch (error) {
        console.error('Ошибка массового сохранения:', error);
        showNotification('Ошибка сохранения: ' + error.message, 'error');
        
        // Восстанавливаем кнопку в случае ошибки
        const saveButton = document.querySelector('.save-btn');
        if (saveButton) {
            saveButton.textContent = 'Сохранить изменения';
            saveButton.disabled = false;
        }
    }
}

// Фильтрация товаров
function filterProducts(filter) {
    currentFilter = filter;
    
    let filteredProducts;
    
    switch (filter) {
        case 'available':
            filteredProducts = products.filter(p => p.available !== false);
            break;
        case 'hidden':
            filteredProducts = products.filter(p => p.available === false);
            break;
        case 'all':
        default:
            filteredProducts = products;
            break;
    }
    
    console.log(`Фильтр "${filter}": показано ${filteredProducts.length} из ${products.length} товаров`);
    renderProducts(filteredProducts);
}

// Установка активного фильтра
function setActiveFilter(activeButton) {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    activeButton.classList.add('active');
}

// Поиск товаров
function searchProducts(query) {
    if (!query || query.trim() === '') {
        filterProducts(currentFilter);
        return;
    }
    
    const searchQuery = query.toLowerCase().trim();
    const filteredProducts = products.filter(product => {
        return (product.name && product.name.toLowerCase().includes(searchQuery)) ||
               (product.composition && product.composition.toLowerCase().includes(searchQuery)) ||
               (product.emoji && product.emoji.includes(searchQuery));
    });
    
    console.log(`Поиск "${query}": найдено ${filteredProducts.length} товаров`);
    renderProducts(filteredProducts);
}

// Обновление статистики
function updateStatistics() {
    const total = products.length;
    const available = products.filter(p => p.available !== false).length;
    const hidden = total - available;
    
    // Обновляем счетчики в шапке
    const totalElement = document.querySelector('.stat-total');
    const availableElement = document.querySelector('.stat-available');
    const hiddenElement = document.querySelector('.stat-hidden');
    
    if (totalElement) totalElement.textContent = total;
    if (availableElement) availableElement.textContent = available;
    if (hiddenElement) hiddenElement.textContent = hidden;
    
    console.log(`Статистика: всего ${total}, доступно ${available}, скрыто ${hidden}`);
}

// Проверка наличия несохраненных изменений
function updateHasUnsavedChanges() {
    hasUnsavedChanges = document.querySelectorAll('.product-card.changed').length > 0;
    updateSaveButtonState();
}

// Обновление состояния кнопки сохранения
function updateSaveButtonState() {
    const saveButton = document.querySelector('.save-btn');
    if (saveButton) {
        saveButton.disabled = !hasUnsavedChanges;
        saveButton.classList.toggle('has-changes', hasUnsavedChanges);
    }
}

// Редактирование товара (заглушка)
function editProduct(productId) {
    console.log('Редактирование товара:', productId);
    // Здесь можно добавить логику открытия модального окна редактирования
    showNotification('Функция редактирования в разработке', 'info');
}

// Система уведомлений
function showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // Создаем элемент уведомления
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <span class="notification-message">${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    // Добавляем в контейнер уведомлений или создаем его
    let container = document.querySelector('.notifications-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'notifications-container';
        document.body.appendChild(container);
    }
    
    container.appendChild(notification);
    
    // Автоматически убираем уведомление через 5 секунд
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

// Предотвращение потери данных при закрытии страницы
window.addEventListener('beforeunload', function(event) {
    if (hasUnsavedChanges) {
        event.preventDefault();
        event.returnValue = 'У вас есть несохраненные изменения. Вы уверены, что хотите покинуть страницу?';
        return event.returnValue;
    }
});

// Обработка ошибок JavaScript
window.addEventListener('error', function(event) {
    console.error('JavaScript ошибка:', event.error);
    showNotification('Произошла ошибка в приложении', 'error');
});

// Экспорт функций для использования в HTML (если нужно)
window.toggleProductVisibility = toggleProductVisibility;
window.saveProduct = saveProduct;
window.editProduct = editProduct;
window.loadProducts = loadProducts;
