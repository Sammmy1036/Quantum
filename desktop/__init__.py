"""Windows integration: the tray icon, DPAPI-protected secrets, the local asset server.

Modules here import each other and the root modules (qbase, patchhub, updater…) by absolute name: the
app's own folder is on sys.path when it runs from source, and PyInstaller bundles everything into Quantum.exe."""
