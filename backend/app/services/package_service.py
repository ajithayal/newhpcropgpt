from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import yaml
from pathlib import Path
from app.models.models import Package


async def seed_packages(db: AsyncSession):
    catalog_path = Path(__file__).parent.parent.parent.parent / "config" / "package_catalog.yaml"
    if not catalog_path.exists():
        return

    with open(catalog_path) as f:
        catalog = yaml.safe_load(f)

    result = await db.execute(select(Package).limit(1))
    if result.scalar_one_or_none():
        return

    for category in catalog.get("categories", []):
        for pkg in category.get("packages", []):
            package = Package(
                name=pkg["name"],
                version=pkg["version"],
                category=category["name"],
                description=pkg.get("description", ""),
                install_method=pkg.get("method", "manual"),
                status="available",
            )
            db.add(package)

    await db.commit()
