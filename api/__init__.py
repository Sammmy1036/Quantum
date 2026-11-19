"""The page's API, split by subject: each api_*.py here is one mixin of app.py's Api class.

Each module does `from qbase import *` and imports the app's other modules (watcher, patchhub, uex…) by their
plain names, which works because the app's own folder is on sys.path (app.py runs from there, and PyInstaller
bundles them all)."""
