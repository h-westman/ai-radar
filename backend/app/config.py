from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://airadar:airadar@localhost:5433/airadar"
    write_rate_limit: str = "60/minute"
    max_body_bytes: int = 256 * 1024


settings = Settings()
