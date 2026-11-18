#!/usr/bin/env python3
"""
AYAL HPC Platform - Enterprise HTTPS Gateway & Reverse Proxy
------------------------------------------------------------
Listens on port 443 with SSL/TLS termination.
Serves:
  - React SPA frontend from frontend/dist (with SPA fallback for HTML5 routing)
  - Reverse proxies /api/* to FastAPI backend on http://127.0.0.1:8000
  - Reverse proxies /ws WebSocket connections to backend ws://127.0.0.1:8000/ws
  - Optional Port 80 HTTP-to-HTTPS redirect service
"""

import os
import sys
import asyncio
from pathlib import Path
import httpx
import uvicorn
import websockets
from contextlib import asynccontextmanager
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, Response, StreamingResponse, RedirectResponse
from starlette.websockets import WebSocket, WebSocketDisconnect

ROOT_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT_DIR / "frontend" / "dist"
CERTS_DIR = ROOT_DIR / "certs"

KEY_FILE = CERTS_DIR / "server.key"
CERT_FILE = CERTS_DIR / "server.crt"

BACKEND_HTTP = os.getenv("AYALHPC_BACKEND_HTTP", "http://127.0.0.1:8000")
BACKEND_WS = os.getenv("AYALHPC_BACKEND_WS", "ws://127.0.0.1:8000")
SYSTEM_IP = os.getenv("AYALHPC_HOST", "0.0.0.0")
HTTPS_PORT = int(os.getenv("AYALHPC_PORT", "443"))

# Hop-by-hop headers to strip when proxying
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "content-length"
}

from starlette.routing import Route, WebSocketRoute

http_client: httpx.AsyncClient | None = None

@asynccontextmanager
async def lifespan(app):
    global http_client
    http_client = httpx.AsyncClient(timeout=300.0, follow_redirects=True)
    yield
    if http_client:
        await http_client.aclose()


async def websocket_proxy(websocket: WebSocket):
    await websocket.accept()
    upstream_url = f"{BACKEND_WS}{websocket.url.path}"
    if websocket.url.query:
        upstream_url += f"?{websocket.url.query}"

    try:
        async with websockets.connect(upstream_url) as upstream:
            async def client_to_upstream():
                try:
                    while True:
                        msg = await websocket.receive()
                        if "text" in msg:
                            await upstream.send(msg["text"])
                        elif "bytes" in msg:
                            await upstream.send(msg["bytes"])
                except (WebSocketDisconnect, asyncio.CancelledError):
                    pass

            async def upstream_to_client():
                try:
                    while True:
                        data = await upstream.recv()
                        if isinstance(data, str):
                            await websocket.send_text(data)
                        else:
                            await websocket.send_bytes(data)
                except (websockets.exceptions.ConnectionClosed, asyncio.CancelledError):
                    pass

            tasks = [
                asyncio.create_task(client_to_upstream()),
                asyncio.create_task(upstream_to_client())
            ]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
    except Exception as e:
        print(f"[WS-PROXY-ERROR] {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


async def proxy_or_static(request: Request):
    path = request.url.path
    query = request.url.query

    # 1. API & Backend Documentation Proxy
    if path.startswith(("/api", "/docs", "/openapi.json", "/redoc")):
        target_url = f"{BACKEND_HTTP}{path}"
        if query:
            target_url += f"?{query}"

        # Filter request headers
        req_headers = {}
        for k, v in request.headers.items():
            if k.lower() not in HOP_BY_HOP and k.lower() != "host":
                req_headers[k] = v
        req_headers["host"] = "127.0.0.1:8000"
        req_headers["x-forwarded-proto"] = "https"
        req_headers["x-forwarded-host"] = request.headers.get("host", "192.9.56.129")
        if request.client:
            req_headers["x-forwarded-for"] = request.client.host

        req_body = await request.body()
        try:
            resp = await http_client.request(
                method=request.method,
                url=target_url,
                headers=req_headers,
                content=req_body,
            )
            # Response headers
            resp_headers = {}
            for k, v in resp.headers.items():
                if k.lower() not in HOP_BY_HOP:
                    resp_headers[k] = v

            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=resp_headers,
            )
        except Exception as e:
            return Response(
                content=f'{{"error": "Backend gateway error: {str(e)}"}}',
                status_code=502,
                media_type="application/json"
            )

    # 2. Static Assets from frontend/dist
    clean_path = path.lstrip("/")
    if clean_path:
        target_file = (DIST_DIR / clean_path).resolve()
        # Prevent directory traversal
        if str(target_file).startswith(str(DIST_DIR.resolve())) and target_file.is_file():
            return FileResponse(target_file)

    # 3. SPA Client-Side Routing Fallback (serve index.html)
    index_file = DIST_DIR / "index.html"
    if index_file.is_file():
        return FileResponse(index_file)

    return Response("AYAL HPC Frontend build not found. Please build frontend first.", status_code=404)


routes = [
    WebSocketRoute("/ws", websocket_proxy),
    WebSocketRoute("/ws/{path:path}", websocket_proxy),
    Route("/{path:path}", proxy_or_static, methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]),
]

app = Starlette(routes=routes, lifespan=lifespan)


def start_http_redirector():
    """Runs a port 80 to 443 HTTPS redirect server."""
    async def redirect_to_https(request: Request):
        host = request.headers.get("host", "192.9.56.129").split(":")[0]
        target = f"https://{host}{request.url.path}"
        if request.url.query:
            target += f"?{request.url.query}"
        return RedirectResponse(url=target, status_code=301)

    redirect_app = Starlette(routes=[
        Route("/{path:path}", redirect_to_https, methods=["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"])
    ])

    try:
        config = uvicorn.Config(redirect_app, host="0.0.0.0", port=80, log_level="warning")
        server = uvicorn.Server(config)
        asyncio.create_task(server.serve())
        print("[AYAL-HPC] Port 80 HTTP-to-HTTPS redirector active.")
    except Exception as e:
        print(f"[AYAL-HPC] Port 80 redirector skipped ({e}).")


if __name__ == "__main__":
    if not KEY_FILE.exists() or not CERT_FILE.exists():
        print(f"[ERROR] SSL cert or key not found in {CERTS_DIR}. Generating now...")
        from generate_ssl_certs import generate_certs_for_dir
        generate_certs_for_dir(str(ROOT_DIR))

    print("================================================================")
    print("      AYAL HPC - Enterprise HTTPS Gateway (Port 443)            ")
    print("================================================================")
    print(f"  System IP:       192.9.56.129")
    print(f"  HTTPS Address:   https://192.9.56.129/")
    print(f"  Local Address:   https://localhost/")
    print(f"  Backend API:     {BACKEND_HTTP}")
    print(f"  Frontend Dist:   {DIST_DIR}")
    print(f"  SSL Cert:        {CERT_FILE}")
    print("================================================================")

    # Launch HTTP redirector if possible
    async def run_servers():
        # Start port 80 redirector in background
        start_http_redirector()

        # Start port 443 HTTPS Gateway
        config_https = uvicorn.Config(
            app,
            host=SYSTEM_IP,
            port=HTTPS_PORT,
            ssl_keyfile=str(KEY_FILE),
            ssl_certfile=str(CERT_FILE),
            log_level="info",
            access_log=False,
        )
        server_https = uvicorn.Server(config_https)
        await server_https.serve()

    asyncio.run(run_servers())
