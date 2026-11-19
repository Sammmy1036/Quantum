"""Fetching data from other services: UEX, the Star Citizen Wiki, starcitizen.tools, RSI, the Quantum server.

Modules here import each other and the root modules (qbase, patchhub, updater…) by absolute name: the
app's own folder is on sys.path when it runs from source, and PyInstaller bundles everything into Quantum.exe."""
