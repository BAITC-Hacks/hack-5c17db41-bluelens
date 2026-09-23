'use client';

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { getSessionId } from '../lib/session';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const SUGGESTIONS = ['Найди Legrand', 'Есть ли 027228?', 'Есть ли 027228 в Алматы?', 'Покажи аналоги', 'Покажи характеристики'];

type Product = {
  id: string; name: string; article?: string | null; price?: number | null; image?: string | null;
  url?: string | null; brand?: string | null; stock?: number | null;
  properties?: Record<string, string | null>;
};
type Cart = { items: { product: Product; quantity: number; line_total: number }[]; total: number };
type Message = { role: 'user' | 'assistant'; text: string; products?: Product[]; file?: string };
type Confirmation = { product: Product; quantity: number };

function money(value?: number | null) {
  return value == null ? 'Цена уточняется' : `${new Intl.NumberFormat('ru-RU').format(value)} ₸`;
}

function Icon({ children }: { children: React.ReactNode }) { return <span className="icon" aria-hidden="true">{children}</span>; }

function ProductCard({ product, onAdd }: { product: Product; onAdd: (product: Product, quantity: number) => void }) {
  const [quantity, setQuantity] = useState(1);
  const props = product.properties || {};
  const facts = [
    props.amperage && `${props.amperage} А`,
    props.poles && `${props.poles} полюса`,
    props.breaking_capacity && `${props.breaking_capacity} кА`,
  ].filter(Boolean) as string[];
  return <article className="product-card">
    <div className="product-media">
      {product.image ? <img src={product.image} alt="" loading="lazy" /> : <span className="product-placeholder">ϟ</span>}
      <span className="product-brand">{product.brand || 'EKT'}</span>
    </div>
    <div className="product-content">
      <div className="product-overline">Артикул {product.article || '—'}</div>
      <a className="product-name" href={product.url || '#'} target={product.url ? '_blank' : undefined} rel="noreferrer">{product.name}</a>
      {facts.length > 0 && <div className="product-facts">{facts.map((f) => <span key={f}>{f}</span>)}</div>}
      <div className="product-bottom">
        <div><strong className="product-price">{money(product.price)}</strong><div className={`availability ${product.stock == null ? 'unknown' : product.stock > 0 ? 'available' : 'none'}`}><i />{product.stock == null ? 'Остаток не указан' : product.stock > 0 ? `В наличии ${product.stock} шт.` : 'Нет в наличии'}</div></div>
        <div className="card-actions"><div className="stepper"><button aria-label="Уменьшить количество" onClick={() => setQuantity((v) => Math.max(1, v - 1))}>−</button><span>{quantity}</span><button aria-label="Увеличить количество" onClick={() => setQuantity((v) => v + 1)}>+</button></div><button className="add-button" aria-label="Запросить добавление в корзину" disabled={product.stock == null || product.stock < 1} title={product.stock == null ? 'В демо-каталоге нет данных об остатке' : undefined} onClick={() => onAdd(product, quantity)}><Icon>＋</Icon></button></div>
      </div>
    </div>
  </article>;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', text: 'Здравствуйте! Я помогу найти товар, проверить цену и остатки или подобрать аналог. Напишите артикул или название — я загляну в каталог.' }]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [cart, setCart] = useState<Cart>({ items: [], total: 0 });
  const [cartOpen, setCartOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [cartBusy, setCartBusy] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = getSessionId();
    setSessionId(id);
    void fetch(`${API}/api/health`).then((r) => setApiOnline(r.ok)).catch(() => setApiOnline(false));
    void fetchCart(id);
  }, []);

  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, loading]);

  async function fetchCart(id: string) {
    if (!id) return;
    try { const response = await fetch(`${API}/api/cart?session_id=${encodeURIComponent(id)}`); if (response.ok) setCart(await response.json()); } catch { /* Backend may still be starting. */ }
  }

  async function sendMessage(raw: string) {
    const text = raw.trim();
    if (!text || loading || !sessionId) return;
    setMessages((all) => [...all, { role: 'user', text }]); setInput(''); setLoading(true);
    try {
      const response = await fetch(`${API}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId, message: text }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Сервис временно недоступен');
      setMessages((all) => [...all, { role: 'assistant', text: data.answer, products: data.products }]);
      if (data.cart) setCart(data.cart);
    } catch (error) {
      setApiOnline(false);
      setMessages((all) => [...all, { role: 'assistant', text: `Не удалось связаться с помощником: ${error instanceof Error ? error.message : 'проверьте, запущен ли backend'}.` }]);
    } finally { setLoading(false); }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setMessages((all) => [...all, { role: 'user', text: `Загрузил файл: ${file.name}`, file: file.name }]); setLoading(true);
    try {
      const form = new FormData(); form.append('file', file);
      const response = await fetch(`${API}/api/upload`, { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Не удалось обработать файл');
      setMessages((all) => [...all, { role: 'assistant', text: result.message, products: result.products }]);
    } catch (error) { setMessages((all) => [...all, { role: 'assistant', text: error instanceof Error ? error.message : 'Не удалось обработать файл.' }]); }
    finally { setLoading(false); }
  }

  async function confirmAdd() {
    if (!confirmation || cartBusy) return;
    setCartBusy(true);
    try {
      const response = await fetch(`${API}/api/cart/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId, product_id: confirmation.product.id, quantity: confirmation.quantity, confirmed: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Не удалось добавить товар');
      setCart(result.cart); setConfirmation(null);
      setMessages((all) => [...all, { role: 'assistant', text: `Готово, добавил ${result.quantity_added} шт. «${confirmation.product.name}» в корзину. Можно посмотреть состав заказа.` }]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Не удалось добавить товар';
      const match = reason.match(/Доступно только (\d+) шт/);
      if (match) setConfirmation({ ...confirmation, quantity: Number(match[1]) });
      setMessages((all) => [...all, { role: 'assistant', text: `${reason}${match ? `. Уменьшил количество в окне подтверждения до ${match[1]} шт.` : ''}` }]);
    } finally { setCartBusy(false); }
  }

  function onSubmit(event: FormEvent) { event.preventDefault(); void sendMessage(input); }

  return <main className="app-shell">
    <aside className="side-rail"><div className="rail-logo">e<span>·</span>kt</div><button className="rail-item active" title="Помощник"><Icon>✳</Icon></button><button className="rail-item" title="Каталог" onClick={() => void sendMessage('Найди Legrand')}><Icon>▦</Icon></button><button className="rail-item rail-cart" title="Корзина" onClick={() => setCartOpen(true)}><Icon>♧</Icon>{cart.items.length > 0 && <b>{cart.items.length}</b>}</button><div className="rail-spacer" /><div className="avatar">A</div></aside>

    <section className="workspace">
      <header className="topbar"><div className="breadcrumbs"><span>ekt.kz</span><b>/</b><strong>Помощник по каталогу</strong></div><div className="top-actions"><div className="online-status"><i className={apiOnline === false ? 'offline-dot' : ''} />{apiOnline === null ? 'Подключаемся' : apiOnline ? 'Демо-каталог подключён' : 'Backend не отвечает'}</div><button className="cart-top" onClick={() => setCartOpen(true)}><Icon>♧</Icon><span>Корзина</span><b>{cart.items.length}</b></button></div></header>

      <div className="chat-layout">
        <section className="chat-panel">
          <div className="chat-title"><div className="assistant-mark"><span>✳</span><i /></div><div><h1>Умный помощник</h1><p>Товары, характеристики и наличие</p></div><div className="title-pill"><i /> НА СВЯЗИ</div></div>
          <div className="message-feed" ref={feedRef}>
            <div className="date-divider"><span>СЕГОДНЯ</span></div>
            {messages.map((message, index) => <div className={`message-row ${message.role}`} key={`${index}-${message.text.slice(0, 18)}`}>
              {message.role === 'assistant' && <div className="mini-mark">✳</div>}
              <div className="message-stack"><div className="bubble">{message.file && <div className="file-chip"><Icon>▧</Icon>{message.file}</div>}<p>{message.text}</p></div>{/готово, добавил/i.test(message.text) && <a className="inline-cart-link" href="/cart">Перейти в корзину <span>→</span></a>}
                {!!message.products?.length && <div className={`product-list ${message.products.length > 1 ? 'multi' : ''}`}>{message.products.map((product) => <ProductCard key={product.id} product={product} onAdd={(p, quantity) => setConfirmation({ product: p, quantity })} />)}</div>}
                <span className="message-time">{message.role === 'assistant' ? 'Помощник' : 'Вы'} · сейчас</span></div>
            </div>)}
            {loading && <div className="message-row assistant"><div className="mini-mark">✳</div><div className="typing"><i /><i /><i /><span>Проверяю каталог</span></div></div>}
          </div>
          <div className="composer-area"><div className="quick-prompts">{SUGGESTIONS.map((suggestion) => <button key={suggestion} onClick={() => void sendMessage(suggestion)} disabled={loading}>{suggestion}</button>)}</div>
            <form className="composer" onSubmit={onSubmit}><input ref={uploadRef} type="file" accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg" hidden onChange={handleFile} /><button type="button" className="attach-button" title="Прикрепить файл" onClick={() => uploadRef.current?.click()}><Icon>⌁</Icon></button><input aria-label="Сообщение помощнику" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Спросите о товаре или введите артикул…" disabled={loading} /><button type="submit" className="send-button" disabled={!input.trim() || loading} aria-label="Отправить сообщение"><Icon>↑</Icon></button></form>
            <div className="composer-foot"><span><Icon>◈</Icon> Ответы основаны на загруженном каталоге</span><span>Демо-режим · ekt.kz</span></div></div>
        </section>

        <aside className="info-panel"><div className="info-head"><span>ВАШ ПОМОЩНИК</span><span className="sparkle">✳</span></div><h2>Найдём нужное<br />для вашего проекта.</h2><p className="info-intro">Спросите про товар, наличие на складе или совместимые аналоги.</p>
          <div className="capabilities"><div><span className="cap-icon aqua">⌕</span><section><strong>Поиск по каталогу</strong><p>Название, артикул или бренд</p></section></div><div><span className="cap-icon orange">◷</span><section><strong>Остатки по городам</strong><p>Проверка по складам из каталога</p></section></div><div><span className="cap-icon violet">⌘</span><section><strong>Подбор аналогов</strong><p>Сравним ключевые характеристики</p></section></div></div>
          <div className="demo-callout"><div><span>✦</span><strong>Каталог для демо</strong></div><p>40 товаров из материалов кейса. Наличие показывается, только если оно есть в исходных данных.</p></div><div className="info-bottom"><span className="shield">◇</span><p>Корзина изменится только после вашего подтверждения.</p></div>
        </aside>
      </div>
    </section>

    {cartOpen && <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setCartOpen(false); }}><section className="drawer" role="dialog" aria-modal="true" aria-label="Корзина"><div className="drawer-head"><div><span className="eyebrow">ВАШ ЗАКАЗ</span><h2>Корзина <span>{cart.items.length}</span></h2></div><button className="close-button" onClick={() => setCartOpen(false)}>×</button></div>{cart.items.length ? <><div className="drawer-items">{cart.items.map((item) => <div className="cart-line" key={item.product.id}><div className="cart-thumb">{item.product.image ? <img src={item.product.image} alt="" /> : 'ϟ'}</div><div><strong>{item.product.name}</strong><small>Арт. {item.product.article} · {item.quantity} шт.</small></div><b>{money(item.line_total)}</b></div>)}</div><div className="drawer-total"><span>Итого</span><strong>{money(cart.total)}</strong></div><button className="checkout-button" onClick={() => setCartOpen(false)}>Продолжить покупки <span>→</span></button></> : <div className="empty-cart"><span>♧</span><h3>Корзина пока пуста</h3><p>Найдите товар и нажмите «В корзину». Перед добавлением вы увидите подтверждение.</p><button onClick={() => setCartOpen(false)}>Найти товар</button></div>}</section></div>}

    {confirmation && <div className="overlay confirm-overlay"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><button className="close-button confirm-close" onClick={() => setConfirmation(null)}>×</button><div className="confirm-icon">♧</div><span className="eyebrow">ПОДТВЕРЖДЕНИЕ ЗАКАЗА</span><h2 id="confirm-title">Добавить в корзину?</h2><p className="confirm-product">{confirmation.product.name}</p><div className="confirm-quantity"><span>Количество</span><div><button onClick={() => setConfirmation({ ...confirmation, quantity: Math.max(1, confirmation.quantity - 1) })}>−</button><b>{confirmation.quantity} шт.</b><button onClick={() => setConfirmation({ ...confirmation, quantity: confirmation.quantity + 1 })}>+</button></div></div><div className="confirm-total"><span>Сумма</span><strong>{money((confirmation.product.price || 0) * confirmation.quantity)}</strong></div><button className="confirm-submit" disabled={cartBusy} onClick={() => void confirmAdd()}>{cartBusy ? 'Проверяю остаток…' : 'Да, добавить'} <span>→</span></button><button className="cancel-submit" onClick={() => setConfirmation(null)}>Пока не нужно</button><p className="confirm-note">Остаток будет повторно проверен перед добавлением.</p></section></div>}
  </main>;
}
