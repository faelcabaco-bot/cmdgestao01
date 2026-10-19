export type CartItem = { product_id: string; name: string; unit_price: number; quantity: number; discount: number; stock: number };
export type Payment = { method: "dinheiro" | "pix" | "debito" | "credito" | "fiado"; amount: number; installments?: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function lineTotal(i: CartItem) {
  return r2(i.quantity * i.unit_price - i.discount);
}

/** discount: value in R$ or percent of subtotal */
export function cartTotals(items: CartItem[], discount: number, discountIsPercent: boolean) {
  const subtotal = r2(items.reduce((s, i) => s + lineTotal(i), 0));
  const disc = r2(Math.min(subtotal, discountIsPercent ? (subtotal * discount) / 100 : discount));
  return { subtotal, discount: disc, total: r2(subtotal - disc) };
}

export function paymentSummary(total: number, payments: Payment[]) {
  const paid = r2(payments.reduce((s, p) => s + p.amount, 0));
  const remaining = r2(Math.max(0, total - paid));
  const cash = payments.filter((p) => p.method === "dinheiro").reduce((s, p) => s + p.amount, 0);
  // Troco só pode sair do dinheiro entregue
  const change = r2(Math.min(Math.max(0, paid - total), cash));
  return { paid, remaining, change, ok: paid + 0.001 >= total && paid - total <= cash + 0.001 };
}
