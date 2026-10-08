# The shop

Gi, gloves, shin pads, tournament tee shirts: gear a member orders through their own dojo.

**Who sees what.** Every item belongs to one organisation. Items the *federation* adds are the national range and every dojo
beneath it can offer them. Items a *dojo* adds are shown to that dojo's members and to nobody else, so a tournament tee made
for one dojo never appears in another's shop. A dojo can hide a national item or set its own price for it. One query
(`RANGE` in `packages/api/data.mjs`) decides what a member sees.

**Ordering.** A signed-in member (or a parent, for a child) opens `/shop`, which sends them to their own shop at
`/me/:personId/shop`. They pick items, sizes and quantities and place an order with their dojo. The price is always worked out by
the server from the dojo's range; nothing in the form can set it. The member can cancel while the dojo has not touched the order.

**The dojo's side.** `/o/<dojo>/shop` shows the orders (ordered, paid, ready to collect, collected, cancelled), the national
range to hide or reprice, and the dojo's own items. Money is collected by the dojo when the gear is collected; no card
payment is taken online yet.

**The national range.** At the federation, `/o/<federation>/shop` is where the national range is kept.

Tables: `product`, `product_listing`, `shop_order`, `shop_order_line` (migration 049).
