import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const lists = [readJson('product_list.txt'), readJson('page_2_product.txt')];
const detail = readJson('detail_inf.txt');
const details = new Map([[String(detail.id), detail]]);

function pick(prefix, text, fallback = null) {
  const match = text.match(prefix);
  return match ? match[1] : fallback;
}

const products = lists.flatMap((page) => page.items).map((item) => {
  const extra = details.get(String(item.id));
  const name = item.name.trim();
  const displayArticle = pick(/^(\d{4,})\b/, name, extra?.properties?.ARTIKULPOSTAVSHCHIKA ?? null);
  const amperage = pick(/(\d+)\s*[АA](?=\s|\b)/i, name, null);
  const poles = pick(/(\d+)\s*(?:ф|poles?\b)/i, name, null);
  const breaking = pick(/(\d+)\s*(?:ka|кА)/i, name, null);
  return {
    id: String(item.id),
    name,
    article: displayArticle,
    erp_article: item.article ?? null,
    price: Number(item.price),
    image: item.image ?? extra?.image ?? null,
    url: item.url ?? extra?.url ?? null,
    brand: extra?.properties?.TORGOVAYA_MARKA ?? (name.match(/\b(Legrand|Schneider|Opple|Megalight|IEK)\b/i)?.[1] ?? null),
    description: extra?.description ?? null,
    certificate_url: extra?.certificate_url ?? extra?.certificate ?? null,
    stock: extra ? Number(extra.quantity) : null,
    stores: extra?.stores?.map((s) => ({ id: s.id, name: s.name, quantity: Number(s.quantity) })) ?? null,
    properties: {
      poles: extra?.properties?.KOLICHESTVO_POLYUSOV ?? poles,
      // Prefer the supplier-facing product name: the captured detail export has a
      // contradictory NOMINALNYY_TOK field (250 A) for the 160 A item 027228.
      amperage: amperage ?? extra?.properties?.NOMINALNYY_TOK?.match(/\d+/)?.[0] ?? null,
      breaking_capacity: extra?.properties?.NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST?.match(/[\d,.]+/)?.[0] ?? breaking,
      voltage: extra?.properties?.NOMINALNOE_NAPRYAZHENIE ?? null,
      installation: extra?.properties?.TIP_USTANOVKI ?? null,
      series: name.match(/\bDRX\d+\s*MT\b/i)?.[0] ?? null,
      category: /DRX|автомат|выключател/i.test(name) ? 'Автоматические выключатели' : null,
    },
  };
});

const output = path.join(root, 'data', 'catalog.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ source: 'uploaded demo files', generated_at: new Date().toISOString(), products }, null, 2) + '\n', 'utf8');
console.log(`Prepared ${products.length} products from uploaded source files.`);
