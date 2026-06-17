"""Detect funnel builders, pixels, email tools, and payment processors from page HTML."""

SIGNATURES: dict[str, list[str]] = {
    # Funnel builders
    "ClickFunnels": ["cfpage", "clickfunnels", "cf-page", "data-cf-"],
    "GoHighLevel": ["ghl-", "highlevel", "leadconnectorhq"],
    "Unbounce": ["ub-emb", "unbounce.com", "ubembed"],
    "Leadpages": ["leadpages.net", "lp-pom", "leadpages"],
    "Kartra": ["kartra.com", "katra", "app.kartra"],
    "Kajabi": ["kajabi.com", "kajabi-content"],
    "Shopify": ["cdn.shopify.com", "shopify.com/s/files", "Shopify.theme"],
    "WooCommerce": ["woocommerce", "wc-block", "add-to-cart"],
    "SamCart": ["samcart.com", "samcart-"],
    "ThriveCart": ["thrivecart.com", "thrivecart-"],

    # Pixels & analytics
    "Facebook Pixel": ["fbq(", "connect.facebook.net", "facebook-jssdk"],
    "Google Tag Manager": ["googletagmanager.com", "gtm.js"],
    "Google Analytics": ["google-analytics.com", "gtag(", "UA-", "G-"],
    "TikTok Pixel": ["analytics.tiktok.com", "ttq."],
    "Hotjar": ["hotjar.com", "hjid", "_hjSettings"],
    "Microsoft Clarity": ["clarity.ms", "microsoft clarity"],

    # Email platforms
    "ActiveCampaign": ["activecampaign.com", "activehosted.com"],
    "ConvertKit": ["convertkit.com", "ck-subscribe"],
    "Klaviyo": ["klaviyo.com", "_learnq"],
    "Mailchimp": ["mailchimp.com", "mc-embedded"],
    "Drip": ["drip.com", "_dc_"],
    "AWeber": ["aweber.com", "aw-webform"],

    # Payment
    "Stripe": ["stripe.com/v3", "stripe.js", "StripeElement"],
    "PayPal": ["paypal.com/sdk", "paypalobjects.com"],
    "Braintree": ["braintree-web", "braintreepayments.com"],
}

VSL_SIGNALS = [
    '<video', 'youtube.com/embed', 'youtu.be', 'vimeo.com/video',
    'wistia.com', 'data-wistia', 'vsl', 'video-sales-letter',
]


def detect(html: str) -> dict:
    html_lower = html.lower()
    detected: dict[str, list[str]] = {}

    for tool, patterns in SIGNATURES.items():
        hits = [p for p in patterns if p.lower() in html_lower]
        if hits:
            detected[tool] = hits

    has_vsl = any(sig in html_lower for sig in VSL_SIGNALS)

    return {
        "tools": list(detected.keys()),
        "has_vsl": has_vsl,
        "funnel_builder": next(
            (t for t in ["ClickFunnels", "GoHighLevel", "Unbounce", "Leadpages", "Kartra", "Kajabi", "SamCart", "ThriveCart"] if t in detected),
            None,
        ),
        "has_pixel": any(t in detected for t in ["Facebook Pixel", "Google Tag Manager", "TikTok Pixel"]),
        "payment": next(
            (t for t in ["Stripe", "PayPal", "Braintree"] if t in detected),
            None,
        ),
    }
