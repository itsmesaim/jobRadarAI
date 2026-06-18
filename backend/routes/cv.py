"""
CV routes.

POST /cv/upload   — upload PDF, parse it, store in MongoDB
GET  /cv/me       — return current user's parsed CV
DELETE /cv/me     — remove CV (so user can re-upload)
"""

from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from database import get_database
from deps import get_current_user
from services.cv_parser import process_cv

router = APIRouter(prefix="/cv", tags=["cv"])

MAX_PDF_SIZE = 5 * 1024 * 1024  # 5MB


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_cv(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    # ── basic validation ──────────────────────────────────
    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only PDF files are accepted.",
        )

    pdf_bytes = await file.read()

    if len(pdf_bytes) > MAX_PDF_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="PDF must be under 5MB.",
        )

    # ── parse ─────────────────────────────────────────────
    try:
        raw_text, structured = await process_cv(pdf_bytes)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        )

    # ── store in MongoDB ──────────────────────────────────
    db = get_database()
    await db.users.update_one(
        {"_id": ObjectId(user["_id"])},
        {
            "$set": {
                "cv": {
                    "raw_text": raw_text,
                    "structured": structured,
                    "uploaded_at": datetime.now(timezone.utc),
                    "filename": file.filename,
                }
            }
        },
    )

    return {
        "message": "CV uploaded and parsed successfully.",
        "structured": structured,
    }


@router.get("/me")
async def get_my_cv(user=Depends(get_current_user)):
    cv = user.get("cv")
    if not cv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No CV uploaded yet.",
        )
    # don't return raw_text in list view — it's large
    return {
        "filename": cv.get("filename"),
        "uploaded_at": cv.get("uploaded_at"),
        "structured": cv.get("structured"),
    }


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_cv(user=Depends(get_current_user)):
    db = get_database()
    await db.users.update_one(
        {"_id": ObjectId(user["_id"])},
        {"$unset": {"cv": ""}},
    )
