import json
import sys
from getpass import getpass

from tinydb import Query

from services.api.auth.storage import open_db
from services.api.auth.security import verify_password


def bootstrap_first_admin(email: str, password: str):
    email = email.strip().lower()

    with open_db() as db:
        users = db.table("users")

        if users.contains(Query().role == "admin"):
            raise ValueError("Ya existe un administrador")

        user = users.get(Query().email == email)

        if (
            not user
            or not user.get("is_active")
            or not verify_password(
                password, user["hashed_password"]
            )
        ):
            raise ValueError(
                "Usuario o contraseña incorrectos"
            )

        users.update(
            {"role": "admin"},
            doc_ids=[user.doc_id],
        )

        return {
            "id": user.doc_id,
            "email": user["email"],
            "role": "admin",
        }


def main() -> int:
    print("Configuración del primer administrador")

    try:
        email = input("Email del usuario existente: ")
        password = getpass("Contraseña: ")
        bootstrap_first_admin(email, password)
    except EOFError:
        print("ERROR: No se recibieron las credenciales necesarias.", file=sys.stderr)
        return 1
    except json.JSONDecodeError:
        print("ERROR: No se pudo leer el almacenamiento de usuarios.", file=sys.stderr)
        return 1
    except OSError:
        print("ERROR: No se pudo acceder al almacenamiento de usuarios.",
              file=sys.stderr)
        return 1
    except ValueError:
        print("ERROR: No se pudo configurar el administrador; revisa los datos.", file=sys.stderr)
        return 1

    print("ADMIN CREADO OK.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
