"""FastAPI wrapper around the DeepPresenter / PPTAgent runtime."""

from .main import app, create_app

__version__ = "0.1.0"
__all__ = ["app", "create_app"]
