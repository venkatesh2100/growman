"""Environment. One object, read once at boot.

Production refuses to start without a database, a long JWT secret, and both
Razorpay secrets. Everything else is optional: that feature answers 503,
the rest of the shop keeps serving.
"""

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        env_ignore_empty=True,
    )

    py_port: int = 8081

    @field_validator("py_port", mode="before")
    @classmethod
    def _port(cls, value):
        if isinstance(value, str):
            value = value.strip().lstrip(":")
        return value

    app_env: str = "development"
    auto_migrate: bool = True
    seed_on_startup: bool = False

    database_url: str = ""
    hyperdrive_url: str = ""
    db_max_open_conns: int = 40

    jwt_secret: str = "dev-secret-change-me"
    cors_origins: str = "http://localhost:3000,http://localhost:3001"

    redis_url: str = ""

    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""

    smtp_email: str = ""
    smtp_password: str = ""
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    merchant_notify_email: str = ""
    quotation_email: str = ""
    discord_webhook_url: str = ""

    google_client_id: str = ""
    image_base_url: str = ""

    cloudflare_api_token: str = ""
    cloudflare_account_id: str = ""

    rag_service_url: str = ""
    rag_shared_secret: str = ""

    plantnet_api_key: str = ""
    plantnet_project: str = "all"
    plantnet_reserve: int = 40

    msg91_auth_key: str = ""
    msg91_template_id: str = ""
    msg91_widget_id: str = ""
    msg91_token_auth: str = ""
    truecaller_client_id: str = ""

    store_latitude: float = 17.3850
    store_longitude: float = 78.4867
    store_pincode: str = ""
    free_delivery_min_subtotal: float = 0
    own_vehicle_min_subtotal: float = 2500
    bulk_min_units: int = 10
    bulk_min_subtotal: float = 15000
    retail_max_zone: str = "far"

    shiprocket_email: str = ""
    shiprocket_password: str = ""
    shiprocket_token: str = ""
    shiprocket_pickup_location: str = ""
    shiprocket_webhook_token: str = ""

    @property
    def prod(self) -> bool:
        return self.app_env.strip().lower() in {"production", "prod"}

    @property
    def dev(self) -> bool:
        return self.app_env.strip().lower() in {"development", "dev", "test"}

    @property
    def db_url(self) -> str:
        raw = (self.database_url or self.hyperdrive_url).strip()
        if raw.startswith("postgres://"):
            return "postgresql+psycopg://" + raw[len("postgres://") :]
        if raw.startswith("postgresql://"):
            return "postgresql+psycopg://" + raw[len("postgresql://") :]
        return raw

    @property
    def origins(self) -> list[str]:
        return [part.strip() for part in self.cors_origins.split(",") if part.strip()]

    @property
    def quote_inbox(self) -> str:
        return self.quotation_email or self.merchant_notify_email

    def check(self) -> None:
        if not self.db_url:
            raise RuntimeError("DATABASE_URL is required")
        if not self.prod:
            return
        weak = len(self.jwt_secret) < 32 or "change-me" in self.jwt_secret
        if weak:
            raise RuntimeError("production needs a long random JWT_SECRET")
        if not self.razorpay_key_secret or not self.razorpay_webhook_secret:
            raise RuntimeError("production needs both Razorpay secrets")
