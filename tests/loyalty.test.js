// Тесты для services/loyalty.js (node:test). Мокаем database.js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const dbModulePath = path.resolve(__dirname, '../database.js');

function setMockDatabase(mock) {
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: mock,
  };
}

beforeEach(() => {
  // Сбрасываем кеш перед каждым тестом
  delete require.cache[require.resolve('../services/loyalty.js')];
  delete require.cache[dbModulePath];
});

test('getLoyaltyStats возвращает данные из PurchaseHistoryDB.getUserStats', async () => {
  setMockDatabase({
    PurchaseHistoryDB: {
      getUserStats: async (userId) => ({ totalSpent: 12345, totalPurchases: 7, currentDiscount: 3, _userId: userId })
    },
    OrdersDB: {}
  });

  const Loyalty = require('../services/loyalty.js');
  const stats = await Loyalty.getLoyaltyStats('u1');

  assert.deepStrictEqual(stats.totalSpent, 12345);
  assert.deepStrictEqual(stats.totalPurchases, 7);
  assert.deepStrictEqual(stats.currentDiscount, 3);
});

test('updateClientLoyalty не падает без суммы/telegramUserId и не создает запись', async () => {
  let addCalled = false;
  setMockDatabase({
    PurchaseHistoryDB: {
      getByOrderId: async () => null,
      add: async () => { addCalled = true; }
    },
    OrdersDB: {}
  });

  const Loyalty = require('../services/loyalty.js');

  await Loyalty.updateClientLoyalty({ id: '1', totals: { total: 0 }, telegramUserId: null }, console);
  assert.strictEqual(addCalled, false);
});

test('updateClientLoyalty добавляет запись если её нет', async () => {
  let added = null;
  setMockDatabase({
    PurchaseHistoryDB: {
      getByOrderId: async () => null,
      add: async (data) => { added = data; return { ok: true }; }
    },
    OrdersDB: {}
  });

  const Loyalty = require('../services/loyalty.js');
  await Loyalty.updateClientLoyalty({ id: '42', totals: { total: 510 }, telegramUserId: 'tg123' }, console);
  assert.ok(added, 'ожидали вызов add');
  assert.strictEqual(added.orderId, '42');
  assert.strictEqual(added.userId, 'tg123');
  assert.strictEqual(added.amount, 510);
});


