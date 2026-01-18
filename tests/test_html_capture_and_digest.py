import unittest

from browtool.html_capture import inject_html_capture
from browtool.html_summarize import build_digest, digest_html


class TestHtmlCaptureInjection(unittest.TestCase):
    def test_injects_before_browser_close(self):
        script = "\n".join(
            [
                "def main():",
                "    page = None",
                "    context.close()",
                "    browser.close()",
                "",
            ]
        )
        out = inject_html_capture(script, html_path="/tmp/x.html")
        # Injection should appear before context.close() (earliest close)
        self.assertLess(out.find("__BROWTOOL_HTML_PATH"),
                        out.find("context.close()"))


class TestDigest(unittest.TestCase):
    def test_digest_extracts_title_links_and_text(self):
        html = """
        <html><head><title>Hello</title><style>.x{}</style></head>
        <body>
          <script>console.log(1)</script>
          <h1>Welcome</h1>
          <a href="https://example.com">Click me</a>
          <form><input name="q" type="text"/></form>
        </body></html>
        """
        d = build_digest(html, max_text_chars=1000)
        self.assertEqual(d.title, "Hello")
        self.assertTrue("Welcome" in d.text)
        self.assertEqual(d.links[0]["href"], "https://example.com")

    def test_digest_html_shape(self):
        html = "<html><head><title>Hello</title></head><body><a href='x'>a</a></body></html>"
        out = digest_html(html, max_text_chars=1000)
        self.assertTrue(out["ok"])
        self.assertEqual(out["digest"]["title"], "Hello")


if __name__ == "__main__":
    unittest.main()
