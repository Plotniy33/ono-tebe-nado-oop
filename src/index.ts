import './scss/styles.scss';

import { AuctionAPI } from './components/AuctionAPI';
import { API_URL, CDN_URL } from './utils/constants';
import { EventEmitter } from './components/base/events';
import { cloneTemplate, createElement, ensureElement } from './utils/utils';
import { AppState, CatalogChangeEvent, LotItem } from './components/AppData';
import { Page } from './components/Page';
import { Auction, AuctionItem, BidItem, CatalogItem } from './components/Card';
import { Success } from './components/common/Success';
import { Modal } from './components/common/Modal';
import { IOrderForm } from './types';
import { Order } from './components/Order';
import { Basket } from './components/common/Basket';
import { Tabs } from './components/common/Tabs';

const events = new EventEmitter();
const api = new AuctionAPI(CDN_URL, API_URL);

// Чтобы мониторить все события, для отладки
events.onAll(({ eventName, data }) => {
	console.log(eventName, data);
});

// Все шаблоны
const cardCatalogTemplate = ensureElement<HTMLTemplateElement>('#card');
const successTemplate = ensureElement<HTMLTemplateElement>('#success');
const orderTemplate = ensureElement<HTMLTemplateElement>('#order');
const cardBasketTemplate = ensureElement<HTMLTemplateElement>('#bid');
const bidsTemplate = ensureElement<HTMLTemplateElement>('#bids');
const basketTemplate = ensureElement<HTMLTemplateElement>('#basket');
const tabsTemplate = ensureElement<HTMLTemplateElement>('#tabs');
const soldTemplate = ensureElement<HTMLTemplateElement>('#sold');
const cardPreviewTemplate = ensureElement<HTMLTemplateElement>('#preview');
const auctionTemplate = ensureElement<HTMLTemplateElement>('#auction');

// Модель данных приложения
const appData = new AppState({}, events);

// Глобальные контейнеры
const page = new Page(document.body, events);
const modal = new Modal(ensureElement<HTMLElement>('#modal-container'), events);

const order = new Order(cloneTemplate(orderTemplate), events);

// Переиспользуемые части интерфейса
const bids = new Basket(cloneTemplate(bidsTemplate), events);
const basket = new Basket(cloneTemplate(basketTemplate), events);
const tabs = new Tabs(cloneTemplate(tabsTemplate), {
	onClick: (name) => {
		if (name === 'closed') events.emit('basket:open');
		else events.emit('bids:open');
	},
});

// Дальше идет бизнес-логика
// Поймали событие, сделали что нужно

// Изменились элементы каталога
events.on<CatalogChangeEvent>('items:changed', () => {
	page.catalog = appData.catalog.map((item) => {
		const card = new CatalogItem(cloneTemplate(cardCatalogTemplate), {
			onClick: () => events.emit('card:select', item),
		});
		return card.render({
			title: item.title,
			image: item.image,
			description: item.about,
			status: {
				status: item.status,
				label: item.statusLabel,
			},
		});
	});
	page.counter = appData.getClosedLots().length;
});

// Отправлена форма заказа
events.on('order:submit', () => {
	api
		.orderLots(appData.order)
		.then((result) => {
			const success = new Success(cloneTemplate(successTemplate), {
				onClick: () => {
					modal.close();
					appData.clearBasket();
					events.emit('auction:changed');
				},
			});
			modal.render({ content: success.render({}) });
		})
		.catch((err) => {
			console.log(err);
		});
});

// Изменилось сост валидации формы
events.on('formErrors:change', (errors: Partial<IOrderForm>) => {
	const { email, phone } = errors;
	order.valid = !email && !phone;
	order.errors = Object.values({ phone, email })
		.filter((i) => !!i)
		.join('; ');
});

// Изменилось однно из полей
events.on(
	/^order\..*:change/,
	(data: { field: keyof IOrderForm; value: string }) => {
		appData.setOrderField(data.field, data.value);
	}
);

// Открыть форму заказа
events.on('order:open', () => {
	modal.render({
		content: order.render({
			phone: '',
			email: '',
			valid: false,
			errors: [],
		}),
	});
});

// Открыть активные лоты
events.on('bids:open', () => {
	modal.render({
		content: createElement<HTMLElement>('div', {}, [
			tabs.render({
				selected: 'active',
			}),
			bids.render(),
		]),
	});
});

// Открыть закрытые лоты
events.on('basket:open', () => {
	modal.render({
		content: createElement<HTMLElement>('div', {}, [
			tabs.render({
				selected: 'closed',
			}),
			basket.render(),
		]),
	});
});

// Изменения в лоте, пересчитать
events.on('auction:changed', () => {
	page.counter = appData.getClosedLots().length;
	bids.items = appData.getActiveLots().map((item) => {
		const card = new BidItem(cloneTemplate(cardBasketTemplate), {
			onClick: () => events.emit('preview:changed', item),
		});
		return card.render({
			title: item.title,
			image: item.image,
			status: {
				amount: item.price,
				status: item.isMyBid,
			},
		});
	});
	let total = 0;
	basket.items = appData.getClosedLots().map((item) => {
		const card = new BidItem(cloneTemplate(soldTemplate), {
			onClick: (event) => {
				const checkBox = event.target as HTMLInputElement;
				appData.toggleOrderedLot(item.id, checkBox.checked);
				basket.total = appData.getTotal();
				basket.selected = appData.order.items;
			},
		});
		return card.render({
			title: item.title,
			image: item.image,
			status: {
				amount: item.price,
				status: item.isMyBid,
			},
		});
	});
	basket.selected = appData.order.items;
	basket.total = total;
});

// Открыть лот
events.on('card:select', (item: LotItem) => {
	appData.setPreview(item);
});

// Изменен открытый выбранныйлот
events.on('preview:changed', (item: LotItem) => {
	const showItem = (item: LotItem) => {
		const card = new AuctionItem(cloneTemplate(cardPreviewTemplate));
		const auction = new Auction(cloneTemplate(auctionTemplate), {
			onSubmit: (price) => {
				item.placeBid(price);
				auction.render({
					status: item.status,
					time: item.timeStatus,
					nextBid: item.nextBid,
					history: item.history,
				});
			},
		});
		modal.render({
			content: card.render({
				title: item.title,
				image: item.image,
				description: item.description.split('\n'),
				status: auction.render({
					status: item.status,
					time: item.timeStatus,
					label: item.auctionStatus,
					nextBid: item.nextBid,
					history: item.history,
				}),
			}),
		});
		if (item.status === 'active') {
			auction.focus();
		}
	};

	if (item) {
		api
			.getLotItem(item.id)
			.then((result) => {
				item.description = result.description;
				item.history = result.history;
				showItem(item);
			})
			.catch((err) => {
				console.error(err);
			});
	} else {
		modal.close();
	}
});

// <локируем прокрутку страницы при открытой модалке
events.on('modal:open', () => {
	page.locked = true;
});

// Разблокируем
events.on('modal:close', () => {
	page.locked = false;
});

// Получаем лоты с сервера
api
	.getLotList()
	.then(appData.setCatalog.bind(appData))
	// вместо лога поместите данные в модель

	.catch((err) => {
		console.error(err);
	});
