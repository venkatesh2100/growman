"""Environment configuration.

Every third-party integration is optional. A missing key means that one
feature answers 503; the rest of the API still boots. Postgres is the
exception: without it there is nothing to serve.

Production is stricter. A default JWT secret, or a missing Razorpay
secret, refuses to start. An unverifiable payment must never be accepted,
and discovering that at the first checkout is too late.
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # PY_PORT keeps this process off the Go server's :8080 when both run.
    py_port: int = 8081
    app_env: str = Field(default="", validation_alias="APP_ENV")
    go_env: str = Field(default="", validation_alias="GO_ENV")

    database_url: str = ""
    hyperdrive_url: str = ""
    auto_migrate: bool = True
    seed_on_startup: bool = False
    db_max_open_conns: int = 40

    jwt_secret: str = "dev-secret-change-me"
    cors_origins: str = "http://localhost:3000,http://localhost:3001,http://localhost:3002"

    redis_url: str = ""
    redis_pool_size: int = 20

    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    # Different from the API key secret. Razorpay mints this when you
    # create the webhook. Using the key secret here fails every delivery.
    razorpay_webhook_secret: str = ""

    smtp_email: str = ""
    smtp_password: str = ""
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    merchant_notify_email: str = ""
    discord_webhook_url: str = ""
    quotation_email: str = ""
    waitlist_email: str = ""

    image_base_url: str = ""
    gcs_bucket_name: str = ""
    gcs_project_id: str = ""
    # Path to a service-account JSON key. Empty means Application Default Credentials.
    gcs_credentials_json: str = ""

    cloudflare_api_token: str = ""
    cloudflare_account_id: str = ""
    cloudflare_zone_id: str = ""

    rag_service_url: str = ""
    rag_shared_secret: str = ""

    plantnet_api_key: str = ""
    plantnet_project: str = "all"
    plantnet_reserve: int = 40
    plantnet_base_url: str = "https://my-api.plantnet.org"

    google_client_id: str = ""
    msg91_auth_key: str = ""
    msg91_template_id: str = ""
    msg91_widget_id: str = ""
    msg91_token_auth: str = ""
    truecaller_client_id: str = ""

    store_latitude: float = 0
    store_longitude: float = 0
    store_pincode: str = ""
    courier_provider: str = "Shiprocket"
    retail_max_zone: str = ""
    shiprocket_email: str = ""
    shiprocket_password: str = ""
    shiprocket_token: str = ""
    shiprocket_pickup_location: str = ""
    shiprocket_webhook_token: str = ""
    free_delivery_min_subtotal: float = 0
    own_vehicle_min_subtotal: float = 0
    bulk_min_units: int = 0
    bulk_min_subtotal: float = 0

    log_http: bool = False

    @property
    def env_name(self) -> str:
        return (self.app_env or self.go_env or "development").strip().lower()

    @property
    def is_prod(self) -> bool:
        return self.env_name in {"production", "prod"}

    @property
    def skip_signature_checks(self) -> bool:
        # Only an explicit non-production env may skip HMAC checks.
        # A missing secret must NOT mean "skip" — that fails open.
        return self.env_name in {"development", "dev", "test"}

    @property
    def origins(self) -> list[str]:
        return [p.strip() for p in self.cors_origins.split(",") if p.strip()]

    @property
    def sqlalchemy_url(self) -> str:
        # A long-lived process is faster talking to Postgres directly.
        # Hyperdrive is built for short-lived edge connections, so it is
        # only the fallback when DATABASE_URL is unset.
        raw = (self.database_url or self.hyperdrive_url).strip()
        if raw.startswith("postgres://"):
            raw = "postgresql+psycopg://" + raw[len("postgres://") :]
        elif raw.startswith("postgresql://"):
            raw = "postgresql+psycopg://" + raw[len("postgresql://") :]
        return raw

    def validate_boot(self) -> None:
        if not (self.database_url or self.hyperdrive_url):
            raise RuntimeError("DATABASE_URL or HYPERDRIVE_URL is required")
        if self.is_prod and self.jwt_secret in {"", "dev-secret-change-me"}:
            raise RuntimeError("JWT_SECRET must be a strong secret in production")
        if self.is_prod and not self.razorpay_key_secret:
            raise RuntimeError("RAZORPAY_KEY_SECRET is required in production")
        if self.is_prod and not self.razorpay_webhook_secret:
            raise RuntimeError("RAZORPAY_WEBHOOK_SECRET is required in production")
