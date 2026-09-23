import os
import io
import glob
import sqlite3
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

_tmp = tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False)
os.environ["DATABASE_PATH"] = _tmp.name
_tmp.close()

from fastapi.testclient import TestClient
from backend.app import main as assistant


class AssistantTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assistant.init_db()
        cls.client = TestClient(assistant.app)

    def setUp(self):
        with assistant.db() as con:
            con.execute("DELETE FROM cart_items")
            con.execute("DELETE FROM cart_actions")
            con.execute("DELETE FROM sessions")

    def cart(self, session_id):
        return self.client.get("/api/cart", params={"session_id": session_id})

    def test_article_lookup_and_exact_price(self):
        product = assistant.search_products("027228")[0]
        self.assertEqual(product["article"], "027228")
        self.assertEqual(product["price"], 64920)
        self.assertEqual(product["stock"], 23)

    def test_city_stock_is_from_source_detail(self):
        product = assistant.get_product("027228")
        self.assertEqual(assistant.city_stock(product, "Алматы")["quantity"], 5)
        self.assertEqual(assistant.city_stock(product, 'Алмате' )["quantity"], 5)
        self.assertEqual(assistant.city_stock(product, "Неизвестный город")["known"], False)

    def test_store_question_uses_verified_directory(self):
        response = self.client.post("/api/chat", json={"session_id": "store-directory", "message": 'Есть ли у вас магазины в алмате?'})
        payload = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["products"], [])
        self.assertIn("050061", payload["answer"])
        self.assertIn("47", payload["answer"])
        self.assertIn("+7 (727) 346-88-88", payload["answer"])
        stock_answer = self.client.post("/api/chat", json={"session_id": "store-product-stock", "message": 'Есть ли 027228 в магазине в Алмате?'})
        self.assertIn("5 ", stock_answer.json()["answer"])
        self.assertEqual(stock_answer.json()["products"][0]["article"], "027228")

    def test_search_brand_and_analogs(self):
        self.assertGreaterEqual(len(assistant.search_products("Legrand")), 2)
        product = assistant.get_product("027228")
        similar = assistant.analogs(product)
        self.assertTrue(similar)
        self.assertTrue(all(x["properties"]["series"] == "DRX250 MT" for x in similar))

    def test_chat_requires_confirmation_and_rechecks_stock(self):
        session = "scenario-confirm"
        self.client.post("/api/chat", json={"session_id": session, "message": "Есть ли 027228?"})
        proposal = self.client.post("/api/chat", json={"session_id": session, "message": "Мне нужно 3 штуки"}).json()
        self.assertIn("Добавить 3", proposal["answer"])
        self.assertEqual(self.cart(session).json()["items"], [])
        result = self.client.post("/api/chat", json={"session_id": session, "message": "Да, добавь"}).json()
        self.assertIn("добавил 3", result["answer"])
        self.assertEqual(result["cart"]["items"][0]["quantity"], 3)

    def test_quantity_over_stock_asks_again_without_adding(self):
        session = "scenario-over-stock"
        self.client.post("/api/chat", json={"session_id": session, "message": "Есть ли 027228?"})
        result = self.client.post("/api/chat", json={"session_id": session, "message": "Добавь 100 штук"}).json()
        self.assertIn("В наличии только 23 шт.", result["answer"])
        self.assertEqual(self.cart(session).json()["items"], [])

    def test_cart_rejects_unconfirmed_excess_and_unknown(self):
        self.assertEqual(self.client.post("/api/cart/add", json={"session_id": "safety-check", "product_id": "515291", "quantity": 1}).status_code, 409)
        self.assertEqual(self.client.post("/api/cart/add", json={"session_id": "safety-check", "product_id": "515291", "quantity": 24, "confirmed": True}).status_code, 409)
        self.assertEqual(self.client.post("/api/cart/add", json={"session_id": "safety-check", "product_id": "not-a-product", "quantity": 1, "confirmed": True}).status_code, 404)
        unknown_stock = assistant.get_product("515279")["stock"]
        self.assertIsNone(unknown_stock)

    def test_carts_are_isolated_by_visitor_session(self):
        added = self.client.post("/api/cart/add", json={"session_id": "shopper-one", "product_id": "027228", "quantity": 2, "confirmed": True})
        self.assertEqual(added.status_code, 200)
        self.assertEqual(self.cart("shopper-one").json()["items"][0]["quantity"], 2)
        self.assertEqual(self.cart("shopper-two").json()["items"], [])
        self.assertEqual(self.client.get("/api/cart").status_code, 422)

    def test_legacy_global_cart_is_migrated_out_of_visitor_carts(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy_path = Path(directory) / "legacy.sqlite3"
            con = sqlite3.connect(legacy_path)
            try:
                con.executescript("""
                    CREATE TABLE cart_items (
                        product_id TEXT PRIMARY KEY, quantity INTEGER NOT NULL,
                        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE cart_actions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL,
                        quantity INTEGER NOT NULL, confirmed INTEGER NOT NULL,
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP
                    );
                    INSERT INTO cart_items(product_id,quantity) VALUES('027228',2);
                """)
            finally:
                con.close()
            previous_path = assistant.DB_FILE
            try:
                assistant.DB_FILE = legacy_path
                assistant.init_db()
                self.assertEqual(assistant.cart_contents("legacy-import")["items"][0]["quantity"], 2)
                self.assertEqual(assistant.cart_contents("new-shopper")["items"], [])
                with assistant.db() as con:
                    self.assertIn("session_id", {row[1] for row in con.execute("PRAGMA table_info(cart_actions)")})
            finally:
                assistant.DB_FILE = previous_path

    def test_http_api_and_file_upload(self):
        self.assertTrue(self.client.get("/api/health").json()["ok"])
        response = self.client.get("/api/products/search", params={"q": "027228"})
        self.assertEqual(response.json()["items"][0]["article"], "027228")

    def test_all_required_demo_phrases_in_order(self):
        session = "complete-demo-sequence"
        phrases = ["Найди Legrand", "Есть ли 027228?", "Есть ли 027228 в Алматы?",
                   "Покажи характеристики", "Покажи аналоги", "Мне нужно 3 штуки"]
        replies = [self.client.post("/api/chat", json={"session_id": session, "message": phrase}).json() for phrase in phrases]
        self.assertTrue(replies[0]["products"])
        self.assertIn("23 шт.", replies[1]["answer"])
        self.assertIn("5 шт.", replies[2]["answer"])
        self.assertIn("160", replies[3]["answer"])
        self.assertIn("Совпадает", replies[4]["answer"])
        self.assertIn("Добавить 3", replies[5]["answer"])
        self.assertEqual(self.cart(session).json()["items"], [])
        added = self.client.post("/api/chat", json={"session_id": session, "message": "Да, добавь"}).json()
        self.assertEqual(added["cart"]["items"][0]["quantity"], 3)
        too_many = self.client.post("/api/chat", json={"session_id": session, "message": "Добавь 100 штук"}).json()
        self.assertIn("В наличии только 20 шт.", too_many["answer"])
        self.assertEqual(self.cart(session).json()["items"][0]["quantity"], 3)

    def test_xlsx_docx_and_image_upload(self):
        from openpyxl import Workbook
        workbook = Workbook()
        workbook.active.append(["Артикул", "Количество"])
        workbook.active.append(["027228", 3])
        xlsx = io.BytesIO()
        workbook.save(xlsx)
        result = self.client.post("/api/upload", files={"file": ("spec.xlsx", xlsx.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["products"][0]["article"], "027228")
        docx_files = glob.glob(os.path.join(os.path.dirname(__file__), "..", "..", "*ДАННЫЕ.docx"))
        if docx_files:
            with open(docx_files[0], "rb") as docx:
                parsed = self.client.post("/api/upload", files={"file": ("notes.docx", docx.read(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
            self.assertEqual(parsed.status_code, 200)
            self.assertIn("[скрыто]", parsed.text)
        image = self.client.post("/api/upload", files={"file": ("photo.png", b"\x89PNG\r\n\x1a\n", "image/png")})
        self.assertEqual(image.status_code, 200)
        self.assertIn("OPENAI_API_KEY", image.json()["message"])
        pdf_files = glob.glob(os.path.join(os.path.dirname(__file__), "..", "..", "*.pdf"))
        if pdf_files:
            with open(pdf_files[0], "rb") as pdf:
                parsed_pdf = self.client.post("/api/upload", files={"file": ("case.pdf", pdf.read(), "application/pdf")})
            self.assertEqual(parsed_pdf.status_code, 200)
            self.assertGreater(len(parsed_pdf.json()["extracted_text"]), 100)

    def test_unknown_purchase_terms_are_never_invented(self):
        response = self.client.get("/api/purchase-conditions").json()
        self.assertFalse(response["available"])
        answer = self.client.post("/api/chat", json={"session_id": "purchase-conditions", "message": "Какие условия оплаты и доставки?"}).json()
        self.assertIn("не указаны", answer["answer"])

    def test_missing_certificate_is_reported_honestly(self):
        answer = self.client.post("/api/chat", json={"session_id": "certificate-question", "message": "Есть ли сертификат у 027228?"}).json()
        self.assertIn("ссылка или файл сертификата не указаны", answer["answer"])


    def test_offtopic_is_refused_before_openai(self):
        with patch.object(assistant, "openai_tool_answer", side_effect=AssertionError("OpenAI must not receive off-topic requests")):
            response = self.client.post("/api/chat", json={"session_id": "offtopic-weather", "message": "\u041a\u0430\u043a\u0430\u044f \u0441\u0435\u0433\u043e\u0434\u043d\u044f \u043f\u043e\u0433\u043e\u0434\u0430?"})
        payload = response.json()
        self.assertEqual(payload["products"], [])
        self.assertIn("\u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0443 ekt.kz", payload["answer"])

    def test_unknown_catalog_item_gets_no_answer(self):
        response = self.client.post("/api/chat", json={"session_id": "unknown-item", "message": "\u0415\u0441\u0442\u044c \u043b\u0438 \u0442\u043e\u0432\u0430\u0440 999999?"})
        payload = response.json()
        self.assertEqual(payload["products"], [])
        self.assertIn("\u043d\u0435\u0442 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0451\u043d\u043d\u043e\u0433\u043e \u043e\u0442\u0432\u0435\u0442\u0430", payload["answer"])

    def test_product_detail_without_product_reference_asks_for_article(self):
        response = self.client.post("/api/chat", json={"session_id": "missing-target", "message": "\u041f\u043e\u043a\u0430\u0436\u0438 \u0445\u0430\u0440\u0430\u043a\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043a\u0438"})
        self.assertEqual(response.json()["products"], [])
        self.assertIn("\u0430\u0440\u0442\u0438\u043a\u0443\u043b", response.json()["answer"])

    def test_offtopic_product_technical_question_is_refused(self):
        response = self.client.post("/api/chat", json={"session_id": "offtopic-product", "message": "\u041f\u043e\u0447\u0435\u043c\u0443 \u0430\u0432\u0442\u043e\u043c\u0430\u0442 027228 \u043e\u0442\u043a\u043b\u044e\u0447\u0430\u0435\u0442\u0441\u044f?"}).json()
        self.assertEqual(response["products"], [])
        self.assertIn("\u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0443 ekt.kz", response["answer"])

if __name__ == "__main__":
    unittest.main()
