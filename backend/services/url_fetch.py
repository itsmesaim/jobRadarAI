"""
Server-side URL fetch for manual JD paste — replaces client-side allorigins.win.

Blocks SSRF targets (private IPs, localhost, metadata hosts).
"""

import ipaddress
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx

from fastapi import HTTPException, status

_MAX_BYTES = 512_000
_TIMEOUT = 12.0

_BLOCKED_HOSTNAMES = frozenset(
    {
        "localhost",
        "metadata.google.internal",
        "metadata.google",
        "169.254.169.254",
    }
)


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._skip_depth = 0
        self._parts: list[str] = []
        self._title: str | None = None
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "nav", "footer", "header"):
            self._skip_depth += 1
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag in ("script", "style", "nav", "footer", "header") and self._skip_depth:
            self._skip_depth -= 1
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._skip_depth:
            return
        if self._in_title:
            self._title = (self._title or "") + data
        else:
            self._parts.append(data)

    @property
    def text(self) -> str:
        return re.sub(r"\s+", " ", " ".join(self._parts)).strip()[:6000]

    @property
    def title(self) -> str:
        return (self._title or "").strip()


def _hostname_blocked(hostname: str) -> bool:
    host = hostname.lower().rstrip(".")
    if host in _BLOCKED_HOSTNAMES:
        return True
    if host.endswith(".localhost") or host.endswith(".local"):
        return True
    return False


def _ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
    )


def _resolve_host_ips(
    hostname: str,
) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        infos = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not resolve URL hostname.",
        ) from exc

    ips: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
    for info in infos:
        try:
            ips.append(ipaddress.ip_address(info[4][0]))
        except ValueError:
            continue
    if not ips:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not resolve URL hostname.",
        )
    return ips


def validate_fetch_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only http and https URLs are allowed.",
        )
    hostname = parsed.hostname
    if not hostname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid URL.",
        )
    if _hostname_blocked(hostname):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL hostname is not allowed.",
        )
    for ip in _resolve_host_ips(hostname):
        if _ip_blocked(ip):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="URL points to a private or reserved address.",
            )
    return url.strip()


async def fetch_job_page_text(url: str) -> dict[str, str]:
    safe_url = validate_fetch_url(url)

    async with httpx.AsyncClient(
        timeout=_TIMEOUT,
        follow_redirects=True,
        max_redirects=5,
    ) as client:
        try:
            resp = await client.get(
                safe_url,
                headers={"User-Agent": "JobRadar/1.0 (+manual-jd-fetch)"},
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"URL returned HTTP {exc.response.status_code}.",
            ) from exc
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Could not fetch URL. Paste the job description manually.",
            ) from exc

        # Re-validate final URL after redirects (SSRF via redirect)
        final_url = str(resp.url)
        validate_fetch_url(final_url)

        content = resp.content[:_MAX_BYTES]
        charset = resp.charset_encoding or "utf-8"
        try:
            html = content.decode(charset, errors="replace")
        except LookupError:
            html = content.decode("utf-8", errors="replace")

    parser = _TextExtractor()
    parser.feed(html)
    text = parser.text
    if len(text) < 80:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Page had too little text. Paste the job description manually.",
        )

    title = parser.title
    if not title:
        match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
        title = match.group(1).strip() if match else ""

    return {"title": title, "text": text}
