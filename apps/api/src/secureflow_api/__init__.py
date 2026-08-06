"""SecureFlow API scaffold (FastAPI, uv-managed).

Serves the same dataset the SPA embeds, behind the routes a production
deployment would use, persisted in PostgreSQL (SQLAlchemy + Alembic). Entra
ID JWT validation slots into the marked extension point; it is not faked
here.
"""
