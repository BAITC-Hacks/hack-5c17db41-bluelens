'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
type Product = { id: string; name: string; article?: string; image?: string | null };
type Cart = { items: { product: Product; quantity: number; line_total: number }[]; total: number };
const money = (value: number) => `${new Intl.NumberFormat('ru-RU').format(value)} ₸`;

export default function CartPage() {
  const [cart, setCart] = useState<Cart>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  useEffect(() => { void fetch(`${API}/api/cart`).then((r) => r.json()).then(setCart).catch(() => undefined).finally(() => setLoading(false)); }, []);
  return <main className="cart-page"><header className="cart-page-header"><Link href="/" className="cart-page-brand">e<span>·</span>kt</Link><Link href="/" className="back-link">← Вернуться к помощнику</Link></header><section className="cart-page-card"><div className="eyebrow">ВАШ ЗАКАЗ</div><h1>Корзина <span>{cart.items.length}</span></h1>{loading ? <p className="cart-page-note">Загружаю состав корзины…</p> : cart.items.length ? <><div className="cart-page-lines">{cart.items.map((item) => <article className="cart-page-line" key={item.product.id}><div className="cart-page-thumb">{item.product.image ? <img src={item.product.image} alt="" /> : 'ϟ'}</div><div><strong>{item.product.name}</strong><small>Арт. {item.product.article || '—'} · {item.quantity} шт.</small></div><b>{money(item.line_total)}</b></article>)}</div><footer className="cart-page-total"><span>Итого</span><strong>{money(cart.total)}</strong></footer><p className="cart-page-note">Это демо-корзина. Оформление заказа не подключено.</p></> : <div className="cart-page-empty"><span>♧</span><h2>{loading ? 'Загружаю…' : 'Пока ничего нет'}</h2><p>После подтверждения товар появится здесь.</p><Link href="/">Найти товар <span>→</span></Link></div>}</section><footer className="cart-page-foot">Корзина ekt.kz · локальная демонстрация</footer></main>;
}
