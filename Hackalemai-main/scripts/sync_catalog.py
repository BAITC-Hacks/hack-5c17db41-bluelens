"""Download the ekt.kz paginated catalog and product details into data/catalog.json.

Uses only the Python standard library. Credentials are read from .env/environment.
Keep DEMO_MODE=true for the local hackathon demo; this script is an opt-in sync.
"""
from __future__ import annotations

import base64
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def env_file() -> None:
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def request_json(url: str, auth: str) -> dict:
    req = urllib.request.Request(url, headers={"Authorization": f"Basic {auth}", "Accept": "application/json", "User-Agent": "EKT-Demo-Catalog-Sync/1.0"})
    last_error = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(0.7 * (attempt + 1))
    raise RuntimeError(f"API request failed after 3 attempts: {url}: {type(last_error).__name__}")


def main() -> None:
    env_file()
    username, password = os.getenv("EKT_API_USERNAME", ""), os.getenv("EKT_API_PASSWORD", "")
    if not username or not password:
        raise SystemExit("Set EKT_API_USERNAME and EKT_API_PASSWORD in .env first.")
    base = os.getenv("EKT_API_BASE_URL", "https://ekt.kz/api").rstrip("/")
    auth = base64.b64encode(f"{username}:{password}".encode()).decode()
    products, page = [], 1
    while True:
        payload = request_json(f"{base}/products" + (f"?page={page}" if page > 1 else ""), auth)
        batch = payload if isinstance(payload, list) else payload.get("items", [])
        if not batch:
            break
        products.extend(batch)
        print(f"Page {page}: {len(batch)} products")
        meta = payload if isinstance(payload, dict) else {}
        pages = meta.get("pages") or meta.get("last_page") or meta.get("total_pages")
        if pages and page >= int(pages):
            break
        if len(batch) < int(meta.get("per_page", len(batch))):
            break
        page += 1

    normalized = []
    for item in products:
        detail_id = item.get("id")
        detail_response = request_json(f"{base}/products/detail?id={detail_id}", auth) if detail_id else {}
        detail = detail_response.get("item", detail_response.get("data", detail_response)) if isinstance(detail_response, dict) else {}
        name = str(detail.get("name") or item.get("name") or "")
        props = detail.get("properties") or {}
        article = props.get("ARTIKULPOSTAVSHCHIKA") or re.match(r"^(\d{4,})\b", name)
        article = article.group(1) if hasattr(article, "group") else article
        normalized.append({
            "id": str(detail_id), "name": name, "article": article, "erp_article": detail.get("article") or item.get("article"),
            "price": detail.get("price", item.get("price")), "image": detail.get("image") or item.get("image"),
            "url": detail.get("url") or item.get("url"), "brand": props.get("TORGOVAYA_MARKA"),
            "description": detail.get("description"), "certificate_url": detail.get("certificate_url") or detail.get("certificate"),
            "stock": detail.get("quantity"), "stores": detail.get("stores"),
            "properties": {"poles": props.get("KOLICHESTVO_POLYUSOV"), "amperage": props.get("NOMINALNYY_TOK"),
                "breaking_capacity": props.get("NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST"), "voltage": props.get("NOMINALNOE_NAPRYAZHENIE"),
                "installation": props.get("TIP_USTANOVKI"), "category": props.get("OBYEM"), "series": None},
        })
    output = ROOT / "data" / "catalog.json"
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps({"source": "ekt.kz api", "products": normalized}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(normalized)} products to {output}")


if __name__ == "__main__":
    main()
