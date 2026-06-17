from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent


class Settings(BaseSettings):
    fb_access_token: str = ""
    fb_ad_account_id: str = ""
    google_search_delay_ms: int = 2000
    max_concurrent_scrapers: int = 3
    screenshot_timeout_ms: int = 15000

    data_dir: Path = BASE_DIR / "data"
    screenshots_dir: Path = BASE_DIR / "data" / "screenshots"
    html_dir: Path = BASE_DIR / "data" / "html"
    db_url: str = f"sqlite+aiosqlite:///{BASE_DIR}/data/funnels.db"

    class Config:
        env_file = BASE_DIR / ".env"


settings = Settings()
settings.screenshots_dir.mkdir(parents=True, exist_ok=True)
settings.html_dir.mkdir(parents=True, exist_ok=True)
