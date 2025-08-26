// Телеграм кнопки и интеграция Mini App
(function () {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    try {
        tg.ready();
        tg.expand();
    } catch (_) {}

    // Управление MainButton в зависимости от экрана
    function syncButtons() {
        const isCart = document.getElementById('cart-screen')?.classList.contains('active');
        const isOrder = document.getElementById('order-form-screen')?.classList.contains('active');

        if (isOrder) {
            tg.MainButton.setText('Отправить заказ');
            tg.MainButton.show();
        } else if (isCart) {
            tg.MainButton.setText('Оформить заказ');
            tg.MainButton.show();
        } else {
            tg.MainButton.hide();
        }
    }

    // BackButton
    function syncBackButton() {
        const isMain = document.getElementById('main-screen')?.classList.contains('active');
        if (isMain) tg.BackButton.hide(); else tg.BackButton.show();
    }

    // Слушаем клики по MainButton
    tg.MainButton.onClick(() => {
        const isCart = document.getElementById('cart-screen')?.classList.contains('active');
        const isOrder = document.getElementById('order-form-screen')?.classList.contains('active');

        if (isCart) {
            // Переход к оформлению
            if (typeof window.proceedToOrder === 'function') window.proceedToOrder();
        } else if (isOrder) {
            // Сабмит формы
            const form = document.getElementById('orderForm');
            if (form) form.requestSubmit();
        }
    });

    tg.BackButton.onClick(() => {
        // Имитируем «назад» в зависимости от текущего экрана
        const pd = document.getElementById('product-detail-screen')?.classList.contains('active');
        const cat = document.getElementById('category-screen')?.classList.contains('active');
        const cart = document.getElementById('cart-screen')?.classList.contains('active');
        const profile = document.getElementById('profile-screen')?.classList.contains('active');
        const myOrders = document.getElementById('my-orders-screen')?.classList.contains('active');
        const order = document.getElementById('order-form-screen')?.classList.contains('active');

        if (pd && typeof window.goBackFromProduct === 'function') return window.goBackFromProduct();
        if (cat && typeof window.showMain === 'function') return window.showMain();
        if (cart && typeof window.showMain === 'function') return window.showMain();
        if (order && typeof window.showCart === 'function') return window.showCart();
        if (myOrders && typeof window.showProfile === 'function') return window.showProfile();
        if (profile && typeof window.showMain === 'function') return window.showMain();
    });

    // Пересинхронизация кнопок при каждом переключении экрана
    const observer = new MutationObserver(syncButtons);
    document.querySelectorAll('.screen').forEach(el => {
        observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    document.addEventListener('DOMContentLoaded', () => {
        syncButtons();
        syncBackButton();
    });
})();


