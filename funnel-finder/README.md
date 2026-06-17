# Winning Funnel Finder

Ad intelligence tool for media buyers. Find winning Facebook and Google ad creatives + landing pages, scored by profitability signals.

## Setup

```bash
cp .env.example .env
# Add your FB_ACCESS_TOKEN to .env
# Get one at: https://developers.facebook.com/tools/explorer/
# Permissions needed: ads_read

chmod +x start.sh
./start.sh
```

Open **http://localhost:5173**

## Search modes

| Mode | Description |
|------|-------------|
| **Keyword** | Find ads in a niche (e.g. "weight loss supplement") |
| **Domain** | All ads pointing to a competitor domain |
| **Advertiser** | All ads from a specific brand |
| **Trending** | Top-scoring ads across all your past searches |

## Winning Score (0–100)

| Signal | Points |
|--------|--------|
| Days active (max 90d) | 0–40 |
| Variation count (max 10) | 0–30 |
| Social proof | 0–20 |
| VSL detected | +5 |
| Funnel builder detected | +3 |
| Tracking pixel present | +2 |

Green badge = 80+, Yellow = 50–79, Gray = below 50.

## Tech stack detected

Funnel builders: ClickFunnels, GoHighLevel, Unbounce, Leadpages, Kartra, Kajabi, SamCart, ThriveCart  
Email: ActiveCampaign, ConvertKit, Klaviyo, Mailchimp, Drip, AWeber  
Pixels: Facebook, Google Tag Manager, TikTok, Hotjar, Clarity  
Payment: Stripe, PayPal, Braintree  

## Notes

- Facebook requires a valid Graph API token. Google Ads Transparency scraper works without credentials.
- Landing page screenshots and HTML archives are stored in `data/`.
- All data is stored locally in `data/funnels.db` (SQLite).
