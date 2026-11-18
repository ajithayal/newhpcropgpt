from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text
from app.core.config import settings
from app.db.base import Base

engine_kwargs = {"echo": False}
if "sqlite" not in settings.DATABASE_URL:
    engine_kwargs.update({"pool_size": 20, "max_overflow": 10})

engine = create_async_engine(settings.DATABASE_URL, **engine_kwargs)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()

async def init_db():
    # Import all models to register with Base metadata
    import app.models.models
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Automatic schema alignment for license columns
        try:
            if "sqlite" in settings.DATABASE_URL:
                add_cols = [
                    ("installation_id", "VARCHAR(100)"),
                    ("license_type", "VARCHAR(50) DEFAULT 'PERPETUAL'"),
                    ("is_perpetual", "BOOLEAN DEFAULT 1"),
                    ("license_token", "TEXT"),
                    ("license_signature", "TEXT"),
                    ("features", "TEXT"),
                ]
                for col, col_t in add_cols:
                    try:
                        await conn.execute(text(f"ALTER TABLE product_licenses ADD COLUMN {col} {col_t};"))
                    except Exception:
                        pass
        except Exception:
            pass
