"""fetch_tour_food.py 단위 테스트(네트워크 없음)"""
import io
import json
import unittest

import fetch_tour_food as t


def body(items, code="0000", total=None):
    return json.dumps({"response": {"header": {"resultCode": code, "resultMsg": "OK"},
                                    "body": {"items": {"item": items} if items else "", "totalCount": len(items) if total is None else total}}}).encode()


class FakeResp(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False


class Parse(unittest.TestCase):
    def test_xml_error_is_rejected_without_echo(self):
        xml = b"<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR secretKEY</errMsg></cmmMsgHeader></OpenAPI_ServiceResponse>"
        with self.assertRaises(t.FetchError) as cm:
            t.parse(xml)
        self.assertNotIn("secretKEY", str(cm.exception))

    def test_result_code(self):
        with self.assertRaises(t.FetchError):
            t.parse(body([], code="0030"))

    def test_single_item_dict_and_empty(self):
        self.assertEqual(len(t.parse(json.dumps({"response": {"header": {"resultCode": "0000"}, "body": {"items": {"item": {"contentid": "1"}}, "totalCount": 1}}}).encode())[1]), 1)
        self.assertEqual(t.parse(body([]))[1], [])


class Normalize(unittest.TestCase):
    def item(self, **o):
        base = {"contentid": "2867419", "title": "<b>명동교자</b> &amp; 본점", "addr1": "서울특별시 중구 명동10길 29", "addr2": "",
                "sigungucode": "24", "mapx": "126.985", "mapy": "37.5625", "firstimage": "http://tong.visitkorea.or.kr/a.jpg",
                "cpyrhtDivCd": "Type3", "cat3": "A05020100", "modifiedtime": "20260901120000"}
        base.update(o)
        return base

    def test_fields(self):
        n = t.normalize(self.item(), "ko")
        self.assertEqual(n["title"], "명동교자 & 본점")
        self.assertEqual(n["district"], "중구")
        self.assertEqual(n["image"], "https://tong.visitkorea.or.kr/a.jpg")
        self.assertEqual(n["image_license"], "Type3")
        self.assertEqual(n["food_type"], "korean")

    def test_unknown_license_drops_image(self):
        n = t.normalize(self.item(cpyrhtDivCd=""), "ko")
        self.assertEqual((n["image"], n["image_license"]), ("", ""))

    def test_english_address_district(self):
        n = t.normalize(self.item(sigungucode="", addr1="29, Myeongdong 10-gil, Jung-gu, Seoul"), "en")
        self.assertEqual(n["district"], "중구")

    def test_bad_rows(self):
        self.assertIsNone(t.normalize(self.item(contentid="../x"), "ko"))
        self.assertIsNone(t.normalize(self.item(title="<br>"), "ko"))
        n = t.normalize(self.item(mapx="999", mapy="0"), "ko")
        self.assertEqual((n["lat"], n["lng"]), (None, None))

    def test_https_only(self):
        self.assertEqual(t.https_url("javascript:alert(1)"), "")
        self.assertEqual(t.https_url("ftp://x/a.jpg"), "")


class Collect(unittest.TestCase):
    def test_request_is_https_json_single_encoded_and_dedupes(self):
        seen = []

        def opener(req, timeout):
            seen.append(req.full_url)
            return FakeResp(body([{"contentid": "1", "title": "A", "sigungucode": "24"}, {"contentid": "1", "title": "A"}]))
        key = "abc+def/ghi==abcdefghijklmnop"
        out = t.collect("en", key, opener)
        self.assertEqual(len(out), 1)
        url = seen[0]
        self.assertTrue(url.startswith("https://apis.data.go.kr/B551011/EngService2/areaBasedList2?"))
        self.assertIn("_type=json", url)
        self.assertIn("contentTypeId=82", url)
        self.assertIn("areaCode=1", url)
        self.assertIn("serviceKey=abc%2Bdef%2Fghi%3D%3D", url)   # 한 번만 인코딩
        self.assertNotIn("%25", url)

    def test_ko_uses_39(self):
        seen = []
        t.collect("ko", "k" * 30, lambda req, timeout: (seen.append(req.full_url), FakeResp(body([{"contentid": "1", "title": "A"}])))[1])
        self.assertIn("KorService2/areaBasedList2", seen[0])
        self.assertIn("contentTypeId=39", seen[0])


if __name__ == "__main__":
    unittest.main()
