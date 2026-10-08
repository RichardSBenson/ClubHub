import { readMoney, readSizes, readProduct, readListing, priceAt, readBasket, orderTotal, mayMoveOrder } from './domain/shop.mjs';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}  ${d}`));

ok('money: dollars', readMoney('89').value === 8900);
ok('money: dollars and cents', readMoney('$89.50').value === 8950);
ok('money: blank is none', readMoney('').value === null);
ok('money: junk refused', !!readMoney('abc').problem && !!readMoney('-5').problem && !!readMoney('1e3').problem);
ok('money: too high refused', !!readMoney('20000').problem);
ok('sizes: split and tidy', JSON.stringify(readSizes('S, M, L, m')) === '["S","M","L"]');
ok('sizes: none', readSizes('').length === 0);

const f = { name: ' Kyokushin gi ', category: 'gi', price: '120', sizes: '0, 1, 2', description: 'Heavy cotton' };
ok('product reads', readProduct(f).value?.price_cents === 12000 && readProduct(f).value.name === 'Kyokushin gi');
ok('product needs a name', !!readProduct({ ...f, name: ' ' }).problem);
ok('product needs a known category', !!readProduct({ ...f, category: 'hats' }).problem);
ok('product needs a price', !!readProduct({ ...f, price: '' }).problem);

ok('listing: own price wins', priceAt({ price_cents: 1000 }, { price_cents: 900 }) === 900);
ok('listing: none means national price', priceAt({ price_cents: 1000 }, null) === 1000 && priceAt({ price_cents: 1000 }, { price_cents: null }) === 1000);
ok('listing reads hidden', readListing({ hidden: 'on', price: '' }).value.hidden === true);

const range = [
  { id: 'a', name: 'Gi', sizes: ['0', '1'], price_cents: 12000 },
  { id: 'b', name: 'Gloves', sizes: [], price_cents: 4500 },
];
const b = readBasket({ qty_a: '2', size_a: '1', qty_b: '1', qty_zzz: '5', size_zzz: 'x' }, range);
ok('basket: prices are the server\'s', b.value.length === 2 && b.total_cents === 2 * 12000 + 4500);
ok('basket: an item outside the range is ignored', !b.value.some((l) => l.product_id === 'zzz'));
ok('basket: unsized item has no size', b.value.find((l) => l.product_id === 'b').size === null);
ok('basket: size required and must be one offered', !!readBasket({ qty_a: '1' }, range).problem && !!readBasket({ qty_a: '1', size_a: '9' }, range).problem);
ok('basket: empty refused', !!readBasket({}, range).problem);
ok('basket: bad quantity refused', !!readBasket({ qty_b: '99' }, range).problem && !!readBasket({ qty_b: '-1' }, range).problem);
ok('order total', orderTotal([{ unit_cents: 100, quantity: 3 }]) === 300);
ok('status moves', mayMoveOrder('placed', 'paid') && mayMoveOrder('paid', 'ready') && !mayMoveOrder('collected', 'placed') && !mayMoveOrder('cancelled', 'paid'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
