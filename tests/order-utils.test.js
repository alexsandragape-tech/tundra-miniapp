const { test } = require('node:test');
const assert = require('node:assert');

const { mapDbOrderToApi, mapDbOrderToList, isOrderCompletedOrPaid } = require('../services/order-utils');

test('mapDbOrderToApi корректно маппит основные поля', () => {
  const api = mapDbOrderToApi({ order_id: '10', status: 'new', payment_status: 'pending', total_amount: 3000, user_id: 'u1' });
  assert.strictEqual(api.id, '10');
  assert.strictEqual(api.status, 'new');
  assert.strictEqual(api.paymentStatus, 'pending');
  assert.strictEqual(api.totals.total, 3000);
  assert.strictEqual(api.telegramUserId, 'u1');
});

test('mapDbOrderToList формирует компактный вид', () => {
  const row = { order_id: '11', total_amount: 1500, created_at: '2025-01-01', items: [], status: 'completed', payment_status: 'paid' };
  const list = mapDbOrderToList(row);
  assert.deepStrictEqual(list, {
    order_id: '11',
    amount: 1500,
    purchase_date: '2025-01-01',
    items: [],
    status: 'completed',
    payment_status: 'paid',
  });
});

test('isOrderCompletedOrPaid учитывает только завершенные или оплаченные заказы', () => {
  assert.ok(isOrderCompletedOrPaid({ payment_status: 'paid' }));
  assert.ok(isOrderCompletedOrPaid({ status: 'completed' }));
  assert.ok(isOrderCompletedOrPaid({ status: 'delivered' }));
  assert.ok(isOrderCompletedOrPaid({ status: 'accepted', payment_status: 'paid' }));
  assert.ok(!isOrderCompletedOrPaid({ status: 'accepted', payment_status: 'pending' }));
  assert.ok(!isOrderCompletedOrPaid({ payment_id: 'p1', payment_status: 'pending' }));
  assert.ok(!isOrderCompletedOrPaid({ status: 'new', payment_status: 'pending' }));
});


