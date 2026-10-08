"""Explicit non-destructive setup for the three authorized prototype tables."""
import json
from chiro_backend.config import Settings
from chiro_backend.databricks import DatabricksSQL
from chiro_backend.delta import initialize_tables

if __name__ == '__main__':
    print(json.dumps(initialize_tables(DatabricksSQL(Settings())),indent=2))
