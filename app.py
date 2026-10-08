"""Databricks Apps entrypoint: existing API plus the production React build."""
import os
from pathlib import Path

import uvicorn
from fastapi import HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from chiro_backend.app import create_app
from chiro_backend.config import Settings


def create_deployed_app(frontend_dir=None):
    # Apps injects OAuth service-principal credentials; no local CLI profile.
    app = create_app(Settings(profile=None))
    root = Path(frontend_dir or Path(__file__).parent / 'frontend' / 'dist').resolve()
    if not (root / 'index.html').is_file():
        raise RuntimeError('Production frontend missing; run npm --prefix frontend run build before deploying')
    app.mount('/assets', StaticFiles(directory=root / 'assets'), name='frontend-assets')

    @app.get('/{path:path}', include_in_schema=False)
    def frontend(path: str):
        # Never disguise a missing API or build asset as a successful HTML response.
        if path == 'api' or path.startswith('api/') or path == 'health' or path.startswith('assets/'):
            raise HTTPException(status_code=404)
        target = (root / path).resolve()
        if not target.is_relative_to(root):
            raise HTTPException(status_code=404)
        if target.is_file():
            return FileResponse(target)
        if Path(path).suffix:
            raise HTTPException(status_code=404)
        return FileResponse(root / 'index.html')

    return app


app = create_deployed_app()

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('DATABRICKS_APP_PORT', '8000')), workers=1)
