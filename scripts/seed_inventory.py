from sqlmodel import Session, select

from services.api.auth import storage
from services.database import get_engine
from services.models import Ingredient, IngredientEntry, IngredientExit
from services.routers.inventory import get_user_uuid

users = [u for u in storage.list_users() if u.get("is_active")]
if not users:
    raise SystemExit("Falta crear un usuario activo en TinyDB")

user_uuid = get_user_uuid(users[0])

ingredients = [
    ("Falda de ternera", "BRS-BEEF-001", "kg", "meat", "CO"),
    ("Costilla de cerdo", "BRS-PORK-001", "kg", "meat", "US"),
    ("Chimichurri", "BRS-SAUCE-001", "litro", "sauce", "CO"),
    ("Salsa BBQ de la casa", "BRS-SAUCE-002", "litro", "sauce", "US"),
    ("Yuca", "BRS-PROD-001", "kg", "produce", "CO"),
    ("Caja para llevar (M)", "BRS-PKG-001", "unidad", "packaging", "CO"),
]

with Session(get_engine()) as db:
    products = {}

    for name, sku, unit, category, country in ingredients:
        product = db.exec(
            select(Ingredient).where(Ingredient.sku == sku)
        ).first()

        if product is None:
            product = Ingredient(
                name=name, sku=sku, unit=unit,
                category=category, country=country
            )
            db.add(product)
            db.flush()

        products[sku] = product.id

    entries = [
        ("BRS-BEEF-001", 50, "Carnes del Valle S.A.", 1),
        ("BRS-BEEF-001", 30, "Carnes del Valle S.A.", 1),
        ("BRS-PORK-001", 40, "MiamiMeat Co.", 8),
        ("BRS-SAUCE-001", 10, "Salsas Artesanales Ltda.", 1),
    ]

    for sku, qty, supplier, location in entries:
        ingredient_id = products[sku]
        existing = db.exec(
            select(IngredientEntry).where(
                IngredientEntry.ingredient_id == ingredient_id,
                IngredientEntry.quantity == qty,
                IngredientEntry.supplier_name == supplier,
                IngredientEntry.location_id == location,
            )
        ).first()

        if existing is None:
            db.add(IngredientEntry(
                ingredient_id=ingredient_id,
                quantity=qty,
                supplier_name=supplier,
                location_id=location,
                user_uuid=user_uuid,
            ))

    exits = [
        ("BRS-BEEF-001", 20, "consumption", 1),
        ("BRS-BEEF-001", 3, "waste", 1),
        ("BRS-PORK-001", 5, "consumption", 8),
    ]

    for sku, qty, reason, location in exits:
        ingredient_id = products[sku]
        existing = db.exec(
            select(IngredientExit).where(
                IngredientExit.ingredient_id == ingredient_id,
                IngredientExit.quantity == qty,
                IngredientExit.reason == reason,
                IngredientExit.location_id == location,
            )
        ).first()

        if existing is None:
            db.add(IngredientExit(
                ingredient_id=ingredient_id,
                quantity=qty,
                reason=reason,
                location_id=location,
                user_uuid=user_uuid,
            ))

    db.commit()

print("OK: Datos iniciales de Brasaland preparados")
