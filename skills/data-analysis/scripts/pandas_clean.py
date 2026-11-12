"""
Safe snippet for basic pandas cleaning. Copy and adapt for your dataset.
Run: python pandas_clean.py  (ensure pandas is installed)
"""
import sys
from pathlib import Path

try:
    import pandas as pd
except ModuleNotFoundError:
    print(
        "No se puede ejecutar la limpieza: instala la dependencia pandas.",
        file=sys.stderr,
    )
    sys.exit(1)

DATA_PATH = Path("data.csv")

try:
    df = pd.read_csv(DATA_PATH)
except FileNotFoundError:
    print("No se encontró el archivo data.csv.", file=sys.stderr)
    sys.exit(1)
except PermissionError:
    print("No se pudo acceder al archivo data.csv.", file=sys.stderr)
    sys.exit(1)
except pd.errors.EmptyDataError:
    print("El archivo data.csv está vacío o no tiene encabezados.", file=sys.stderr)
    sys.exit(1)
except pd.errors.ParserError:
    print("El archivo data.csv tiene un formato CSV inválido.", file=sys.stderr)
    sys.exit(1)
except UnicodeError:
    print("No se pudo decodificar data.csv; comprueba su codificación.", file=sys.stderr)
    sys.exit(1)
except OSError:
    print("No se pudo leer el archivo data.csv.", file=sys.stderr)
    sys.exit(1)

if df.empty or len(df.columns) == 0:
    print("El archivo data.csv no contiene filas de datos.", file=sys.stderr)
    sys.exit(1)

print("df_shape", df.shape)
print("df_dtypes", df.dtypes)

# Drop fully null columns
df = df.dropna(axis=1, how="all")
print("df_shape_after_drop_all_null_cols", df.shape)

# Fill or drop nulls in key columns (customise columns)
# df = df.dropna(subset=["required_col"])
# df["optional_col"] = df["optional_col"].fillna(0)

# Normalise column names (optional)
df.columns = df.columns.str.strip().str.lower().str.replace(" ", "_")
print("df_columns", list(df.columns))

# Deduplicate (optional)
before = len(df)
df = df.drop_duplicates()
print("rows_dropped_duplicates", before - len(df))

# Report preview size without printing source data.
print("df_preview_rows", min(5, len(df)))
