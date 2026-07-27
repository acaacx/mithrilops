"""SecureFlow API scaffold (FastAPI, uv-managed).

Serves the same mock dataset the SPA embeds, behind the routes a production
deployment would use. Real persistence (PostgreSQL + SQLAlchemy), Redis, and
Entra ID JWT validation slot into the marked extension points; none of that is
faked here.
"""
