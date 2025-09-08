// 🗄️ МОДУЛЬ БАЗЫ ДАННЫХ ДЛЯ TUNDRA GOURMET
const { Pool } = require('pg');
const config = require('./config');

// Создаем пул соединений с ограничениями
const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10, // Максимум 10 соединений
    min: 2,  // Минимум 2 соединения
    idle: 10000, // 10 секунд до закрытия неактивного соединения
    connectionTimeoutMillis: 10000, // 10 секунд на подключение
    idleTimeoutMillis: 30000, // 30 секунд до отключения idle соединения
});

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
                order_id VARCHAR(50) NOT NULL,
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
            order.items = JSON.parse(order.items);
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
            order.items = JSON.parse(order.items);
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
}

// 🔧 ФУНКЦИИ ДЛЯ ТОВАРОВ АДМИНКИ
class AdminProductsDB {
    // Сохранить все товары
    static async saveAll(productsData) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // Очищаем старые данные
            await client.query('DELETE FROM admin_products');
            
            // Добавляем новые
            for (const [categoryId, products] of Object.entries(productsData)) {
                for (const product of products) {
                    await client.query(
                        `INSERT INTO admin_products (category_id, product_id, product_data, is_available) 
                         VALUES ($1, $2, $3, $4)`,
                        [categoryId, product.id, JSON.stringify(product), product.available !== false]
                    );
                }
            }
            
            await client.query('COMMIT');
            console.log('✅ Товары админки сохранены в БД');
            
        } catch (error) {
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
                    console.error('❌ Неверный формат product_data:', row.product_data);
                    continue;
                }
                
                productData.available = row.is_available;
                products[row.category_id].push(productData);
            } catch (error) {
                console.error('❌ Ошибка парсинга товара:', error, 'Данные:', row.product_data);
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

// Экспортируем все функции
module.exports = {
    pool,
    initializeDatabase,
    OrdersDB,
    PurchaseHistoryDB,
    AdminProductsDB
};
