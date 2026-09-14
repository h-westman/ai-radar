from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse


def mount_spa(app: FastAPI, static_dir: Path) -> None:
    index = static_dir / "index.html"
    if not index.is_file():
        return
    root = static_dir.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        try:
            candidate = (root / full_path).resolve()
            is_match = full_path and candidate.is_file() and candidate.is_relative_to(root)
        except (ValueError, OSError):
            is_match = False
        if is_match:
            return FileResponse(candidate)
        return FileResponse(index)
