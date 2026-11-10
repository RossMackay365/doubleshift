import os
import uuid
from fastapi import HTTPException, Header
from typing import Optional

_valid_tokens: set[str] = set()


def login(password: str) -> str:
    app_password = os.getenv('APP_PASSWORD', '')
    if not app_password:
        raise HTTPException(status_code=500, detail="Server misconfigured: APP_PASSWORD not set")
    if password != app_password:
        raise HTTPException(status_code=401, detail="Invalid password")
    token = str(uuid.uuid4())
    _valid_tokens.add(token)
    return token


def require_auth(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.removeprefix('Bearer ')
    if token not in _valid_tokens:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
