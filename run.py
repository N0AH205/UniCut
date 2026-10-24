import sys
import os
import webbrowser
import threading
import time
import uvicorn

def open_browser():
    time.sleep(1.2)
    url = "http://127.0.0.1:7860"
    print(f"\n[>] UniCut AI Studio is ready at: {url}\n")
    try:
        webbrowser.open(url)
    except Exception:
        pass

if __name__ == "__main__":
    print("=" * 65)
    print("  UniCut AI: Custom, Private Background Remover & Matting  ")
    print("=" * 65)
    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run("server:app", host="127.0.0.1", port=7860, reload=False, log_level="info")
