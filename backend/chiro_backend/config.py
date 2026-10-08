import re
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CHIRO_", env_file=".env", extra="ignore")
    profile: str | None = 'DEFAULT'
    warehouse_id: str | None = '99024bb6d1e64a45'
    catalog: str = "workspace"
    data_schema: str = Field(default="chiro_hackathon", validation_alias="CHIRO_SCHEMA")
    model_endpoint: str = 'databricks-gpt-oss-120b'
    agent_mode: str = 'llm'
    persistence_mode: str = 'delta'
    ledger_path: str = ".local/actions.sqlite"
    cors_origins: list[str] = ["http://localhost:5173"]
    @field_validator("catalog", "data_schema")
    @classmethod
    def identifier(cls, value):
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value):
            raise ValueError("Invalid SQL identifier")
        return value
