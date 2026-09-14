from fastapi import HTTPException
from limits import parse
from limits.storage import MemoryStorage
from limits.strategies import MovingWindowRateLimiter
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def client_ip(scope: Scope) -> str:
    headers = dict(scope.get("headers") or [])
    forwarded = headers.get(b"x-forwarded-for")
    if forwarded:
        first = forwarded.decode("latin-1").split(",")[0].strip()
        if first.count(":") == 1:  # IPv4 with port, as Azure App Service sends it
            first = first.split(":")[0]
        return first
    client = scope.get("client")
    return client[0] if client else "unknown"


class WriteRateLimitMiddleware:
    """In-memory, per-worker limit. Approximate by design (spec §7)."""

    def __init__(self, app: ASGIApp, limit: str) -> None:
        self.app = app
        self.limit = parse(limit)
        self.limiter = MovingWindowRateLimiter(MemoryStorage())

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope["method"] in WRITE_METHODS
            and scope["path"].startswith("/api/")
            and not self.limiter.hit(self.limit, client_ip(scope))
        ):
            response = JSONResponse(
                {"detail": "Too many changes. Please wait a minute."},
                status_code=429,
                headers={"Retry-After": "60"},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            length = dict(scope["headers"]).get(b"content-length", b"0")
            if length.isdigit() and int(length) > self.max_bytes:
                response = JSONResponse({"detail": "Request body too large"}, status_code=413)
                await response(scope, receive, send)
                return
            receive = self._limited_receive(receive)
        await self.app(scope, receive, send)

    def _limited_receive(self, receive: Receive) -> Receive:
        """Enforce the cap even without Content-Length (e.g. chunked transfer)."""
        total = 0

        async def wrapped_receive() -> Message:
            nonlocal total
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > self.max_bytes:
                    raise HTTPException(status_code=413, detail="Request body too large")
            return message

        return wrapped_receive
