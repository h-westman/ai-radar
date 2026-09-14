"""Print the OpenAPI schema.

Usage (from backend/): uv run python -m scripts.export_openapi > ../frontend/openapi.json
"""

import json
import sys

from app.main import create_app


def main() -> None:
    json.dump(create_app().openapi(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
