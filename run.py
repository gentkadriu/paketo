import os
import socket

import uvicorn

HOST = os.environ.get("POSTA_HOST", "0.0.0.0")
PORT = int(os.environ.get("POSTA_PORT", "8000"))


def _local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "YOUR-PC-IP"


if __name__ == "__main__":
    ip = _local_ip()
    print("\n  Paketo is running:")
    print(f"  Local:  http://127.0.0.1:{PORT}")
    if HOST == "0.0.0.0":
        print(f"  Network: http://{ip}:{PORT}")
    print("\n  Keep this process running while using the app.\n")
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False)
