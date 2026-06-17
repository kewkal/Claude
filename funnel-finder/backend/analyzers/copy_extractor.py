"""Extract headline, subheadline, CTAs, and offer angle from landing page HTML."""
import re
from bs4 import BeautifulSoup


def extract(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")

    # Remove nav, footer, scripts, styles from analysis
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    headline = _get_headline(soup)
    subheadline = _get_subheadline(soup)
    ctas = _get_ctas(soup)
    offer_angle = _get_offer_angle(soup)

    return {
        "headline": headline,
        "subheadline": subheadline,
        "ctas": ctas,
        "offer_angle": offer_angle,
    }


def _get_headline(soup: BeautifulSoup) -> str | None:
    h1 = soup.find("h1")
    if h1:
        return h1.get_text(strip=True)[:300] or None

    # Fallback: largest font-size element via inline style
    for tag in soup.find_all(style=re.compile(r"font-size:\s*[3-9]\d|font-size:\s*1[0-9]\d")):
        text = tag.get_text(strip=True)
        if text:
            return text[:300]

    return None


def _get_subheadline(soup: BeautifulSoup) -> str | None:
    h2 = soup.find("h2")
    if h2:
        return h2.get_text(strip=True)[:300] or None
    h3 = soup.find("h3")
    if h3:
        return h3.get_text(strip=True)[:300] or None
    return None


def _get_ctas(soup: BeautifulSoup) -> list[str]:
    ctas: list[str] = []
    seen: set[str] = set()

    cta_patterns = re.compile(r"cta|btn|button|submit|order|buy|get|claim|start|try|join|register", re.I)

    # Buttons
    for btn in soup.find_all("button"):
        text = btn.get_text(strip=True)
        if text and text not in seen and len(text) < 100:
            ctas.append(text)
            seen.add(text)

    # Input[type=submit]
    for inp in soup.find_all("input", type=re.compile(r"submit|button", re.I)):
        text = inp.get("value", "").strip()
        if text and text not in seen:
            ctas.append(text)
            seen.add(text)

    # Links that look like CTAs
    for a in soup.find_all("a"):
        classes = " ".join(a.get("class", []))
        href = a.get("href", "")
        if cta_patterns.search(classes) or cta_patterns.search(href):
            text = a.get_text(strip=True)
            if text and text not in seen and len(text) < 100:
                ctas.append(text)
                seen.add(text)

    return ctas[:10]


def _get_offer_angle(soup: BeautifulSoup) -> str | None:
    # First substantial paragraph after the h1
    for p in soup.find_all("p"):
        text = p.get_text(strip=True)
        if len(text) > 50:
            return text[:500]
    return None
