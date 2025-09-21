// 🗄️ МОДУЛЬ БАЗЫ ДАННЫХ ДЛЯ TUNDRA GOURMET
const { Pool } = require('pg');
const config = require('./config');

// Создаем оптимизированный пул соединений для высокой нагрузки
const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20, // Увеличиваем до 20 соединений для высокой нагрузки
    min: 5,  // Минимум 5 соединений
    idle: 5000, // 5 секунд до закрытия неактивного соединения
    connectionTimeoutMillis: 5000, // 5 секунд на подключение
    idleTimeoutMillis: 20000, // 20 секунд до отключения idle соединения
    acquireTimeoutMillis: 10000, // 10 секунд на получение соединения
    createTimeoutMillis: 10000, // 10 секунд на создание соединения
    destroyTimeoutMillis: 5000, // 5 секунд на закрытие соединения
    reapIntervalMillis: 1000, // Проверка каждую секунду
    createRetryIntervalMillis: 200, // Повтор каждые 200мс
});

// Кэш убран - возвращаемся к простой работе с БД

// 🔄 ФУНКЦИЯ ДЛЯ ПОВТОРНЫХ ПОПЫТОК БД ОПЕРАЦИЙ
async function retryDbOperation(operation, maxRetries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            console.error(`❌ Попытка ${attempt}/${maxRetries} провалилась:`, error.message);
            
            if (attempt === maxRetries) {
                throw error; // Последняя попытка - выбрасываем ошибку
            }
            
            // Ждем перед следующей попыткой (экспоненциальная задержка)
            const waitTime = delay * Math.pow(2, attempt - 1);
            console.log(`⏳ Ждем ${waitTime}ms перед следующей попыткой...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

// 🔧 ИНИЦИАЛИЗАЦИЯ ТАБЛИЦ
async function initializeDatabase() {
    try {
        console.log('🔄 Инициализация базы данных...');
        
        // Создаем таблицу заказов
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                order_id VARCHAR(50) UNIQUE NOT NULL,
                user_id VARCHAR(100) NOT NULL,
                user_name VARCHAR(255),
                phone VARCHAR(20),
                delivery_zone VARCHAR(50),
                address TEXT,
                items JSONB NOT NULL,
                total_amount INTEGER NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                payment_status VARCHAR(50) DEFAULT 'pending',
                payment_id VARCHAR(100),
                payment_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Добавляем колонку payment_status если её нет
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'orders' AND column_name = 'payment_status'
                ) THEN
                    ALTER TABLE orders ADD COLUMN payment_status VARCHAR(50) DEFAULT 'pending';
                END IF;
            END $$;
        `);
        
        // Создаем таблицу категорий
        await pool.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                category_id VARCHAR(50) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                image_url TEXT,
                is_visible BOOLEAN DEFAULT true,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Заполняем таблицу категорий базовыми данными
        const defaultCategories = [
            { id: 'kolbasy', name: 'Колбасы', desc: 'Сыровяленые деликатесы из оленины', order: 1 },
            { id: 'pashtet', name: 'Паштеты', desc: 'Рийеты с трюфелем и грибами', order: 2 },
            { id: 'delikatesy', name: 'Деликатесы', desc: 'Карпаччо, хамон, снеки премиум', order: 3 },
            { id: 'gotovye', name: 'Готовые деликатесы', desc: 'Запечённые корейки и окорок', order: 4 },
            { id: 'zamorozhennye', name: 'Замороженные', desc: 'Пельмени с олениной и трюфелем', order: 5 },
            { id: 'polufabrikaty', name: 'Полуфабрикаты', desc: 'Мясо для приготовления', order: 6 },
            { id: 'pirogi-sytnye', name: 'Пироги сытные', desc: 'С олениной, грибами, трюфелем', order: 7 },
            { id: 'pirogi-sladkie', name: 'Пироги сладкие', desc: 'С ягодами и творогом', order: 8 },
            { id: 'sousy-marinad', name: 'Соусы и маринады', desc: 'Авторские соусы и маринады', order: 9 },
            { id: 'napitki', name: 'Напитки', desc: 'Натуральные соки и компоты', order: 10 },
            { id: 'deserty', name: 'Десерты', desc: 'Сладкие деликатесы', order: 11 },
            { id: 'konditerka', name: 'Кондитерские изделия', desc: 'Торты, пирожные, печенье', order: 12 }
        ];
        
        for (const category of defaultCategories) {
            await pool.query(`
                INSERT INTO categories (category_id, name, description, sort_order, is_visible)
                VALUES ($1, $2, $3, $4, true)
                ON CONFLICT (category_id) DO NOTHING
            `, [category.id, category.name, category.desc, category.order]);
        }
        
        // Создаем таблицу пользователей бота
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bot_users (
                id SERIAL PRIMARY KEY,
                telegram_user_id VARCHAR(50) UNIQUE NOT NULL,
                first_name VARCHAR(255),
                last_name VARCHAR(255),
                username VARCHAR(255),
                language_code VARCHAR(10),
                is_bot BOOLEAN DEFAULT false,
                first_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true
            )
        `);
        
        // Создаем таблицу товаров админки
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_products (
                id SERIAL PRIMARY KEY,
                category_id VARCHAR(50) NOT NULL,
                product_id VARCHAR(100) NOT NULL,
                product_data JSONB NOT NULL,
                is_available BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(category_id, product_id)
            )
        `);
        
        // Создаем таблицу истории покупок для лояльности
        await pool.query(`
            CREATE TABLE IF NOT EXISTS purchase_history (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(100) NOT NULL,
                order_id VARCHAR(50) NOT NULL UNIQUE,
                customer_name VARCHAR(255),
                phone VARCHAR(20),
                amount INTEGER NOT NULL,
                items_count INTEGER DEFAULT 0,
                items_data TEXT,
                payment_id VARCHAR(100),
                purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                delivery_zone VARCHAR(20),
                address_data TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Добавляем отсутствующие колонки если их нет
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='purchase_history' AND column_name='customer_name') THEN
                    ALTER TABLE purchase_history ADD COLUMN customer_name VARCHAR(255);
                END IF;
                
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='purchase_history' AND column_name='phone') THEN
                    ALTER TABLE purchase_history ADD COLUMN phone VARCHAR(20);
                END IF;
                
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='purchase_history' AND column_name='items_count') THEN
                    ALTER TABLE purchase_history ADD COLUMN items_count INTEGER DEFAULT 0;
                END IF;
                
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='purchase_history' AND column_name='items_data') THEN
                    ALTER TABLE purchase_history ADD COLUMN items_data TEXT;
                END IF;
                
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='purchase_history' AND column_name='payment_id') THEN
                    ALTER TABLE purchase_history ADD COLUMN payment_id VARCHAR(100);
                END IF;
                
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='purchase_history' AND column_name='delivery_zone') THEN
                    ALTER TABLE purchase_history ADD COLUMN delivery_zone VARCHAR(20);
                END IF;
                
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='purchase_history' AND column_name='address_data') THEN
                    ALTER TABLE purchase_history ADD COLUMN address_data TEXT;
                END IF;
            END $$;
        `);
        
        // Создаем индексы для производительности
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
            CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
            CREATE INDEX IF NOT EXISTS idx_purchase_history_user_id ON purchase_history(user_id);
            CREATE INDEX IF NOT EXISTS idx_admin_products_category ON admin_products(category_id);
        `);
        
        
        console.log('✅ База данных инициализирована успешно');
        
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error);
        throw error;
    }
}

// 📋 ФУНКЦИИ ДЛЯ РАБОТЫ С ЗАКАЗАМИ
class OrdersDB {
    // Создать заказ
    static async create(orderData) {
        return await retryDbOperation(async () => {
            const query = `
                INSERT INTO orders (order_id, user_id, user_name, phone, delivery_zone, address, items, total_amount, status, payment_status, payment_id, payment_url)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING *
            `;
            const values = [
                orderData.orderId,
                orderData.userId,
                orderData.userName,
                orderData.phone,
                orderData.deliveryZone,
                orderData.address,
                JSON.stringify(orderData.items),
                orderData.totalAmount,
                orderData.status || 'pending',
                orderData.paymentStatus || 'pending',
                orderData.paymentId,
                orderData.paymentUrl
            ];
            
            const result = await pool.query(query, values);
            return result.rows[0];
        });
    }
    
    // Получить заказ по ID
    static async getById(orderId) {
        const query = 'SELECT * FROM orders WHERE order_id = $1';
        const result = await pool.query(query, [orderId]);
        if (result.rows.length > 0) {
            const order = result.rows[0];
            
            // Безопасный парсинг items
            try {
                order.items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
            } catch (e) {
                console.warn('⚠️ Ошибка парсинга items в getById:', e.message);
                order.items = [];
            }
            
            // Безопасный парсинг address
            try {
                order.address = typeof order.address === 'string' ? JSON.parse(order.address) : (order.address || {});
            } catch (e) {
                console.warn('⚠️ Ошибка парсинга address в getById:', e.message);
                order.address = {};
            }
            
            return order;
        }
        return null;
    }
    
    // Обновить статус заказа
    static async updateStatus(orderId, status) {
        const query = `
            UPDATE orders 
            SET status = $1, updated_at = CURRENT_TIMESTAMP 
            WHERE order_id = $2 
            RETURNING *
        `;
        const result = await pool.query(query, [status, orderId]);
        if (result.rows.length > 0) {
            const order = result.rows[0];
            
            // Безопасный парсинг items
            try {
                order.items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
            } catch (e) {
                console.warn('⚠️ Ошибка парсинга items в updateStatus:', e.message);
                order.items = [];
            }
            
            return order;
        }
        return null;
    }
    
    // Обновить заказ
    static async update(orderId, updateData) {
        const fields = [];
        const values = [];
        let paramCounter = 1;
        
        // 🔍 ЛОГИРОВАНИЕ ДАННЫХ ОБНОВЛЕНИЯ
        console.log(`🔍 OrdersDB.update: Обновляем заказ ${orderId} с данными:`, updateData);
        
        // Динамически строим запрос
        for (const [key, value] of Object.entries(updateData)) {
            if (key === 'paymentId') {
                fields.push(`payment_id = $${paramCounter}`);
            } else if (key === 'paymentUrl') {
                fields.push(`payment_url = $${paramCounter}`);
            } else if (key === 'paymentStatus') {
                fields.push(`payment_status = $${paramCounter}`);
            } else {
                fields.push(`${key} = $${paramCounter}`);
            }
            values.push(value);
            paramCounter++;
        }
        
        if (fields.length === 0) return null;
        
        fields.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(orderId);
        
        const query = `
            UPDATE orders 
            SET ${fields.join(', ')}
            WHERE order_id = $${paramCounter}
            RETURNING *
        `;
        
        const result = await pool.query(query, values);
        if (result.rows.length > 0) {
            const order = result.rows[0];
            if (order.items && typeof order.items === 'string') {
                try {
                    order.items = JSON.parse(order.items);
                } catch (e) {
                    order.items = [];
                }
            }
            
            // 🔍 ЛОГИРОВАНИЕ РЕЗУЛЬТАТА ОБНОВЛЕНИЯ
            console.log(`✅ OrdersDB.update: Заказ ${orderId} обновлен:`, {
                order_id: order.order_id,
                total_amount: order.total_amount,
                payment_status: order.payment_status,
                status: order.status
            });
            
            return order;
        }
        return null;
    }
    
    // Получить все заказы пользователя
    static async getByUserId(userId) {
        const query = 'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC';
        const result = await pool.query(query, [userId]);
        return result.rows.map(order => {
            // Безопасно парсим items
            if (typeof order.items === 'string') {
                try {
                    order.items = JSON.parse(order.items);
                } catch (e) {
                    order.items = [];
                }
            }
            return order;
        });
    }
    
    // Удалить старые заказы (например, старше 30 дней)
    static async cleanupOldOrders() {
        const query = `
            DELETE FROM orders 
            WHERE created_at < NOW() - INTERVAL '30 days' 
            AND status IN ('cancelled', 'expired')
        `;
        const result = await pool.query(query);
        return result.rowCount;
    }
    
    // Получить максимальный ID заказа
    static async getMaxOrderId() {
        const query = 'SELECT MAX(CAST(order_id AS INTEGER)) as max_id FROM orders';
        const result = await pool.query(query);
        return result.rows[0];
    }
}

// 🛒 ФУНКЦИИ ДЛЯ ИСТОРИИ ПОКУПОК
class PurchaseHistoryDB {
    // Добавить покупку в историю
    static async add(userId, orderId, amount) {
        const query = `
            INSERT INTO purchase_history (user_id, order_id, amount)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        const result = await pool.query(query, [userId, orderId, amount]);
        return result.rows[0];
    }
    
    // Получить общую сумму покупок пользователя
    static async getTotalAmount(userId) {
        const query = `
            SELECT COALESCE(SUM(amount), 0) as total_amount
            FROM purchase_history 
            WHERE user_id = $1
        `;
        const result = await pool.query(query, [userId]);
        return parseInt(result.rows[0].total_amount);
    }
    
    // Получить количество покупок пользователя
    static async getOrdersCount(userId) {
        const query = `
            SELECT COUNT(*) as orders_count
            FROM purchase_history 
            WHERE user_id = $1
        `;
        const result = await pool.query(query, [userId]);
        return parseInt(result.rows[0].orders_count);
    }
    
    // 💾 СОЗДАТЬ ЗАПИСЬ О ПОКУПКЕ (для интеграции с server.js)
    static async create(purchaseData) {
        const {
            order_id,
            user_id,
            customer_name,
            phone,
            total_amount,
            items_count,
            items_data,
            payment_id,
            delivery_zone,
            address_data
        } = purchaseData;
        
        const query = `
            INSERT INTO purchase_history (
                order_id, user_id, customer_name, phone, amount, 
                items_count, items_data, payment_id, 
                delivery_zone, address_data
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `;
        
        const values = [
            order_id,
            user_id,
            customer_name,
            phone,
            total_amount, // Сохраняем в поле amount в БД
            items_count,
            items_data,
            payment_id,
            delivery_zone,
            address_data
        ];
        
        const result = await pool.query(query, values);
        
        // Логируем для диагностики
        console.log(`🔍 PurchaseHistoryDB.create: Создана запись:`, {
            order_id: result.rows[0].order_id,
            user_id: result.rows[0].user_id,
            amount: result.rows[0].amount,
            total_amount_sent: total_amount
        });
        
        return result.rows[0];
    }
    
    // 📋 ПОЛУЧИТЬ ВСЕ ПОКУПКИ ПОЛЬЗОВАТЕЛЯ (для API)
    static async getByUserId(userId) {
        const query = `
            SELECT 
                order_id,
                customer_name,
                phone,
                amount,
                amount as totalAmount,
                items_count as itemsCount,
                items_data,
                payment_id,
                purchase_date,
                delivery_zone,
                address_data
            FROM purchase_history 
            WHERE user_id = $1 
            ORDER BY purchase_date DESC
        `;
        
        const result = await pool.query(query, [userId]);
        
        // Логируем для диагностики
        console.log(`🔍 PurchaseHistoryDB.getByUserId: Найдено ${result.rows.length} записей для пользователя ${userId}`);
        if (result.rows.length > 0) {
            console.log(`🔍 PurchaseHistoryDB.getByUserId: Первая запись:`, {
                order_id: result.rows[0].order_id,
                amount: result.rows[0].amount,
                totalAmount: result.rows[0].totalAmount
            });
        }
        
        // Парсим JSON данные
        return result.rows.map(row => {
            try {
                row.items = JSON.parse(row.items_data);
                row.address = JSON.parse(row.address_data);
                delete row.items_data;
                delete row.address_data;
                return row;
            } catch (error) {
                console.error('❌ Ошибка парсинга данных покупки:', error);
                row.items = [];
                row.address = {};
                return row;
            }
        });
    }

    // 🔥 ДОБАВИТЬ ПОКУПКУ В СИСТЕМУ ЛОЯЛЬНОСТИ (с поддержкой объекта)
    static async add(purchaseData) {
        let orderId, userId, amount;
        
        if (typeof purchaseData === 'object' && purchaseData.orderId) {
            // Новый формат с объектом
            orderId = purchaseData.orderId;
            userId = purchaseData.userId;
            amount = purchaseData.amount;
        } else {
            // Старый формат с отдельными параметрами
            userId = arguments[0];
            orderId = arguments[1];
            amount = arguments[2];
        }
        
        const query = `
            INSERT INTO purchase_history (user_id, order_id, amount)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        
        try {
            const result = await pool.query(query, [userId, orderId, amount]);
            console.log(`✅ PurchaseHistoryDB.add: Добавлена покупка ${orderId} для пользователя ${userId}, сумма: ${amount}₽`);
            return result.rows[0];
        } catch (error) {
            // Проверяем, является ли это ошибкой дубликата
            if (error.message.includes('duplicate key') || error.message.includes('unique constraint')) {
                console.log(`⚠️ PurchaseHistoryDB.add: Покупка ${orderId} уже существует`);
                return null;
            }
            console.error('❌ PurchaseHistoryDB.add: Ошибка добавления покупки:', error.message);
            throw error;
        }
    }

    // 🔍 ПРОВЕРИТЬ СУЩЕСТВОВАНИЕ ПОКУПКИ ПО ORDER_ID
    static async getByOrderId(orderId) {
        const query = `
            SELECT * FROM purchase_history 
            WHERE order_id = $1
        `;
        
        try {
            const result = await pool.query(query, [orderId]);
            return result.rows[0] || null;
        } catch (error) {
            console.error('❌ PurchaseHistoryDB.getByOrderId: Ошибка:', error.message);
            throw error;
        }
    }

    // 📊 ПОЛУЧИТЬ СТАТИСТИКУ ЛОЯЛЬНОСТИ ПОЛЬЗОВАТЕЛЯ
    static async getUserStats(userId) {
        const query = `
            SELECT 
                COUNT(*) as totalPurchases,
                COALESCE(SUM(amount), 0) as totalSpent
            FROM purchase_history 
            WHERE user_id = $1
        `;
        
        try {
            const result = await pool.query(query, [userId]);
            const stats = result.rows[0];
            
            const totalSpent = parseFloat(stats.totalspent) || 0;
            const totalPurchases = parseInt(stats.totalpurchases) || 0;
            
            // Рассчитываем текущую скидку по логике карты лояльности
            let currentDiscount = 0;
            if (totalSpent >= 50000) {
                currentDiscount = 10;
            } else if (totalSpent >= 25000) {
                currentDiscount = 5;
            } else if (totalSpent >= 10000) {
                currentDiscount = 3;
            }
            
            console.log(`📊 PurchaseHistoryDB.getUserStats для ${userId}:`, {
                totalSpent,
                totalPurchases,
                currentDiscount
            });
            
            return {
                totalSpent,
                totalPurchases,
                currentDiscount
            };
        } catch (error) {
            console.error('❌ PurchaseHistoryDB.getUserStats: Ошибка:', error.message);
            throw error;
        }
    }

}

// 🔧 ФУНКЦИИ ДЛЯ ТОВАРОВ АДМИНКИ
class AdminProductsDB {
    // Сохранить все товары
    static async saveAll(productsData) {
        // Подсчитываем общее количество товаров
        let totalProducts = 0;
        for (const [categoryId, products] of Object.entries(productsData)) {
            totalProducts += products.length;
        }
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // Используем UPSERT (INSERT ... ON CONFLICT) для обновления существующих товаров
            let savedCount = 0;
            for (const [categoryId, products] of Object.entries(productsData)) {
                for (const product of products) {
                    // Проверяем статус доступности товара
                    const isAvailable = product.available === true || product.available === undefined;
                    
                    console.log(`Сохраняем товар ${product.name}: available=${product.available}, isAvailable=${isAvailable}`);
                    
                    await client.query(
                        `INSERT INTO admin_products (category_id, product_id, product_data, is_available, updated_at) 
                         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
                         ON CONFLICT (category_id, product_id) 
                         DO UPDATE SET 
                             product_data = EXCLUDED.product_data,
                             is_available = EXCLUDED.is_available,
                             updated_at = CURRENT_TIMESTAMP`,
                        [categoryId, product.id, JSON.stringify(product), isAvailable]
                    );
                    savedCount++;
                }
            }
            
            // Удаляем товары, которых нет в новых данных
            const allProductIds = [];
            for (const [categoryId, products] of Object.entries(productsData)) {
                for (const product of products) {
                    allProductIds.push(`('${categoryId}', '${product.id}')`);
                }
            }
            
            if (allProductIds.length > 0) {
                await client.query(`
                    DELETE FROM admin_products 
                    WHERE (category_id, product_id) NOT IN (${allProductIds.join(', ')})
                `);
            }
            
            await client.query('COMMIT');
            console.log(`✅ Товары сохранены: ${savedCount} шт.`);
            
        } catch (error) {
            console.error('❌ Ошибка сохранения товаров:', error);
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
    
    // Загрузить все товары
    static async loadAll() {
        const query = 'SELECT * FROM admin_products ORDER BY category_id, product_id';
        const result = await pool.query(query);
        
        const products = {};
        for (const row of result.rows) {
            if (!products[row.category_id]) {
                products[row.category_id] = [];
            }
            
            try {
                let productData;
                if (typeof row.product_data === 'string') {
                    productData = JSON.parse(row.product_data);
                } else if (typeof row.product_data === 'object') {
                    productData = row.product_data;
                } else {
                    continue;
                }
                
                // Маппим статус из БД, если is_available null/undefined - считаем доступным по умолчанию
                productData.available = row.is_available !== false;
                products[row.category_id].push(productData);
            } catch (error) {
                continue;
            }
        }
        
        return products;
    }
    
    // Переключить доступность товара
    static async toggleAvailability(categoryId, productId) {
        const query = `
            UPDATE admin_products 
            SET is_available = NOT is_available, updated_at = CURRENT_TIMESTAMP
            WHERE category_id = $1 AND product_id = $2
            RETURNING is_available
        `;
        const result = await pool.query(query, [categoryId, productId]);
        return result.rows.length > 0 ? result.rows[0].is_available : null;
    }
}

// Класс для работы с категориями
class CategoriesDB {
    // Получить все видимые категории
    static async getVisible() {
        const query = 'SELECT * FROM categories WHERE is_visible = true ORDER BY sort_order, name';
        const result = await pool.query(query);
        return result.rows;
    }
    
    // Получить все категории (для админки)
    static async getAll() {
        const query = 'SELECT * FROM categories ORDER BY sort_order, name';
        const result = await pool.query(query);
        return result.rows;
    }
    
    // Переключить видимость категории
    static async toggleVisibility(categoryId) {
        const query = `
            UPDATE categories 
            SET is_visible = NOT is_visible, updated_at = CURRENT_TIMESTAMP
            WHERE category_id = $1
            RETURNING is_visible
        `;
        const result = await pool.query(query, [categoryId]);
        return result.rows.length > 0 ? result.rows[0].is_visible : null;
    }
    
    // Добавить/обновить категорию
    static async upsert(categoryId, name, description = '', imageUrl = '') {
        const query = `
            INSERT INTO categories (category_id, name, description, image_url, updated_at) 
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            ON CONFLICT (category_id) 
            DO UPDATE SET 
                name = EXCLUDED.name,
                description = COALESCE(NULLIF(EXCLUDED.description, ''), categories.description),
                image_url = COALESCE(NULLIF(EXCLUDED.image_url, ''), categories.image_url),
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `;
        const result = await pool.query(query, [categoryId, name, description, imageUrl]);
        return result.rows[0];
    }

    // Обновить только название категории
    static async updateName(categoryId, name) {
        const query = `
            UPDATE categories
            SET name = $2, updated_at = CURRENT_TIMESTAMP
            WHERE category_id = $1
            RETURNING *
        `;
        const result = await pool.query(query, [categoryId, name]);
        return result.rows[0];
    }
    
    // Получить статистику категорий
    static async getStats() {
        const query = `
            SELECT 
                c.category_id,
                c.name,
                c.sort_order,
                c.is_visible,
                COUNT(ap.id) as products_count,
                COUNT(CASE WHEN ap.is_available = true THEN 1 END) as available_products
            FROM categories c
            LEFT JOIN admin_products ap ON c.category_id = ap.category_id
            GROUP BY c.category_id, c.name, c.sort_order, c.is_visible
            ORDER BY c.sort_order, c.name
        `;
        const result = await pool.query(query);
        return result.rows;
    }
}

// Класс для работы с пользователями бота
class BotUsersDB {
    // Добавить или обновить пользователя
    static async upsert(userData) {
        const query = `
            INSERT INTO bot_users (
                telegram_user_id, first_name, last_name, username, 
                language_code, is_bot, last_interaction
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
            ON CONFLICT (telegram_user_id) 
            DO UPDATE SET 
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                username = EXCLUDED.username,
                language_code = EXCLUDED.language_code,
                last_interaction = CURRENT_TIMESTAMP,
                is_active = true
            RETURNING *
        `;
        
        const values = [
            userData.id?.toString(),
            userData.first_name || null,
            userData.last_name || null,
            userData.username || null,
            userData.language_code || null,
            userData.is_bot || false
        ];
        
        const result = await pool.query(query, values);
        return result.rows[0];
    }
    
    // Получить всех активных пользователей для рассылки
    static async getAllActiveUsers() {
        const query = `
            SELECT telegram_user_id, first_name, last_name, username
            FROM bot_users 
            WHERE is_active = true 
            AND telegram_user_id IS NOT NULL 
            AND telegram_user_id != ''
            ORDER BY last_interaction DESC
        `;
        
        const result = await pool.query(query);
        return result.rows;
    }

    // Пометить пользователя неактивным
    static async deactivate(telegramUserId) {
        const query = `
            UPDATE bot_users
            SET is_active = false, last_interaction = CURRENT_TIMESTAMP
            WHERE telegram_user_id = $1
        `;
        await pool.query(query, [telegramUserId?.toString()]);
    }
    
    // Получить статистику пользователей
    static async getStats() {
        const query = `
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN is_active = true THEN 1 END) as active_users,
                COUNT(CASE WHEN last_interaction > NOW() - INTERVAL '7 days' THEN 1 END) as recent_users
            FROM bot_users
        `;
        
        const result = await pool.query(query);
        return result.rows[0];
    }
}

// Экспортируем все функции
module.exports = {
    pool,
    initializeDatabase,
    OrdersDB,
    PurchaseHistoryDB,
    AdminProductsDB,
    CategoriesDB,
    BotUsersDB
};
